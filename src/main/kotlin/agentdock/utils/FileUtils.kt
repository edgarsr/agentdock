package agentdock.utils

import java.io.File
import java.nio.file.AccessDeniedException
import java.nio.file.AtomicMoveNotSupportedException
import java.nio.file.Files
import java.nio.file.StandardCopyOption

/**
 * Writes text to a file atomically by first writing to a temporary file
 * and then moving it to the destination, replacing the original.
 * This prevents data corruption if the process crashes during write.
 */
fun File.atomicWriteText(text: String, charset: java.nio.charset.Charset = Charsets.UTF_8) {
    val parent = parentFile ?: File(".")
    parent.mkdirs()
    val tempPrefix = name.takeIf { it.length >= 3 } ?: "tmp"
    val tempPath = Files.createTempFile(parent.toPath(), "$tempPrefix.", ".tmp")
    var moved = false
    try {
        tempPath.toFile().writeText(text, charset)
        moveWithRetry(tempPath, toPath())
        moved = true
    } finally {
        if (!moved) {
            runCatching { Files.deleteIfExists(tempPath) }
        }
    }
}

private fun moveWithRetry(source: java.nio.file.Path, target: java.nio.file.Path) {
    var attempt = 0
    var lastAccessDenied: AccessDeniedException? = null
    while (attempt < 5) {
        try {
            try {
                Files.move(
                    source,
                    target,
                    StandardCopyOption.REPLACE_EXISTING,
                    StandardCopyOption.ATOMIC_MOVE
                )
            } catch (_: AtomicMoveNotSupportedException) {
                Files.move(
                    source,
                    target,
                    StandardCopyOption.REPLACE_EXISTING
                )
            }
            return
        } catch (error: AccessDeniedException) {
            lastAccessDenied = error
            attempt += 1
            Thread.sleep(25L * attempt)
        }
    }
    throw lastAccessDenied ?: AccessDeniedException(target.toString())
}
