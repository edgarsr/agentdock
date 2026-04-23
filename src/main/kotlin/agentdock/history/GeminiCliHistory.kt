package agentdock.history

import kotlinx.serialization.json.jsonObject
import java.io.File
import java.time.Instant
import java.time.temporal.ChronoUnit
import java.time.ZoneId

internal object GeminiCliHistory : AdapterHistory {
    override val adapterId: String = "gemini-cli"

    private val sessionLineRegex = Regex("""^\s*(\d+)\.\s+(.*?)\s+\((.*?)\)\s+\[([^\]]+)]\s*$""")
    private val geminiSessionFileRegex = Regex("""^session-.*-[0-9a-fA-F]{8}\.jsonl?$""")
    private val safeGeminiPathSegmentRegex = Regex("""^[A-Za-z0-9-]+$""")

    override fun collectSessions(projectPath: String): List<SessionMeta> {
        val output = runAgentHistoryCliCommand(adapterId, projectPath, listOf("--list-sessions")) ?: return emptyList()
        val now = Instant.now()
        return output.lineSequence()
            .mapNotNull { line -> parseSessionLine(projectPath, line, now) }
            .toList()
    }

    fun resolveSourceFilePath(projectPath: String, sessionId: String): String {
        val chatsDir = resolveChatsDir(projectPath) ?: return ""
        return findMatchingSessionFiles(chatsDir, sessionId).firstOrNull()?.absolutePath.orEmpty()
    }

    private fun parseSessionLine(projectPath: String, rawLine: String, now: Instant): SessionMeta? {
        val match = sessionLineRegex.matchEntire(rawLine.trim()) ?: return null
        match.groupValues[1].toIntOrNull() ?: return null
        val title = fallbackHistoryTitle(match.groupValues[2])
        val relativeTime = match.groupValues[3].trim()
        val sessionId = match.groupValues[4].trim()
        if (sessionId.isBlank()) return null

        val timestamp = parseRelativeTimestamp(relativeTime, now) ?: now.toEpochMilli()
        return SessionMeta(
            sessionId = sessionId,
            adapterName = adapterId,
            projectPath = projectPath,
            title = title,
            filePath = "",
            createdAt = timestamp,
            updatedAt = timestamp
        )
    }

    private fun parseRelativeTimestamp(value: String, now: Instant): Long? {
        val normalized = value.trim().lowercase()
        if (normalized.isBlank()) return null
        if (normalized == "just now") return now.toEpochMilli()

        val simpleMatch = Regex("""^(a|\d+)\s+(second|minute|hour|day|week|month|year)s?\s+ago$""")
            .matchEntire(normalized)
            ?: return null

        val amount = if (simpleMatch.groupValues[1] == "a") 1L else simpleMatch.groupValues[1].toLongOrNull() ?: return null
        val instant = when (simpleMatch.groupValues[2]) {
            "second" -> now.minus(amount, ChronoUnit.SECONDS)
            "minute" -> now.minus(amount, ChronoUnit.MINUTES)
            "hour" -> now.minus(amount, ChronoUnit.HOURS)
            "day" -> now.minus(amount, ChronoUnit.DAYS)
            "week" -> now.minus(amount, ChronoUnit.WEEKS)
            "month" -> now.atZone(ZoneId.systemDefault()).minusMonths(amount).toInstant()
            "year" -> now.atZone(ZoneId.systemDefault()).minusYears(amount).toInstant()
            else -> return null
        }
        return instant.toEpochMilli()
    }

    override fun deleteSession(projectPath: String, sessionId: String, sourceFilePath: String?): Boolean {
        val tempDir = resolveProjectTempDir(projectPath) ?: return false
        val chatsDir = File(tempDir, "chats")
        val mainFiles = linkedSetOf<File>()
        sourceFilePath?.takeIf { it.isNotBlank() }?.let(::File)?.takeIf { it.isFile }?.let(mainFiles::add)
        if (chatsDir.isDirectory) {
            mainFiles.addAll(findMatchingSessionFiles(chatsDir, sessionId))
        }

        var success = true
        if (mainFiles.isEmpty()) {
            success = deleteSessionArtifacts(tempDir, sessionId) && success
            success = deleteSubagentSessionArtifacts(chatsDir, tempDir, sessionId) && success
            return success
        }

        mainFiles.forEach { file ->
            val fullSessionId = readSessionId(file) ?: sessionId
            success = deleteHistoryFileIfExists(file) && success
            success = deleteSessionArtifacts(tempDir, fullSessionId) && success
            success = deleteSubagentSessionArtifacts(chatsDir, tempDir, fullSessionId) && success
        }
        return success
    }

