package agentdock.acp

import com.intellij.icons.AllIcons
import com.intellij.openapi.fileTypes.FileTypeManager
import com.intellij.openapi.project.Project
import com.intellij.openapi.vfs.LocalFileSystem
import com.intellij.psi.PsiManager
import com.intellij.util.IconUtil
import java.io.ByteArrayOutputStream
import java.util.Base64
import java.util.Collections
import javax.imageio.ImageIO
import javax.imageio.stream.MemoryCacheImageOutputStream

// Rendered at twice the 16px display size so icons stay sharp on HiDPI screens.
private const val ICON_PX = 32
private const val CACHE_LIMIT = 256

/**
 * Renders the icon the IDE shows for a file into a base64 PNG data URI.
 *
 * Resolution goes through [PsiManager] so icons contributed by IconProvider extensions
 * (Atom Material Icons and friends) are honoured, and [IconUtil.deepRetrieveIconNow]
 * unwraps the deferred icon those extensions return. The cache is keyed by file name
 * because such providers key on the name rather than on the individual file.
 */
internal class FileIconProvider(private val project: Project) {
    private val cache = Collections.synchronizedMap(
        object : LinkedHashMap<String, String>(16, 0.75f, true) {
            override fun removeEldestEntry(eldest: Map.Entry<String, String>) = size > CACHE_LIMIT
        }
    )

    fun invalidate() = cache.clear()

    /**
     * Must be called in a read action *off* the EDT. Icons that a provider derives from file
     * contents (Kotlin picks between class, object and plain-file icons that way) are deferred,
     * and a deferred icon asked to resolve on the EDT hands back its placeholder instead.
     */
    fun iconForPath(path: String): String? {
        if (project.isDisposed) return null
        val cacheKey = fileIconCacheKey(path) ?: return null
        cache[cacheKey]?.let { return it }
        val fileName = cacheKey.substringAfterLast('/')
        return renderIcon(resolveIcon(path, fileName))?.also { cache[cacheKey] = it }
    }

    private fun resolveIcon(path: String, fileName: String): javax.swing.Icon {
        val virtualFile = findVirtualFile(path)?.takeIf { it.isValid }
        val icon = virtualFile?.let { PsiManager.getInstance(project).findFile(it)?.getIcon(0) ?: it.fileType.icon }
            ?: FileTypeManager.getInstance().getFileTypeByFileName(fileName).icon
            ?: AllIcons.FileTypes.Any_type
        // Unwraps the deferred icon that IconProvider extensions return; only evaluates off the EDT.
        return IconUtil.deepRetrieveIconNow(icon)
    }

    private fun findVirtualFile(path: String) = runCatching {
        val fileSystem = LocalFileSystem.getInstance()
        val normalized = path.replace('\\', '/')
        fileSystem.findFileByPath(normalized)
            ?: project.basePath?.let { fileSystem.findFileByPath("${it.trimEnd('/', '\\')}/${normalized.trimStart('/')}") }
    }.getOrNull()

    private fun renderIcon(icon: javax.swing.Icon) = runCatching {
        val scaled = if (icon.iconHeight == ICON_PX) icon
        else IconUtil.scale(icon, null, ICON_PX.toFloat() / icon.iconHeight)
        val bytes = ByteArrayOutputStream()
        // An explicit memory-cached stream keeps ImageIO from spilling temp files to disk.
        MemoryCacheImageOutputStream(bytes).use { ImageIO.write(IconUtil.toBufferedImage(scaled), "png", it) }
        "data:image/png;base64," + Base64.getEncoder().encodeToString(bytes.toByteArray())
    }.getOrNull()
}

/**
 * Key a rendered icon is cached under, or null when [path] names no file. Keyed by the whole
 * path rather than the file name because providers derive the icon from file contents, so two
 * files sharing a name can legitimately differ. Separators are normalised because paths reach
 * us from agents on any platform.
 */
internal fun fileIconCacheKey(path: String): String? =
    path.trim().replace('\\', '/').takeIf { it.substringAfterLast('/').isNotBlank() }
