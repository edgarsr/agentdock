package agentdock.acp

import com.github.difflib.DiffUtils
import com.github.difflib.UnifiedDiffUtils
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.io.File

object AcpPatchService {
    private val patchJson = Json { ignoreUnknownKeys = true }

    /**
     * Applies a unified diff patch to a target directory.
     * The patch must contain unified diff headers (--- a/path +++ b/path) to identify the file.
     * Uses fuzzy logic for context matching.
     * 
     * @param adapterRoot The root directory of the adapter (where paths in patch are relative to).
     * @param patchContent The unified diff content.
     * @return true if patch applied or safely skipped/already present.
     */
    fun applyPatch(adapterRoot: File, patchContent: String): Boolean {
        val trimmed = patchContent.trimStart()
        if (trimmed.startsWith("{")) {
            return applyStructuredPatch(adapterRoot, trimmed)
        }

        // Normalize line separators
        val patchLines = patchContent.lines()
        if (patchLines.isEmpty()) return false

        // Extract file path from unified diff header
        // Header format:
        // --- a/path/to/file.js
        // +++ b/path/to/file.js
        
        var targetPath: String? = null
        for (line in patchLines) {
            if (line.startsWith("--- ")) {
                // Usually "--- a/path" or "--- path"
                // Standard unified diff uses a/ and b/ prefixes, but sometimes not.
                // We'll strip "a/" or "b/" if present, or just take the path.
                val rawPath = line.substring(4).trim()
                targetPath = normalizePath(rawPath)
                if (targetPath != null) break
            }
            if (line.startsWith("+++ ")) {
                 val rawPath = line.substring(4).trim()
                 targetPath = normalizePath(rawPath)
                 if (targetPath != null) break
            }
        }

        if (targetPath == null) {
            return false
        }

        val targetFile = File(adapterRoot, targetPath).canonicalFile
        if (!targetFile.canonicalPath.startsWith(adapterRoot.canonicalPath + File.separator)) {
            return false
        }
        if (!targetFile.exists()) {
             return false
        }

        return applyPatchToFile(targetFile, patchLines)
    }

    private fun applyStructuredPatch(adapterRoot: File, patchContent: String): Boolean {
        return try {
            val root = patchJson.parseToJsonElement(patchContent).jsonObject
            val path = root["path"]?.jsonPrimitive?.content?.trim().orEmpty()
            val pathGlob = root["pathGlob"]?.jsonPrimitive?.content?.trim().orEmpty()
            val replace = root["replace"]?.jsonPrimitive?.content ?: return false
            val find = root["find"]?.jsonPrimitive?.content
            val findRegex = root["findRegex"]?.jsonPrimitive?.content
            val alreadyApplied = root["alreadyApplied"]?.jsonPrimitive?.content
            if (path.isBlank() && pathGlob.isBlank()) return false
            if (find == null && findRegex == null) return false

            val targetFiles = when {
                path.isNotBlank() -> listOf(File(adapterRoot, path).canonicalFile)
                else -> resolveGlobTargets(adapterRoot, pathGlob)
            }
            if (targetFiles.isEmpty()) return false

            targetFiles.all { targetFile ->
                applyStructuredPatchToFile(targetFile, adapterRoot, replace, find, findRegex, alreadyApplied)
            }
        } catch (_: Exception) {
            false
        }
    }

    private fun applyStructuredPatchToFile(
        targetFile: File,
        adapterRoot: File,
        replace: String,
        find: String?,
        findRegex: String?,
        alreadyApplied: String?
    ): Boolean {
        if (!targetFile.canonicalPath.startsWith(adapterRoot.canonicalPath + File.separator)) return false
        if (!targetFile.exists()) return false

        val currentText = targetFile.readText()
        if (!alreadyApplied.isNullOrEmpty() && currentText.contains(alreadyApplied)) {
            return true
        }
        if (currentText.contains(replace)) return true

        if (findRegex != null) {
            val regex = Regex(findRegex, setOf(RegexOption.DOT_MATCHES_ALL))
            val match = regex.find(currentText) ?: return false
            targetFile.writeText(currentText.replaceRange(match.range, match.value.replace(regex, replace)))
            return true
        }

        if (find == null || !currentText.contains(find)) {
            return false
        }

        targetFile.writeText(currentText.replaceFirst(find, replace))
        return true
    }

    private fun resolveGlobTargets(adapterRoot: File, pathGlob: String): List<File> {
        val matcher = globToRegex(pathGlob)
        return adapterRoot.walkTopDown()
            .filter { it.isFile }
            .filter { file ->
                val relativePath = file.relativeTo(adapterRoot).invariantSeparatorsPath
                matcher.matches(relativePath)
            }
            .map { it.canonicalFile }
            .toList()
    }

    private fun globToRegex(glob: String): Regex {
        val normalized = glob.replace("\\", "/")
        val pattern = buildString {
            append("^")
            var index = 0
            while (index < normalized.length) {
                val current = normalized[index]
                when (current) {
                    '*' -> {
                        val isDoubleStar = index + 1 < normalized.length && normalized[index + 1] == '*'
                        if (isDoubleStar) {
                            append(".*")
                            index++
                        } else {
                            append("[^/]*")
                        }
                    }
                    '?' -> append("[^/]")
                    '.', '(', ')', '+', '|', '^', '$', '@', '%' , '{', '}', '[', ']' -> {
                        append("\\").append(current)
                    }
                    else -> append(current)
                }
                index++
            }
            append("$")
        }
        return Regex(pattern)
    }

    private fun normalizePath(rawPath: String): String? {
        // Heuristic: remove "a/" or "b/" prefix if it looks like a relative path
        // Also handle "dev/null" for file creations/deletions (not supported here yet)
        if (rawPath == "/dev/null") return null
        
        // Remove standard git prefixes
        if (rawPath.startsWith("a/")) return rawPath.substring(2)
        if (rawPath.startsWith("b/")) return rawPath.substring(2)
        
        return rawPath
    }

    private fun applyPatchToFile(targetFile: File, patchLines: List<String>): Boolean {
        try {
            val originalLines = targetFile.readLines()
            val patch = UnifiedDiffUtils.parseUnifiedDiff(patchLines)
            
            if (patch.deltas.isEmpty()) {
                return false
            }

            // Fuzzy application logic
            var currentText = originalLines.joinToString("\n")
            var modified = false
            
            for (delta in patch.deltas) {
                val sourceBlock = delta.source.lines.joinToString("\n")
                val targetBlock = delta.target.lines.joinToString("\n")
                
                if (currentText.contains(targetBlock)) {
                    continue // Already applied
                }
                
                if (currentText.contains(sourceBlock)) {
                    currentText = currentText.replaceFirst(sourceBlock, targetBlock)
                    modified = true
                } else {
                    return false
                }
            }
            
            if (modified) {
                 targetFile.writeText(currentText)
                 return true
            }
            
            return true 
        } catch (e: Exception) {
            return false
        }
    }
}
