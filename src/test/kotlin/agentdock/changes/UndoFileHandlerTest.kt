package agentdock.changes

import com.intellij.openapi.project.Project
import agentdock.utils.LocalFilePathPolicy
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue
import java.lang.reflect.Proxy
import java.nio.file.Files

class UndoFileHandlerTest {

    @Test
    fun `path inside project is allowed`() {
        val projectDir = Files.createTempDirectory("agent-dock-project-").toFile()
        val file = projectDir.resolve("src/Main.kt")
        file.parentFile.mkdirs()
        file.writeText("fun main() = Unit")

        assertTrue(UndoFileHandler.isPathInsideProject(projectDir.path, file.path))
    }

    @Test
    fun `project directory itself is allowed`() {
        val projectDir = Files.createTempDirectory("agent-dock-project-").toFile()

        assertTrue(UndoFileHandler.isPathInsideProject(projectDir.path, projectDir.path))
    }

    @Test
    fun `sibling path with shared string prefix is rejected`() {
        val root = Files.createTempDirectory("agent-dock-root-").toFile()
        val projectDir = root.resolve("project")
        val siblingDir = root.resolve("project-other")
        val siblingFile = siblingDir.resolve("src/Main.kt")
        projectDir.mkdirs()
        siblingFile.parentFile.mkdirs()
        siblingFile.writeText("fun main() = Unit")

        assertFalse(UndoFileHandler.isPathInsideProject(projectDir.path, siblingFile.path))
    }

    @Test
    fun `parent traversal outside project is not inside project`() {
        val root = Files.createTempDirectory("agent-dock-root-").toFile()
        val projectDir = root.resolve("project")
        val outsideFile = root.resolve("outside.txt")
        projectDir.mkdirs()
        outsideFile.writeText("outside")

        val traversedPath = projectDir.resolve("../outside.txt").path

        assertFalse(UndoFileHandler.isPathInsideProject(projectDir.path, traversedPath))
    }

    @Test
    fun `external local files are intentionally addressable`() {
        val root = Files.createTempDirectory("agent-dock-root-").toFile()
        val projectDir = root.resolve("project")
        val outsideFile = root.resolve("outside.txt")
        projectDir.mkdirs()
        outsideFile.writeText("outside")

        val project = projectWithBasePath(projectDir.path)
        val resolved = LocalFilePathPolicy.resolve(project, outsideFile.absolutePath)

        assertEquals(outsideFile.canonicalPath, resolved.canonicalPath)
        assertFalse(resolved.isInsideProject)
        assertTrue(LocalFilePathPolicy.isRestorableLocalPath(resolved.canonicalPath))
    }

    @Test
    fun `relative traversal can intentionally address an external local file`() {
        val root = Files.createTempDirectory("agent-dock-root-").toFile()
        val projectDir = root.resolve("project")
        val outsideFile = root.resolve("outside.txt")
        projectDir.mkdirs()
        outsideFile.writeText("outside")

        val project = projectWithBasePath(projectDir.path)
        val traversedPath = "../outside.txt"
        val resolved = LocalFilePathPolicy.resolve(project, traversedPath)

        assertEquals(outsideFile.canonicalPath, resolved.canonicalPath)
        assertFalse(resolved.isInsideProject)
        assertTrue(LocalFilePathPolicy.isRestorableLocalPath(resolved.canonicalPath))
    }

    @Test
    fun `undo all intentionally restores a file outside project`() {
        val root = Files.createTempDirectory("agent-dock-root-").toFile()
        val projectDir = root.resolve("project")
        val outsideFile = root.resolve("outside.txt")
        projectDir.mkdirs()
        outsideFile.writeText("after")

        val project = projectWithBasePath(projectDir.path)
        val traversedPath = projectDir.resolve("../outside.txt").path

        val result = UndoFileHandler.undoAllFiles(
            project,
            listOf(Triple(traversedPath, "M", listOf(UndoOperation("before", "after"))))
        )

        assertTrue(result.success, result.toString())
        assertEquals("before", outsideFile.readText())
    }

    @Test
    fun `single file undo intentionally restores a file outside project`() {
        val root = Files.createTempDirectory("agent-dock-root-").toFile()
        val projectDir = root.resolve("project")
        val outsideFile = root.resolve("outside.txt")
        projectDir.mkdirs()
        outsideFile.writeText("after")

        val project = projectWithBasePath(projectDir.path)
        val traversedPath = projectDir.resolve("../outside.txt").path

        val result = UndoFileHandler.undoSingleFile(
            project,
            traversedPath,
            "M",
            listOf(UndoOperation("before", "after"))
        )

        assertTrue(result.success, result.toString())
        assertEquals("before", outsideFile.readText())
    }

    @Test
    fun `file stats are intentionally computed for a file outside project`() {
        val root = Files.createTempDirectory("agent-dock-root-").toFile()
        val projectDir = root.resolve("project")
        val outsideFile = root.resolve("outside.txt")
        projectDir.mkdirs()
        outsideFile.writeText("after\n")

        val project = projectWithBasePath(projectDir.path)
        val traversedPath = projectDir.resolve("../outside.txt").path

        val stats = AgentChangeCalculator.computeFileStats(
            project,
            traversedPath,
            "M",
            listOf(UndoOperation("before\n", "after\n"))
        )

        assertEquals(1, stats?.additions)
        assertEquals(1, stats?.deletions)
    }

    private fun projectWithBasePath(basePath: String): Project {
        return Proxy.newProxyInstance(
            Project::class.java.classLoader,
            arrayOf(Project::class.java)
        ) { proxy, method, args ->
            when (method.name) {
                "getBasePath" -> basePath
                "isDisposed" -> false
                "getName" -> "test-project"
                "toString" -> "Project($basePath)"
                "hashCode" -> System.identityHashCode(proxy)
                "equals" -> proxy === args?.getOrNull(0)
                else -> throw UnsupportedOperationException(method.name)
            }
        } as Project
    }
}
