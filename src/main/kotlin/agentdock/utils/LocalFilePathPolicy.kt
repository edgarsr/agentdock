package agentdock.utils

import com.intellij.openapi.project.Project
import java.io.File
import java.nio.file.Path

data class ResolvedLocalFilePath(
    val originalPath: String,
    val resolvedPath: String,
    val canonicalPath: String,
    val isInsideProject: Boolean
)

/**
 * Local files outside the IDE project are intentionally addressable by the plugin.
 * The project-boundary flag is metadata for callers that need it, not a permission check.
 */
object LocalFilePathPolicy {
    fun resolve(project: Project, filePath: String): ResolvedLocalFilePath {
        val resolvedPath = resolvePathText(project, filePath)
        val canonicalPath = runCatching { File(resolvedPath).canonicalPath }.getOrElse { resolvedPath }
        val isInsideProject = project.basePath
            ?.takeIf { it.isNotBlank() }
            ?.let { isInsideProject(it, canonicalPath) }
            ?: false

        return ResolvedLocalFilePath(
            originalPath = filePath,
            resolvedPath = resolvedPath,
            canonicalPath = canonicalPath,
            isInsideProject = isInsideProject
        )
    }

    fun isRestorableLocalPath(filePath: String): Boolean {
        if (filePath.isBlank()) return false
        return runCatching { File(filePath).canonicalPath.isNotBlank() }.getOrDefault(false)
    }

    fun isInsideProject(projectBase: String, filePath: String): Boolean {
        return try {
            val canonical = File(filePath).canonicalFile.toPath().normalize()
            val baseCanonical = File(projectBase).canonicalFile.toPath().normalize()
            canonical.isSameOrChildOf(baseCanonical)
        } catch (_: Exception) {
            false
        }
    }

    private fun resolvePathText(project: Project, filePath: String): String {
        val normalizedFilePath = filePath
        val base = project.basePath ?: return normalizedFilePath
        val inputFile = File(normalizedFilePath)
        return if (inputFile.isAbsolute) {
            runCatching { inputFile.canonicalPath }.getOrDefault(normalizedFilePath)
        } else {
            val baseFile = File(base)
            runCatching {
                File(baseFile, normalizedFilePath.replace('\\', '/')).canonicalPath
            }.getOrElse {
                File(baseFile, normalizedFilePath).absolutePath
            }
        }
    }

    private fun Path.isSameOrChildOf(base: Path): Boolean {
        return this == base || startsWith(base)
    }
}
