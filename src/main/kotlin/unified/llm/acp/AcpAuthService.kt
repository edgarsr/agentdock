package unified.llm.acp

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext
import java.io.File
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit

object AcpAuthService {

    private val activeLoginCounts = ConcurrentHashMap<String, Int>()

    private data class CachedAuthStatus(val status: AuthStatus, val timestamp: Long)
    private val authStatusCache = ConcurrentHashMap<String, CachedAuthStatus>()
    private const val AUTH_CACHE_TTL_MS = 5_000L

    fun invalidateAuthCache(adapterName: String) {
        authStatusCache.remove(adapterName)
    }

    fun incrementActive(adapterId: String) {
        activeLoginCounts.compute(adapterId) { _, count -> (count ?: 0) + 1 }
    }

    fun decrementActive(adapterId: String) {
        activeLoginCounts.compute(adapterId) { _, count ->
            val newCount = (count ?: 0) - 1
            if (newCount <= 0) null else newCount
        }
    }

    data class AuthStatus(
        val authenticated: Boolean,
        val authPath: String? = null,
        val method: String = "none"
    )

    fun isAuthenticating(adapterId: String): Boolean = activeLoginCounts.containsKey(adapterId)

    fun getAuthStatus(adapterName: String): AuthStatus {
        val cached = authStatusCache[adapterName]
        if (cached != null && System.currentTimeMillis() - cached.timestamp < AUTH_CACHE_TTL_MS) {
            return cached.status
        }

        val result = getAuthStatusUncached(adapterName)
        authStatusCache[adapterName] = CachedAuthStatus(result, System.currentTimeMillis())
        return result
    }

    private fun getAuthStatusUncached(adapterName: String): AuthStatus {
        val adapterInfo = try {
            AcpAdapterConfig.getAdapterInfo(adapterName)
        } catch (_: Exception) {
            return AuthStatus(false, method = "error")
        }

        val authConfig = adapterInfo.authConfig ?: return AuthStatus(false, method = "none")

        if (authConfig.statusArgs.isNotEmpty()) {
            try {
                val cmd = buildCommand(adapterInfo, authConfig, authConfig.statusArgs) ?: emptyList()
                if (cmd.isNotEmpty()) {
                    val proc = ProcessBuilder(cmd)
                        .directory(resolveWorkingDir(adapterInfo))
                        .redirectErrorStream(true)
                        .start()
                    val output = proc.inputStream.bufferedReader().use { it.readText() }
                    val finished = proc.waitFor(15, TimeUnit.SECONDS)
                    if (!finished) {
                        proc.destroyForcibly()
                        return AuthStatus(false, method = "command-timeout")
                    }

                    val isAuthenticated =
                        output.contains("\"loggedIn\": true", ignoreCase = true) ||
                        (output.contains("Logged in", ignoreCase = true) && !output.contains("Not logged in", ignoreCase = true)) ||
                            output.contains("Authenticated", ignoreCase = true) ||
                            (output.contains("account", ignoreCase = true) && !output.contains("no account", ignoreCase = true))

                    return AuthStatus(
                        authenticated = isAuthenticated,
                        authPath = resolveExistingAuthPath(authConfig),
                        method = "command"
                    )
                }
            } catch (_: Exception) {
            }
        }

        val authPath = authConfig.authPath ?: return AuthStatus(false, method = "none")
        val resolvedPath = resolvePath(authPath)
        val file = File(resolvedPath)

        return if (file.exists() && file.isFile) {
            AuthStatus(true, resolvedPath, "file")
        } else {
            AuthStatus(false, resolvedPath, "none")
        }
    }

    suspend fun login(
        adapterName: String,
        projectPath: String? = null,
        onProgress: (suspend () -> Unit)? = null
    ): Boolean = withContext(Dispatchers.IO) {
        try {
            val adapterInfo = AcpAdapterConfig.getAdapterInfo(adapterName)
            val authConfig = adapterInfo.authConfig ?: return@withContext false
            val loginArgs = authConfig.loginArgs
            if (loginArgs.isEmpty()) {
                return@withContext false
            }

            val cmd = buildCommand(adapterInfo, authConfig, loginArgs) ?: return@withContext false
            val process = ProcessBuilder(cmd)
                .directory(resolveWorkingDir(adapterInfo, projectPath))
                .redirectErrorStream(true)
                .start()

            // Drain stdout/stderr so the process cannot block on a full buffer.
            Thread {
                try {
                    process.inputStream.bufferedReader().use { it.readText() }
                } catch (_: Exception) {
                }
            }.apply { isDaemon = true; name = "acp-login-drain-$adapterName" }.start()

            val startTime = System.currentTimeMillis()
            var lastPushTime = 0L
            while (System.currentTimeMillis() - startTime < 300_000L) {
                if (System.currentTimeMillis() - lastPushTime > 3000L) {
                    onProgress?.invoke()
                    lastPushTime = System.currentTimeMillis()
                }

                if (!process.isAlive) {
                    invalidateAuthCache(adapterName)
                    return@withContext getAuthStatus(adapterName).authenticated
                }

                delay(1000L)
            }

            process.destroyForcibly()
            invalidateAuthCache(adapterName)
            getAuthStatus(adapterName).authenticated
        } catch (_: Exception) {
            false
        } finally {
            invalidateAuthCache(adapterName)
        }
    }

