package agentdock.acp

import com.intellij.icons.AllIcons
import com.intellij.openapi.project.Project
import com.intellij.openapi.vfs.LocalFileSystem
import com.intellij.openapi.vfs.VirtualFile
import com.intellij.psi.PsiManager
import com.intellij.util.IconUtil
import java.io.ByteArrayOutputStream
import java.io.File
import java.util.Base64
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicLong
import javax.imageio.ImageIO

private const val ICON_SIZE = 16

/**
 * Renders the icon IntelliJ resolves for a real project file to a base64 PNG
 * data URI. Resolving through [PsiManager] includes generic IconProviders
 * (such as Atom Material Icons), virtual-file providers, and icon patchers.
 */
internal class FileIconProvider(private val project: Project) {
    private val cache = ConcurrentHashMap<String, String>()
    private val epoch = AtomicLong()

    /** Must be called under a read action. */
    fun iconForPath(path: String): String? {
        if (project.isDisposed) return null
        val virtualFile = findVirtualFile(path)
        return virtualFile?.let(::iconForVirtualFile) ?: fallbackIcon(path)
    }

    /** Must be called under a read action. */
    fun iconForVirtualFile(virtualFile: VirtualFile): String? {
        if (project.isDisposed || !virtualFile.isValid) return null
        val cacheKey = "file:${virtualFile.url}"
        cache[cacheKey]?.let { return it }

        while (true) {
            val renderEpoch = epoch.get()
            val psiFile = PsiManager.getInstance(project).findFile(virtualFile)
            val icon = psiFile?.getIcon(0)
                ?: IconUtil.getIcon(virtualFile, 0, project)
                ?: virtualFile.fileType.icon
                ?: AllIcons.FileTypes.Any_type
            val dataUri = renderIcon(icon) ?: return null
            if (epoch.get() == renderEpoch) return cache.putIfAbsent(cacheKey, dataUri) ?: dataUri
        }
    }

    fun invalidate() {
        epoch.incrementAndGet()
        cache.clear()
    }

    private fun fallbackIcon(path: String): String? {
        val fileName = path.substringAfterLast('/').substringAfterLast('\\')
        val cacheKey = "fallback:$fileName"
        cache[cacheKey]?.let { return it }

        while (true) {
            val renderEpoch = epoch.get()
            val icon = com.intellij.openapi.fileTypes.FileTypeManager.getInstance()
                .getFileTypeByFileName(fileName)
                .icon
                ?: AllIcons.FileTypes.Any_type
            val dataUri = renderIcon(icon) ?: return null
            if (epoch.get() == renderEpoch) return cache.putIfAbsent(cacheKey, dataUri) ?: dataUri
        }
    }

    private fun findVirtualFile(path: String): VirtualFile? {
        if (path.isBlank()) return null
        val fileSystem = LocalFileSystem.getInstance()
        val normalizedPath = path.replace('\\', '/')
        if (File(normalizedPath).isAbsolute) return fileSystem.findFileByPath(normalizedPath)

        val projectPath = project.basePath?.trimEnd('/', '\\') ?: return fileSystem.findFileByPath(normalizedPath)
        return fileSystem.findFileByPath("$projectPath/$normalizedPath")
            ?: fileSystem.findFileByPath(normalizedPath)
    }

    private fun renderIcon(icon: javax.swing.Icon?): String? {
        if (icon == null) return null
        return runCatching {
            val image = IconUtil.toBufferedImage(IconUtil.toSize(icon, ICON_SIZE, ICON_SIZE))
            val pngOutputStream = ByteArrayOutputStream()
            ImageIO.write(image, "png", pngOutputStream)
            "data:image/png;base64," + Base64.getEncoder().encodeToString(pngOutputStream.toByteArray())
        }.getOrNull()
    }
}
