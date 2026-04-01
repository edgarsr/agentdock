package unified.llm.history

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import unified.llm.acp.AcpAdapterPaths
import unified.llm.acp.AcpExecutionMode
import unified.llm.acp.AcpExecutionTarget
import java.io.File
import java.security.MessageDigest
import java.time.Instant

internal const val MAX_HISTORY_LINES_TO_SCAN = 40
internal val historyJson = Json { ignoreUnknownKeys = true }

internal fun canonicalHistoryProjectPath(projectPath: String?): String {
    val raw = projectPath?.takeIf { it.isNotBlank() && it != "undefined" && it != "null" } ?: ""
    return raw.takeIf { it.isNotBlank() }?.let {
        runCatching { File(it).canonicalPath }.getOrDefault(it)
    } ?: ""
}

internal fun JsonObject.stringOrNull(key: String): String? {
    val value = this[key] ?: return null
    return (value as? JsonPrimitive)?.content
}

internal fun JsonElement.stringAtPath(path: String?): String? {
    if (path.isNullOrBlank()) return null
    var current: JsonElement = this
    for (segment in path.split('.')) {
        current = (current as? JsonObject)?.get(segment) ?: return null
    }
    return (current as? JsonPrimitive)?.contentOrNull
}

internal fun parseHistoryTimestamp(value: String?): Long? {
    if (value.isNullOrBlank()) return null
    return value.toLongOrNull() ?: runCatching { Instant.parse(value).toEpochMilli() }.getOrNull()
}

internal fun fallbackHistoryTitle(raw: String?): String {
    val normalized = raw?.trim().orEmpty().ifBlank { "Untitled Session" }
    return if (normalized.length <= 64) normalized else normalized.take(64) + "..."
}

internal fun parseSimpleYamlMap(file: File): Map<String, String> {
    if (!file.isFile) return emptyMap()
    val values = linkedMapOf<String, String>()
    runCatching {
        file.forEachLine { rawLine ->
            if (rawLine.isBlank()) return@forEachLine
            if (rawLine.trimStart().startsWith("#")) return@forEachLine
            if (rawLine.firstOrNull()?.isWhitespace() == true) return@forEachLine
            val separator = rawLine.indexOf(':')
            if (separator <= 0) return@forEachLine
            val key = rawLine.substring(0, separator).trim()
            if (key.isBlank()) return@forEachLine
            val value = rawLine.substring(separator + 1).trim().trim('"', '\'')
            values[key] = value
        }
    }
    return values
}

internal fun historyComparablePath(path: String?): String {
    val value = path?.trim().orEmpty()
    if (value.isEmpty()) return ""
    val mountMatch = Regex("^/mnt/([A-Za-z])/(.*)$").matchEntire(value.replace("\\", "/"))
    val comparable = if (mountMatch != null) {
        val drive = mountMatch.groupValues[1].uppercase()
        val rest = mountMatch.groupValues[2].replace("/", "\\")
        "$drive:\\$rest"
    } else {
        value
    }
    val normalized = comparable.replace("/", File.separator).replace("\\", File.separator)
    val canonical = runCatching { File(normalized).canonicalPath }.getOrDefault(normalized)
    val looksWindowsPath = canonical.length >= 2 && canonical[1] == ':'
    return if (File.separatorChar == '\\' || looksWindowsPath) canonical.lowercase() else canonical
}

internal fun readableHistorySourcePath(path: String?): String {
    val value = path?.trim().orEmpty()
    if (value.isEmpty()) return ""
    return AcpExecutionMode.wslPathToWindowsUnc(value) ?: value
}

internal fun historyHashMd5(value: String): String {
    val md = MessageDigest.getInstance("MD5")
    return md.digest(value.toByteArray()).joinToString("") { "%02x".format(it) }
}

private fun historyHashSha256(value: String): String {
    val md = MessageDigest.getInstance("SHA-256")
    return md.digest(value.toByteArray()).joinToString("") { "%02x".format(it) }
}