    private fun resolveProjectTempDir(projectPath: String): File? {
        val canonicalProjectPath = canonicalHistoryProjectPath(projectPath)
        if (canonicalProjectPath.isBlank()) return null

        val projectsFile = File(System.getProperty("user.home"), ".gemini/projects.json")
        if (!projectsFile.isFile) return null

        val identifier = runCatching {
            val root = historyJson.parseToJsonElement(projectsFile.readText()).jsonObject
            val projects = root["projects"]?.jsonObject ?: return@runCatching ""
            projects.entries.firstNotNullOfOrNull { (rawPath, value) ->
                val mappedPath = historyComparablePath(rawPath)
                val mappedIdentifier = value.toString().trim('"')
                mappedIdentifier.takeIf {
                    mappedPath == historyComparablePath(canonicalProjectPath) && it.isNotBlank()
                }
            }.orEmpty()
        }.getOrDefault("")

        if (identifier.isBlank() || !safeGeminiPathSegmentRegex.matches(identifier)) return null
        return File(File(System.getProperty("user.home"), ".gemini/tmp"), identifier)
    }

    private fun resolveChatsDir(projectPath: String): File? {
        val tempDir = resolveProjectTempDir(projectPath) ?: return null
        return File(tempDir, "chats").takeIf { it.isDirectory }
    }

    private fun findMatchingSessionFiles(chatsDir: File, sessionId: String): List<File> {
        if (!chatsDir.isDirectory) return emptyList()
        val shortId = sessionId.take(8).takeIf { it.length == 8 } ?: return emptyList()
        val directMatches = chatsDir.listFiles()
            ?.filter { file ->
                file.isFile &&
                    geminiSessionFileRegex.matches(file.name) &&
                    (file.name.endsWith("-$shortId.json") || file.name.endsWith("-$shortId.jsonl"))
            }
            .orEmpty()
            .sortedByDescending(File::lastModified)

        val exactMatches = directMatches.filter { readSessionId(it) == sessionId }
        if (exactMatches.isNotEmpty()) return exactMatches
        if (directMatches.isNotEmpty()) return directMatches

        return chatsDir.listFiles()
            ?.asSequence()
            ?.filter { it.isFile && geminiSessionFileRegex.matches(it.name) }
            ?.filter { readSessionId(it) == sessionId }
            ?.sortedByDescending(File::lastModified)
            ?.toList()
            .orEmpty()
    }

    private fun readSessionId(file: File): String? {
        return runCatching {
            val content = if (file.name.endsWith(".jsonl")) {
                file.useLines { lines -> lines.firstOrNull { it.isNotBlank() } }.orEmpty()
            } else {
                file.readText()
            }
            if (content.isBlank()) return@runCatching null
            historyJson.parseToJsonElement(content).jsonObject.stringOrNull("sessionId")?.trim()
        }.getOrNull()
    }

    private fun deleteSessionArtifacts(tempDir: File, sessionId: String): Boolean {
        val safeSessionId = sessionId.takeIf { safeGeminiPathSegmentRegex.matches(it) } ?: return false
        val logFile = File(File(tempDir, "logs"), "session-$safeSessionId.jsonl")
        val toolOutputDir = File(File(tempDir, "tool-outputs"), "session-$safeSessionId")
        val sessionDir = File(tempDir, safeSessionId)
        return deleteHistoryFileIfExists(logFile) &&
            deleteHistoryDirectoryIfExists(toolOutputDir) &&
            deleteHistoryDirectoryIfExists(sessionDir)
    }

    private fun deleteSubagentSessionArtifacts(chatsDir: File, tempDir: File, parentSessionId: String): Boolean {
        val safeParentSessionId = parentSessionId.takeIf { safeGeminiPathSegmentRegex.matches(it) } ?: return false
        val subagentDir = File(chatsDir, safeParentSessionId)
        if (!subagentDir.exists()) return true
        if (!subagentDir.isDirectory) return false

        var success = true
        subagentDir.listFiles()?.forEach { child ->
            if (!child.isFile || (!child.name.endsWith(".json") && !child.name.endsWith(".jsonl"))) return@forEach
            val subagentSessionId = child.name.substringBeforeLast('.')
            if (safeGeminiPathSegmentRegex.matches(subagentSessionId)) {
                success = deleteSessionArtifacts(tempDir, subagentSessionId) && success
            }
        }
        return deleteHistoryDirectoryIfExists(subagentDir) && success
    }
}
