package unified.llm.history

import com.intellij.openapi.diagnostic.Logger
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import unified.llm.acp.AcpAdapterConfig
import java.io.File
import java.nio.file.Path
import java.security.MessageDigest
import java.time.Instant

private val log = Logger.getInstance(UnifiedHistoryService::class.java)

@Serializable
data class SessionMeta(
    val sessionId: String,
    val adapterName: String,
    val modelId: String? = null,
    val modeId: String? = null,
    val projectPath: String,
    val title: String,
    val filePath: String,
    val customVariables: Map<String, String>? = null,
    val createdAt: Long = Instant.now().toEpochMilli(),
    val updatedAt: Long = Instant.now().toEpochMilli()
)

object UnifiedHistoryService {
    private fun hashSha256(value: String): String {
        val md = MessageDigest.getInstance("SHA-256")
        return md.digest(value.toByteArray()).joinToString("") { "%02x".format(it) }
    }

    private fun hashMd5(value: String): String {
        val md = MessageDigest.getInstance("MD5")
        return md.digest(value.toByteArray()).joinToString("") { "%02x".format(it) }
    }

    fun resolvePathTemplate(template: String, projectPath: String?, sessionId: String? = null, customVars: Map<String, String>? = null): String {
        val home = System.getProperty("user.home")
        val canonicalProject = projectPath?.takeIf { it.isNotBlank() }?.let {
            runCatching { File(it).canonicalPath }.getOrDefault(it)
        } ?: ""
        val normalizedProject = canonicalProject.replace("/", File.separator).replace("\\", File.separator)
        // Ensure consistent uppercase drive letter on Windows for hash stability
        val projectForHash = if (normalizedProject.length >= 2 && normalizedProject[1] == ':') {
            normalizedProject.substring(0, 1).uppercase() + normalizedProject.substring(1)
        } else {
            normalizedProject
        }
        
        val slug = projectForHash.replace(Regex("[^a-zA-Z0-9]"), "-")
        val hashSha256 = hashSha256(projectForHash)
        val hashMd5 = hashMd5(projectForHash)

        var result = template
            .replace("~", home)
            .replace("{projectPathSlug}", slug)
            .replace("{projectHashSha256}", hashSha256)
            .replace("{projectHashMd5}", hashMd5)
            .replace("{slug}", slug)
            .replace("{hash}", hashSha256)
            .replace("{sessionId}", sessionId ?: "")

        // Apply custom variables
        customVars?.forEach { (key, value) ->
            result = result.replace("{$key}", value)
        }

        return result
            .replace("/", File.separator)
            .replace("\\", File.separator)
    }

    private fun buildGlobRegex(glob: String): Regex {
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

    private fun findMatchingFiles(templatePath: String): List<File> {
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

        val matcher = buildGlobRegex(relativePattern)
        val rootNioPath: Path = rootDir.toPath()
        return rootDir.walkTopDown()
            .filter { it.isFile }
            .filter { file ->
                val relative = rootNioPath.relativize(file.toPath()).toString().replace("\\", "/")
                matcher.matches(relative)
            }
            .toList()
    }

    suspend fun getHistoryList(projectPath: String?): List<SessionMeta> = withContext(Dispatchers.IO) {
        val result = mutableListOf<SessionMeta>()
        val cleanProjectPath = projectPath?.takeIf { it.isNotBlank() && it != "undefined" && it != "null" } ?: ""

        val adapters = runCatching { AcpAdapterConfig.getAllAdapters() }.getOrElse {
            log.warn("Failed to read adapters config", it)
            return@withContext emptyList()
        }

        adapters.values.forEach { adapter ->
            val historyConfig = adapter.historyConfig ?: return@forEach
            val parser = HistoryParserRegistry.getParser(historyConfig.parserStrategy) ?: return@forEach

            val resolved = resolvePathTemplate(historyConfig.pathTemplate, cleanProjectPath)
            val files = findMatchingFiles(resolved)
            files.forEach { file ->
                val meta = runCatching { parser.parseMeta(file, adapter, cleanProjectPath) }.getOrNull()
                if (meta != null) result.add(meta)
            }
        }

        // Sort newest first, then distinctBy keeps the first (newest) occurrence of each session
        result.sortedByDescending { it.updatedAt }
            .distinctBy { "${it.adapterName}:${it.sessionId}" }
    }
    suspend fun deleteSession(meta: SessionMeta): Boolean = withContext(Dispatchers.IO) {
        try {
            log.info("Deleting session '${meta.sessionId}' from adapter '${meta.adapterName}'")
            
            // 1. Delete main session file
            val mainFile = File(meta.filePath)
            if (mainFile.exists()) {
                mainFile.delete()
                log.debug("Deleted main session file: ${meta.filePath}")
            }

            // 2. Cleanup associated directories/files from cleanupTemplates
            val adapter = runCatching { AcpAdapterConfig.getAdapterInfo(meta.adapterName) }.getOrNull()
            adapter?.historyConfig?.cleanupTemplates?.forEach { template ->
                val resolvedPath = resolvePathTemplate(template, meta.projectPath, meta.sessionId, meta.customVariables)
                val fileToDelete = File(resolvedPath)
                if (fileToDelete.exists()) {
                    if (fileToDelete.isDirectory) {
                        fileToDelete.deleteRecursively()
                    } else {
                        fileToDelete.delete()
                    }
                    log.debug("Cleaned up: $resolvedPath")
                }
            }
            true
        } catch (e: Exception) {
            log.warn("Failed to delete session '${meta.sessionId}'", e)
            false
        }
    }
}
