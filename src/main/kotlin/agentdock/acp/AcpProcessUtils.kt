package agentdock.acp

import java.io.File
import java.util.concurrent.TimeUnit

/**
 * Utility functions for managing OS processes related to ACP adapters.
 */
internal object AcpProcessUtils {

    private const val EXIT_TIMEOUT_SECONDS = 2L

    fun stopProcessesUsingAdapterRoot(adapterName: String, target: AcpExecutionTarget = AcpAdapterPaths.getExecutionTarget()) {
        val adapterRoot = runCatching {
            File(AcpAdapterPaths.getDownloadPath(adapterName, target))
        }.getOrNull() ?: return

        stopProcessesUsingAdapterRootPaths(listOf(adapterRoot))
    }

    // Enumerating the OS process table is expensive, so every root is matched against a single
    // enumeration instead of rescanning per root.
    fun stopProcessesUsingAdapterRootPaths(adapterRoots: Collection<File>, awaitExit: Boolean = true) {
        val normalizedRoots = adapterRoots
            .map(::normalizeRootPath)
            .filter { it.isNotBlank() }
            .distinct()
        if (normalizedRoots.isEmpty()) return

        val matched = ProcessHandle.allProcesses()
            .filter { handle -> pathsBelongToAnyRoot(processPaths(handle), normalizedRoots) }
            .toList()
        destroyProcessTrees(matched, awaitExit)
    }

    fun destroyProcessTree(handle: ProcessHandle) = destroyProcessTrees(listOf(handle))

    /**
     * Issuing the kill is what guarantees a process dies - once [ProcessHandle.destroyForcibly]
     * returns,
     * the outcome no longer depends on this JVM staying alive. Awaiting confirmation is only useful
     * to a caller that is about to reuse the adapter files, so [awaitExit] can be turned off on
     * shutdown paths where nothing consumes the confirmation.
     */
    fun destroyProcessTrees(handles: Collection<ProcessHandle>, awaitExit: Boolean = true) {
        if (handles.isEmpty()) return

        val exits = handles
            .flatMap { handle ->
                runCatching { handle.descendants().toList() }.getOrElse { emptyList() } + handle
            }
            .mapNotNull { process ->
                try {
                    val exit = if (awaitExit) process.onExit() else null
                    process.destroyForcibly()
                    exit
                } catch (_: Exception) {
                    null
                }
            }
        if (!awaitExit) return

        val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(EXIT_TIMEOUT_SECONDS)
        exits.forEach { exit ->
            val remaining = deadline - System.nanoTime()
            if (remaining <= 0) return
            try {
                exit.get(remaining, TimeUnit.NANOSECONDS)
            } catch (_: Exception) {
            }
        }
    }

    fun destroyProcessTreeIfUsingAdapterRoot(pid: Long, adapterRoot: File) {
        val normalizedRoot = normalizeRootPath(adapterRoot)
        if (normalizedRoot.isBlank()) return
        val handle = ProcessHandle.of(pid).orElse(null) ?: return
        if (pathsBelongToAnyRoot(processPaths(handle), listOf(normalizedRoot))) {
            destroyProcessTree(handle)
        }
    }

    private fun normalizeRootPath(adapterRoot: File): String =
        adapterRoot.absoluteFile.normalize().path.replace('\\', '/').lowercase().trimEnd('/')

    // Reading the command line is the expensive part of the match, so it is done once per process
    // and then compared against every root.
    private fun processPaths(handle: ProcessHandle): List<String> {
        val info = try {
            handle.info()
        } catch (_: Exception) {
            return emptyList()
        }

        val command = try {
            info.command().orElse(null)
        } catch (_: Exception) {
            null
        }
        val arguments = try {
            info.arguments().orElse(null)
        } catch (_: Exception) {
            null
        }
        return (listOfNotNull(command) + arguments.orEmpty()).mapNotNull(::normalizeProcessPath)
    }

    private fun pathsBelongToAnyRoot(paths: List<String>, normalizedRoots: List<String>): Boolean =
        paths.any { path -> normalizedRoots.any { root -> path == root || path.startsWith("$root/") } }

    private fun normalizeProcessPath(path: String): String? {
        val trimmed = path.trim().trim('"')
        if (trimmed.isEmpty()) return null
        return try {
            File(trimmed).absoluteFile.normalize().path.replace('\\', '/').lowercase()
        } catch (_: Exception) {
            null
        }
    }
}
