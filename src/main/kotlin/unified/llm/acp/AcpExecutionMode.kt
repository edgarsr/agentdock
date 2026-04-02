package unified.llm.acp

import unified.llm.settings.GlobalSettingsStore
import java.io.File
import java.util.Base64
import java.util.concurrent.TimeUnit

internal fun quoteUnixShellArg(value: String): String =
    "'" + value.replace("'", "'\"'\"'") + "'"

internal enum class AcpExecutionTarget {
    LOCAL,
    WSL
}

internal data class CommandResult(
    val exitCode: Int,
    val stdout: String,
    val stderr: String
)

internal object AcpExecutionMode {
    private const val RUNTIME_DIR_NAME = ".unified-llm"

    @Volatile private var cachedWslSupported: Boolean? = null
    @Volatile private var cachedWslDistributions: List<String>? = null

    fun isWindowsHost(): Boolean = System.getProperty("os.name").lowercase().contains("win")

    fun isWslSupportedHost(): Boolean {
        if (!isWindowsHost()) return false
        cachedWslSupported?.let { return it }
        return probeWslSupportNow()
    }

    fun probeWslSupportNow(): Boolean {
        if (!isWindowsHost()) {
            cachedWslSupported = false
            return false
        }
        val statusOk = runCatching {
            val process = ProcessBuilder("wsl.exe", "--status")
                .redirectErrorStream(true)
                .start()
            val finished = process.waitFor(5, TimeUnit.SECONDS)
            finished && process.exitValue() == 0
        }.getOrDefault(false)
        if (!statusOk) {
            cachedWslSupported = false
            cachedWslDistributions = emptyList()
            return false
        }
        val supported = listWslDistributions(refresh = true).isNotEmpty()
        cachedWslSupported = supported
        return supported
    }

    fun refreshWslSupportCache(): Boolean {
        return probeWslSupportNow()
    }

    fun resetWslRuntimeCaches() {
        cachedWslSupported = null
        cachedWslDistributions = null
    }

    fun listWslDistributions(refresh: Boolean = false): List<String> {
        if (!isWindowsHost()) return emptyList()
        if (!refresh) cachedWslDistributions?.let { return it }
        val distributions = runCommand(
            listOf("wsl.exe", "--list", "--quiet"),
            timeoutSeconds = 5
        )?.takeIf { it.exitCode == 0 }
            ?.stdout
            ?.lineSequence()
            ?.map { it.replace("\u0000", "").trim() }
            ?.filter { it.isNotBlank() }
            ?.toList()
            ?: emptyList()
        cachedWslDistributions = distributions
        return distributions
    }

    fun selectedWslDistributionName(candidate: String? = null): String {
        val distributions = listWslDistributions()
        if (distributions.isEmpty()) return candidate?.trim().orEmpty()
        val trimmed = candidate?.trim().orEmpty()
        if (trimmed.isNotEmpty()) {
            distributions.firstOrNull { it == trimmed }?.let { return it }
        }
        val saved = GlobalSettingsStore.load().wslDistributionName.trim()
        if (saved.isNotEmpty()) {
            distributions.firstOrNull { it == saved }?.let { return it }
        }
        return distributions.first()
    }

    fun currentTarget(): AcpExecutionTarget {
        if (!isWindowsHost()) return AcpExecutionTarget.LOCAL
        val settings = GlobalSettingsStore.load()
        val supported = isWslSupportedHost()
        return if (settings.useWslForAcpAdapters && supported) {
            AcpExecutionTarget.WSL
        } else {
            AcpExecutionTarget.LOCAL
        }
    }

    fun localBaseRuntimeDir(): File = File(System.getProperty("user.home"), RUNTIME_DIR_NAME)

    fun localDependenciesDir(): File = File(localBaseRuntimeDir(), "dependencies")

    fun wslHomeDir(): String? {
        val result = runWslShell("printf %s \"\$HOME\"")
        return result
            ?.takeIf { it.exitCode == 0 }
            ?.stdout
            ?.trim()
            ?.takeIf { it.isNotBlank() }
    }

    fun wslBaseRuntimeDir(): String? {
        val home = wslHomeDir() ?: return null
        return "$home/$RUNTIME_DIR_NAME"
    }

    fun wslDependenciesDir(): String? {
        val base = wslBaseRuntimeDir() ?: return null
        return "$base/dependencies"
    }

