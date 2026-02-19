package unified.llm.acp

import com.github.difflib.DiffUtils
import com.github.difflib.UnifiedDiffUtils
import com.intellij.openapi.diagnostic.Logger
import java.io.File

object AcpPatchService {
    private val log = Logger.getInstance(AcpPatchService::class.java)

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
            log.warn("Could not determine target file from patch header in ${adapterRoot.name}. Content starts with: ${patchLines.take(3)}")
            return false
        }

        val targetFile = File(adapterRoot, targetPath)
        if (!targetFile.exists()) {
             log.warn("Patch target file not found: ${targetFile.absolutePath} (path from header: $targetPath)")
             return false
        }

        return applyPatchToFile(targetFile, patchLines)
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
                log.warn("No deltas found in patch for ${targetFile.name}")
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
                    log.warn("Failed to apply a hunk in ${targetFile.name}: Context not found.")
                    return false
                }
            }
            
            if (modified) {
                 targetFile.writeText(currentText)
                 log.info("Successfully applied patch to ${targetFile.name}")
                 return true
            }
            
            return true 
        } catch (e: Exception) {
            log.warn("Failed to apply patch to ${targetFile.name}: ${e.message}")
            return false
        }
    }
}