private fun normalizeWindowsHistoryPath(projectPath: String): String {
    val withBackslashes = projectPath.replace("/", "\\")
    return if (withBackslashes.length >= 2 && withBackslashes[1] == ':') {
        withBackslashes.substring(0, 1).uppercase() + withBackslashes.substring(1)
    } else {
        withBackslashes
    }
}

internal fun historyProjectPathSlug(projectPath: String): String {
    return projectPath.replace(Regex("[^a-zA-Z0-9]"), "-")
}

private fun historyProjectPathSlugCollapsed(projectPath: String): String {
    return historyProjectPathSlug(projectPath)
        .replace(Regex("-+"), "-")
        .trim('-')
}

internal fun resolveHistoryPathTemplate(template: String, projectPath: String?, sessionId: String? = null): String {
    val target = AcpAdapterPaths.getExecutionTarget()
    val home = if (target == AcpExecutionTarget.WSL) {
        AcpExecutionMode.wslHomeDir() ?: return template
    } else {
        System.getProperty("user.home")
    }
    val canonicalProject = canonicalHistoryProjectPath(projectPath)
    val windowsProject = normalizeWindowsHistoryPath(canonicalProject)
    val slug = historyProjectPathSlug(windowsProject)
    val slugCollapsed = historyProjectPathSlugCollapsed(windowsProject)
    val hashSha256 = historyHashSha256(windowsProject)
    val hashMd5 = historyHashMd5(windowsProject)

    val resolved = template
        .replace("~", home)
        .replace("{projectPathSlug}", slug)
        .replace("{projectPathSlugCollapsed}", slugCollapsed)
        .replace("{projectHashSha256}", hashSha256)
        .replace("{projectHashMd5}", hashMd5)
        .replace("{slug}", slug)
        .replace("{hash}", hashSha256)
        .replace("{sessionId}", sessionId ?: "")
    return if (target == AcpExecutionTarget.WSL) {
        val wslPath = resolved.replace("\\", "/")
        AcpExecutionMode.wslPathToWindowsUnc(wslPath) ?: wslPath
    } else {
        resolved.replace("/", File.separator).replace("\\", File.separator)
    }
}

private fun buildHistoryGlobRegex(glob: String): Regex {
    val sb = StringBuilder("^")
    var i = 0
    while (i < glob.length) {
        val c = glob[i]
        when (c) {
            '*' -> {
                if (i + 1 < glob.length && glob[i + 1] == '*') {
                    sb.append(".*")
                    i++
                } else {
                    sb.append("[^/]*")
                }
            }
            '?' -> sb.append("[^/]")
            '.', '(', ')', '[', ']', '{', '}', '+', '^', '$', '|', '\\' -> sb.append('\\').append(c)
            else -> sb.append(c)
        }
        i++
    }
    sb.append("$")
    return Regex(sb.toString())
}

internal fun findMatchingHistoryFiles(templatePath: String): List<File> {
    val normalizedTemplate = templatePath.replace("\\", "/")
    val firstWildcard = normalizedTemplate.indexOfFirst { it == '*' || it == '?' }
    if (firstWildcard < 0) {
        val file = File(templatePath)
        return if (file.exists() && file.isFile) listOf(file) else emptyList()
    }

    val rootEnd = normalizedTemplate.lastIndexOf('/', firstWildcard)
    if (rootEnd <= 0) return emptyList()
    val rootPath = normalizedTemplate.substring(0, rootEnd)
    val relativePattern = normalizedTemplate.substring(rootEnd + 1)
    val rootDir = File(rootPath.replace("/", File.separator))
    if (!rootDir.exists() || !rootDir.isDirectory) return emptyList()

    val matcher = buildHistoryGlobRegex(relativePattern)
    val rootNioPath = rootDir.toPath()
    return rootDir.walkTopDown()
        .filter { it.isFile }
        .filter { file ->
            val relative = rootNioPath.relativize(file.toPath()).toString().replace("\\", "/")
            matcher.matches(relative)
        }
        .toList()
}

internal fun deleteHistoryFileIfExists(file: File): Boolean {
    return !file.exists() || file.delete()
}

internal fun deleteHistoryDirectoryIfExists(dir: File): Boolean {
    return !dir.exists() || dir.deleteRecursively()
}
