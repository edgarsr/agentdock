package unified.llm.acp

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.coroutines.delay
import java.io.File
import java.util.concurrent.TimeUnit
import java.util.concurrent.ConcurrentHashMap

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

    /**
     * Checks if an adapter is currently in the process of logging in.
     */
    fun isAuthenticating(adapterId: String): Boolean = activeLoginCounts.containsKey(adapterId)

    /**
     * Checks the authentication status for a given adapter.
     */
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
        } catch (e: Exception) {
            return AuthStatus(false, method = "error")
        }

        val authConfig = adapterInfo.authConfig ?: return AuthStatus(false, method = "none")
        
        // 1. Try Command-based status check if statusArgs are present
        if (authConfig.statusArgs.isNotEmpty()) {
            try {
                val script = resolveScriptPath(adapterInfo, authConfig.authScript)
                if (script != null) {
                    val cmd = mutableListOf<String>()
                    val os = System.getProperty("os.name").lowercase()
                    
                    if (os.contains("win") && (script.first.endsWith(".cmd", true) || script.first.endsWith(".bat", true))) {
                        cmd.addAll(listOf("cmd.exe", "/c", script.first))
                    } else {
                        if (script.second) cmd.add(findNodeExecutable())
                        cmd.add(script.first)
                    }
                    cmd.addAll(authConfig.statusArgs)
                    
                    val proc = ProcessBuilder(cmd).redirectErrorStream(true).start()
                    val output = proc.inputStream.bufferedReader().use { it.readText() }
                    val finished = proc.waitFor(5, TimeUnit.SECONDS)
                    if (!finished) {
                        proc.destroyForcibly()
                    }

                    val isAuthenticated = (output.contains("Logged in", ignoreCase = true) && !output.contains("Not logged in", ignoreCase = true)) ||
                                        output.contains("Authenticated", ignoreCase = true) ||
                                        (output.contains("account", ignoreCase = true) && !output.contains("no account", ignoreCase = true))

                    return AuthStatus(isAuthenticated, method = "command")
                }
            } catch (e: Exception) {
            }
        }

        // 2. Fall back to File-based status check
        val authPath = authConfig.authPath ?: return AuthStatus(false, method = "none")
        val resolvedPath = resolvePath(authPath)
        val file = File(resolvedPath)
        
        return if (file.exists() && file.isFile) {
            AuthStatus(true, resolvedPath, "file")
        } else {
            AuthStatus(false, resolvedPath, "none")
        }
    }

    private fun resolveScriptPath(adapterInfo: AcpAdapterConfig.AdapterInfo, authScript: String?): Pair<String, Boolean>? {
        val downloadPath = AcpAdapterPaths.getDownloadPath(adapterInfo.name)
        val adapterRoot = if (downloadPath.isNotEmpty()) File(downloadPath) else null
        
        if (authScript?.startsWith("@tool:") == true) {
            val toolId = authScript.substring(6)
            val tool = adapterInfo.supportingTools.find { it.id == toolId } ?: return null
            val toolDir = File(AcpAdapterPaths.getDependenciesDir(), tool.targetDir ?: tool.id)
            val os = System.getProperty("os.name").lowercase()
            val binName = if (os.contains("win")) tool.binaryName?.win else tool.binaryName?.unix
            if (binName == null) return null
            val path = File(toolDir, binName).absolutePath
            val useNode = binName.endsWith(".js") || binName.endsWith(".mjs")
            return path to useNode
        } else {
            if (adapterRoot == null) return null
            var relPath = authScript ?: adapterInfo.launchPath

            // Handle npm bin wrappers: on Windows, .bin scripts have .cmd extension
            if (relPath.contains("node_modules/.bin/") || relPath.contains("node_modules\\.bin\\")) {
                val os = System.getProperty("os.name").lowercase()
                if (os.contains("win") && !relPath.endsWith(".cmd") && !relPath.endsWith(".bat")) {
                    relPath += ".cmd"
                }
            }

            val path = File(adapterRoot, relPath).absolutePath
            val useNode = relPath.endsWith(".js") || relPath.endsWith(".mjs")
            return path to useNode
        }
    }

    /**
     * Performs login for the given adapter.
     */
    suspend fun login(
        adapterName: String, 
        projectPath: String? = null,
        onProgress: (suspend () -> Unit)? = null
    ): Boolean = withContext(Dispatchers.IO) {
        try {
            val adapterInfo = AcpAdapterConfig.getAdapterInfo(adapterName)
            val authConfig = adapterInfo.authConfig ?: return@withContext false

            // authScript or launchPath is required for login
            if (authConfig.authScript == null && authConfig.loginArgs.isEmpty()) {
                return@withContext false
            }

            val loginArgs = authConfig.loginArgs

            val downloadPath = AcpAdapterPaths.getDownloadPath(adapterName)
            val adapterRoot = if (downloadPath.isNotEmpty()) File(downloadPath) else null

            val script = resolveScriptPath(adapterInfo, authConfig.authScript) ?: return@withContext false
            val scriptToRun = script.first
            val useNode = script.second
            val nodeExe = if (useNode) findNodeExecutable() else ""
            
            val os = System.getProperty("os.name").lowercase()
            val process = when {
                os.contains("win") -> {
                    val tempBat = File.createTempFile("acp-login-", ".bat")
                    val argsStr = loginArgs.joinToString(" ")
                    val cdCmd = if (projectPath != null) "cd /d \"$projectPath\"" else ""
                    val runCmd = if (useNode) "\"$nodeExe\" \"$scriptToRun\"" else "\"$scriptToRun\""
                    val batContent = """
                        @echo off
                        title ${adapterInfo.displayName} Login
                        $cdCmd
                        echo Starting login for ${adapterInfo.displayName}...
                        echo.
                        $runCmd $argsStr
                        echo.
                        if %ERRORLEVEL% EQU 0 (
                            echo Login completed successfully!
                        ) else (
                            echo Login failed with error code %ERRORLEVEL%
                        )
                        echo.
                        echo You can close this window now.
                        pause
                        del "%~f0"
                    """.trimIndent()
                    tempBat.writeText(batContent)

                    val proc = ProcessBuilder("cmd.exe", "/c", "start", "/wait", tempBat.absolutePath).start()
                    proc
                }
                os.contains("mac") -> {
                    val argsStr = loginArgs.joinToString(" ")
                    val cdCmd = if (projectPath != null) "cd \\\"$projectPath\\\" && " else ""
                    val runCmd = if (useNode) "\\\"$nodeExe\\\" \\\"$scriptToRun\\\"" else "\\\"$scriptToRun\\\""
                    val scriptApple = "tell application \"Terminal\" to do script \"$cdCmd $runCmd $argsStr\""
                    ProcessBuilder("osascript", "-e", scriptApple).start()
                }
                else -> {
                    val tempSh = File.createTempFile("acp-login-", ".sh")
                    val argsStr = loginArgs.joinToString(" ")
                    val cdCmd = if (projectPath != null) "cd \"$projectPath\"" else ""
                    val runCmd = if (useNode) "\"$nodeExe\" \"$scriptToRun\"" else "\"$scriptToRun\""
                    val shContent = """
                        #!/bin/bash
                        echo "Starting login for ${adapterInfo.displayName}..."
                        $cdCmd
                        $runCmd $argsStr
                        echo ""
                        echo "Process finished. Press Enter to close this window."
                        read
                        rm -- "${tempSh.absolutePath}"
                    """.trimIndent()
                    tempSh.writeText(shContent)
                    tempSh.setExecutable(true)

                    val terminalEmulators = listOf(
                        listOf("x-terminal-emulator", "-e", tempSh.absolutePath),
                        listOf("gnome-terminal", "--", tempSh.absolutePath),
                        listOf("konsole", "-e", tempSh.absolutePath),
                        listOf("xfce4-terminal", "-e", tempSh.absolutePath),
                        listOf("lxterminal", "-e", tempSh.absolutePath),
                        listOf("xterm", "-e", tempSh.absolutePath)
                    )

                    var proc: Process? = null
                    for (cmd in terminalEmulators) {
                        try {
                            proc = ProcessBuilder(cmd).start()
                            break
                        } catch (e: Exception) {
                            continue
                        }
                    }

                    if (proc == null) {
                        val cmdBase = if (useNode) listOf(nodeExe, scriptToRun) else listOf(scriptToRun)
                        val cmdInput = cmdBase.toMutableList()
                        cmdInput.addAll(loginArgs)
                        val pb = ProcessBuilder(cmdInput)
                        if (adapterRoot != null) pb.directory(adapterRoot)
                        if (projectPath != null) pb.directory(File(projectPath))
                        pb.start()
                    } else {
                        proc
                    }
                }
            }
            
            // Poll for auth status update
            val startTime = System.currentTimeMillis()
            var lastPushTime = 0L
            while (System.currentTimeMillis() - startTime < 300_000) { // 5 min timeout
                val status = getAuthStatus(adapterName)
                if (status.authenticated) {
                    return@withContext true
                }
                
                if (System.currentTimeMillis() - lastPushTime > 3000) {
                     onProgress?.invoke()
                     lastPushTime = System.currentTimeMillis()
                }

                if (process != null && !process.isAlive) {
                    break
                }
                
                delay(2000)
            }
            false
        } catch (e: Exception) {
            false
        } finally {
            invalidateAuthCache(adapterName)
        }
    }

    suspend fun logout(adapterName: String): Boolean = withContext(Dispatchers.IO) {
        try {
            val adapterInfo = AcpAdapterConfig.getAdapterInfo(adapterName)
            val authConfig = adapterInfo.authConfig ?: return@withContext false
            val downloadPath = AcpAdapterPaths.getDownloadPath(adapterName)
            val adapterRoot = if (downloadPath.isNotEmpty()) File(downloadPath) else null

            // Run logout command if available (for server-side logout)
            if (authConfig.logoutArgs.isNotEmpty()) {
                val script = resolveScriptPath(adapterInfo, authConfig.authScript)
                if (script != null) {
                    val scriptToRun = script.first
                    val useNode = script.second

                    if (scriptToRun.isNotEmpty()) {
                        val cmd = mutableListOf<String>()
                        val os = System.getProperty("os.name").lowercase()

                        if (os.contains("win") && (scriptToRun.endsWith(".cmd", true) || scriptToRun.endsWith(".bat", true))) {
                            cmd.addAll(listOf("cmd.exe", "/c", scriptToRun))
                        } else {
                            if (useNode) cmd.add(findNodeExecutable())
                            cmd.add(scriptToRun)
                        }
                        cmd.addAll(authConfig.logoutArgs)

                        try {
                            val pb = ProcessBuilder(cmd)
                            if (adapterRoot != null) pb.directory(adapterRoot)
                            val proc = pb.start()
                            proc.waitFor(10, TimeUnit.SECONDS)
                        } catch (e: Exception) {
                        }
                    }
                }
            }

            // Always delete auth file to ensure local logout (even if command failed)
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
}