    suspend fun logout(adapterName: String): Boolean = withContext(Dispatchers.IO) {
        try {
            val adapterInfo = AcpAdapterConfig.getAdapterInfo(adapterName)
            val authConfig = adapterInfo.authConfig ?: return@withContext false

            if (authConfig.logoutArgs.isNotEmpty()) {
                val cmd = buildCommand(adapterInfo, authConfig, authConfig.logoutArgs)
                if (!cmd.isNullOrEmpty()) {
                    try {
                        val proc = ProcessBuilder(cmd)
                            .directory(resolveWorkingDir(adapterInfo))
                            .redirectErrorStream(true)
                            .start()
                        proc.inputStream.bufferedReader().use { it.readText() }
                        proc.waitFor(15, TimeUnit.SECONDS)
                    } catch (_: Exception) {
                    }
                }
            }

            val authPath = authConfig.authPath
            if (authPath != null) {
                val resolved = resolvePath(authPath)
                val file = File(resolved)
                if (file.exists()) {
                    file.delete()
                }
            }
            true
        } finally {
            invalidateAuthCache(adapterName)
        }
    }

    private fun buildCommand(
        adapterInfo: AcpAdapterConfig.AdapterInfo,
        authConfig: AcpAdapterConfig.AuthConfig,
        args: List<String>
    ): List<String>? {
        val baseCommand = resolveBaseCommand(adapterInfo, authConfig) ?: return null
        return baseCommand + args
    }

    private fun resolveBaseCommand(
        adapterInfo: AcpAdapterConfig.AdapterInfo,
        authConfig: AcpAdapterConfig.AuthConfig
    ): List<String>? {
        if (authConfig.command.isNotEmpty()) {
            return authConfig.command.toMutableList().also { cmd ->
                val os = System.getProperty("os.name").lowercase()
                if (os.contains("win")) {
                    val first = cmd.firstOrNull().orEmpty()
                    if (first.equals("npx", ignoreCase = true)) {
                        cmd[0] = "npx.cmd"
                    } else if (first.equals("npm", ignoreCase = true)) {
                        cmd[0] = "npm.cmd"
                    }
                }
            }
        }

        val script = resolveScriptPath(adapterInfo, authConfig.authScript) ?: return null
        val cmd = mutableListOf<String>()
        val os = System.getProperty("os.name").lowercase()

        if (os.contains("win") && (script.first.endsWith(".cmd", true) || script.first.endsWith(".bat", true))) {
            cmd.addAll(listOf("cmd.exe", "/c", script.first))
        } else {
            if (script.second) cmd.add(findNodeExecutable())
            cmd.add(script.first)
        }
        return cmd
    }

    private fun resolveScriptPath(
        adapterInfo: AcpAdapterConfig.AdapterInfo,
        authScript: String?
    ): Pair<String, Boolean>? {
        val downloadPath = AcpAdapterPaths.getDownloadPath(adapterInfo.id)
        val adapterRoot = if (downloadPath.isNotEmpty()) File(downloadPath) else null
        if (adapterRoot == null) return null

        if (authScript.isNullOrBlank()) {
            val file = AcpAdapterPaths.resolveLaunchFile(adapterRoot, adapterInfo) ?: return null
            if (!file.isFile) return null
            val path = file.absolutePath
            val useNode = path.endsWith(".js") || path.endsWith(".mjs")
            return path to useNode
        }

        var relPath = authScript
        if (relPath.contains("node_modules/.bin/") || relPath.contains("node_modules\\.bin\\")) {
            val os = System.getProperty("os.name").lowercase()
            if (os.contains("win") && !relPath.endsWith(".cmd") && !relPath.endsWith(".bat")) {
                relPath += ".cmd"
            }
        }

        val explicitFile = File(relPath)
        if (explicitFile.isAbsolute && explicitFile.isFile) {
            val path = explicitFile.absolutePath
            val useNode = path.endsWith(".js") || path.endsWith(".mjs")
            return path to useNode
        }

        val file = File(adapterRoot, relPath)
        if (!file.isFile) return null
        val path = file.absolutePath
        val useNode = relPath.endsWith(".js") || relPath.endsWith(".mjs")
        return path to useNode
    }

    private fun resolveWorkingDir(
        adapterInfo: AcpAdapterConfig.AdapterInfo,
        projectPath: String? = null
    ): File? {
        if (!projectPath.isNullOrBlank()) {
            return File(projectPath)
        }
        val downloadPath = AcpAdapterPaths.getDownloadPath(adapterInfo.id)
        return downloadPath.takeIf { it.isNotBlank() }?.let(::File)
    }

    private fun findNodeExecutable(): String {
        return if (System.getProperty("os.name").lowercase().contains("win")) "node.exe" else "node"
    }

    private fun resolvePath(path: String): String {
        var result = path
        if (result.startsWith("~")) {
            val home = System.getProperty("user.home")
            result = result.replaceFirst("~", home)
        }
        val envMap = System.getenv()
        if (System.getProperty("os.name").lowercase().contains("win")) {
            val regex = "%([^%]+)%".toRegex()
            result = regex.replace(result) { match ->
                envMap[match.groupValues[1]] ?: match.value
            }
        } else {
            val regex = "\\\$([a-zA-Z_][a-zA-Z0-9_]*)".toRegex()
            result = regex.replace(result) { match ->
                envMap[match.groupValues[1]] ?: match.value
            }
        }
        return File(result).absolutePath
    }

    private fun resolveExistingAuthPath(authConfig: AcpAdapterConfig.AuthConfig): String? {
        val configured = authConfig.authPath ?: return null
        val resolved = resolvePath(configured)
        return resolved.takeIf { File(it).isFile }
    }
}
