package agentdock.utils

import com.intellij.openapi.project.Project
import java.nio.file.Path
import java.nio.file.Paths

fun toProjectRelativePath(project: Project, filePath: String): String {
    val basePath = project.basePath ?: return filePath
    return try {
        val base = Paths.get(basePath).normalize()
        val file = Paths.get(filePath).normalize()
        if (file.startsWith(base)) {
            base.relativize(file).invariantSeparatorsPathString()
        } else {
            file.invariantSeparatorsPathString()
        }
    } catch (_: Exception) {
        filePath.replace('\\', '/')
    }
}

private fun Path.invariantSeparatorsPathString(): String = toString().replace('\\', '/')