    fun toWslPath(path: String?): String? {
        val raw = path?.trim()?.takeIf { it.isNotEmpty() } ?: return null
        val windowsDrive = Regex("^([A-Za-z]):[\\\\/](.*)$").matchEntire(raw)
        if (windowsDrive != null) {
            val drive = windowsDrive.groupValues[1].lowercase()
            val rest = windowsDrive.groupValues[2].replace("\\", "/")
            return "/mnt/$drive/$rest"
        }
        return raw.replace("\\", "/")
    }

    fun wslPathToWindowsUnc(path: String?, distroName: String? = null): String? {
        val raw = path?.trim()?.takeIf { it.isNotEmpty() } ?: return null
        val normalizedPath = raw.replace("\\", "/")
        if (!normalizedPath.startsWith("/")) return raw
        val distro = (distroName ?: selectedWslDistributionName()).trim().takeIf { it.isNotEmpty() } ?: return null
        val uncPath = normalizedPath.removePrefix("/").replace("/", "\\")
        return "\\\\wsl.localhost\\$distro\\$uncPath"
    }

    fun buildWslExecCommand(command: List<String>, cwd: String? = null): List<String> {
        require(command.isNotEmpty()) { "WSL command must not be empty" }
        val distro = selectedWslDistributionName().takeIf { it.isNotBlank() }
        val shellCommand = buildString {
            cwd?.takeIf { it.isNotBlank() }?.let {
                append("cd ")
                append(quoteUnixShellArg(it))
                append(" && ")
            }
            append("exec ")
            append(command.joinToString(" ") { quoteUnixShellArg(it) })
        }
        return buildList {
            add("wsl.exe")
            if (distro != null) {
                add("-d")
                add(distro)
            }
            add("--exec")
            add("bash")
            add("-lic")
            add(shellCommand)
        }
    }

    fun runWslExec(
        command: List<String>,
        cwd: String? = null,
        stdin: String? = null,
        timeoutSeconds: Long = 30
    ): CommandResult? {
        return runCommand(buildWslExecCommand(command, cwd), stdin, timeoutSeconds)
    }

    fun runWslShell(
        script: String,
        cwd: String? = null,
        stdin: String? = null,
        timeoutSeconds: Long = 30
    ): CommandResult? {
        val distro = selectedWslDistributionName().takeIf { it.isNotBlank() }
        val shellCommand = buildString {
            cwd?.takeIf { it.isNotBlank() }?.let {
                append("cd ")
                append(quoteUnixShellArg(it))
                append(" && ")
            }
            append(script)
        }
        val encoded = Base64.getEncoder().encodeToString(shellCommand.toByteArray(Charsets.UTF_8))
        // Source the decoded script inside the same login shell so PATH/NVM
        // initialization stays available without spawning a fresh non-login bash.
        val wrapper = "printf %s ${quoteUnixShellArg(encoded)} | base64 -d | source /dev/stdin"
        val result = runCommand(
            buildList {
                add("wsl.exe")
                if (distro != null) {
                    add("-d")
                    add(distro)
                }
                add("--exec")
                add("bash")
                add("-lic")
                add(wrapper)
            },
            stdin,
            timeoutSeconds
        )
        return result
    }

    fun runCommand(
        command: List<String>,
        stdin: String? = null,
        timeoutSeconds: Long = 30
    ): CommandResult? {
        return runCatching {
            val process = ProcessBuilder(command)
                .redirectErrorStream(false)
                .start()

            if (stdin != null) {
                process.outputStream.bufferedWriter().use { writer -> writer.write(stdin) }
            } else {
                process.outputStream.close()
            }

            val stdout = StringBuilder()
            val stderr = StringBuilder()
            val outThread = Thread {
                process.inputStream.bufferedReader().useLines { lines ->
                    lines.forEach { line -> stdout.appendLine(line) }
                }
            }.apply { isDaemon = true; start() }
            val errThread = Thread {
                process.errorStream.bufferedReader().useLines { lines ->
                    lines.forEach { line -> stderr.appendLine(line) }
                }
            }.apply { isDaemon = true; start() }

            val finished = process.waitFor(timeoutSeconds, TimeUnit.SECONDS)
            if (!finished) {
                process.destroyForcibly()
                outThread.join(1000)
                errThread.join(1000)
                CommandResult(-1, stdout.toString(), stderr.toString())
            } else {
                outThread.join(1000)
                errThread.join(1000)
                CommandResult(process.exitValue(), stdout.toString(), stderr.toString())
            }
        }.getOrNull()
    }
}
