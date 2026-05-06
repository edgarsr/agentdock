package agentdock.acp

import java.io.File
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.CancellationException

object AcpNpmInstaller {
    internal fun downloadFromNpm(
        targetDir: File,
        adapterInfo: AcpAdapterConfig.AdapterInfo,
        statusCallback: ((String) -> Unit)? = null,
        cancellation: AcpAdapterInstallCancellation? = null
    ): Boolean {
        return try {
            cancellation?.throwIfCancelled()
            val nodeRuntime = AcpNodeRuntimeResolver.resolveOrInstall(statusCallback, cancellation)
            if (nodeRuntime == null) {
                statusCallback?.invoke("Error: Node.js is required")
                return false
            }

            val packageName = adapterInfo.distribution.packageName
                ?: throw IllegalStateException("Adapter '${adapterInfo.id}' missing distribution.packageName in configuration")
            val version = adapterInfo.distribution.version

            statusCallback?.invoke("Installing $packageName@$version via npm...")
            File(targetDir, "package.json").writeText("""{"name":"${adapterInfo.id}-runtime","private":true}""")

            val installProc = ProcessBuilder(nodeRuntime.npm, "install", "$packageName@$version", "--no-save", "--no-package-lock")
                .directory(targetDir)
                .redirectErrorStream(true)
            AcpNodeRuntimeResolver.applyTo(installProc, nodeRuntime)
            val startedInstallProc = installProc
                .start()
            cancellation?.register(startedInstallProc)

            val recentOutput = java.util.Collections.synchronizedList(mutableListOf<String>())
            val outputDrainer = Thread {
                startedInstallProc.inputStream.bufferedReader().useLines { lines ->
                    lines.forEach { line ->
                        val trimmed = line.trim()
                        if (trimmed.isNotBlank()) {
                            recentOutput.add(trimmed)
                            if (recentOutput.size > 12) recentOutput.removeAt(0)
                        }
                        if (trimmed.contains("added", ignoreCase = true)
                            || line.contains("tarball", ignoreCase = true)
                            || line.contains("install", ignoreCase = true)
                        ) {
                            statusCallback?.invoke("NPM: $trimmed")
                        }
                    }
                }
            }
            outputDrainer.isDaemon = true
            outputDrainer.start()

            try {
                while (true) {
                    cancellation?.throwIfCancelled()
                    if (startedInstallProc.waitFor(250, TimeUnit.MILLISECONDS)) break
                }
            } catch (e: CancellationException) {
                startedInstallProc.destroyForcibly()
                outputDrainer.join(1000)
                throw e
            } finally {
                cancellation?.unregister(startedInstallProc)
            }

            cancellation?.throwIfCancelled()
            outputDrainer.join(1000)
            val exitCode = startedInstallProc.exitValue()
            if (exitCode == 0) {
                true
            } else {
                val detail = recentOutput.joinToString("\n").ifBlank { "npm install failed" }
                statusCallback?.invoke("Error: npm install failed with exit code $exitCode\n$detail")
                false
            }
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            statusCallback?.invoke("Error: ${e.message ?: "npm install failed"}")
            false
        }
    }

}
