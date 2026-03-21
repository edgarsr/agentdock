package unified.llm.settings

import unified.llm.acp.AcpAdapterPaths
import java.io.BufferedInputStream
import java.io.File
import java.io.FileOutputStream
import java.net.URI
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.nio.file.Files
import java.nio.file.StandardCopyOption
import java.time.Duration
import java.util.Base64
import java.util.concurrent.TimeUnit
import java.util.zip.ZipInputStream

object WhisperFeatureManager {
    private const val FEATURE_ID = "whisper-transcription"
    private const val FEATURE_TITLE = "Whisper"
    private const val WINDOWS_ARCHIVE_URL = "https://github.com/ggml-org/whisper.cpp/releases/download/v1.8.4/whisper-bin-x64.zip"
    private const val MODEL_URL = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin?download=true"
    private const val MODEL_FILE_NAME = "ggml-base.bin"
    private const val BREW_FORMULA = "whisper-cpp"
    private val httpClient: HttpClient = HttpClient.newBuilder()
        .followRedirects(HttpClient.Redirect.ALWAYS)
        .connectTimeout(Duration.ofSeconds(30))
        .build()

    private fun featureRoot(): File = File(AcpAdapterPaths.getBaseRuntimeDir(), "features/whisper")
    private fun runtimeRoot(): File = File(featureRoot(), "runtime")
    private fun modelRoot(): File = File(featureRoot(), "models")
    private fun modelFile(): File = File(modelRoot(), MODEL_FILE_NAME)
    fun featureStorageRoot(): File = featureRoot()

    private fun isWindows(): Boolean = System.getProperty("os.name").lowercase().contains("win")
    private fun isMac(): Boolean = System.getProperty("os.name").lowercase().contains("mac")
    private fun isLinux(): Boolean = !isWindows() && !isMac()

    private fun platformName(): String = when {
        isWindows() -> "Windows"
        isMac() -> "macOS"
        else -> "Linux"
    }

    private fun brewExecutable(): String? {
        if (isWindows()) return null
        val envPath = System.getenv("PATH").orEmpty()
        val separators = if (File.pathSeparatorChar == ';') ';' else ':'
        val candidates = buildList {
            addAll(envPath.split(separators).filter { it.isNotBlank() }.map { File(it, "brew") })
            add(File("/opt/homebrew/bin/brew"))
            add(File("/usr/local/bin/brew"))
            add(File("/home/linuxbrew/.linuxbrew/bin/brew"))
        }
        return candidates.firstOrNull { it.isFile && it.canExecute() }?.absolutePath
    }

    private fun commandPath(): String? {
        return when {
            isWindows() -> findCommandUnder(runtimeRoot())
            else -> brewPrefix()?.let { prefix ->
                listOf(
                    File(prefix, "bin/whisper-cli"),
                    File(prefix, "bin/main")
                ).firstOrNull { it.isFile && it.canExecute() }?.absolutePath ?: findCommandUnder(File(prefix))
            }
        }
    }

    private fun findCommandUnder(root: File): String? {
        if (!root.exists()) return null
        val preferredNames = listOf("whisper-cli.exe", "whisper-cli", "main.exe", "main")
        preferredNames.forEach { preferred ->
            root.walkTopDown().forEach { file ->
                if (file.isFile && file.name.equals(preferred, ignoreCase = true)) {
                    return file.absolutePath
                }
            }
        }
        return null
    }

    private fun brewPrefix(): String? {
        val brew = brewExecutable() ?: return null
        return runCommand(listOf(brew, "--prefix", BREW_FORMULA)).first?.trim()?.takeIf { it.isNotBlank() }
    }

    private fun brewInstalled(): Boolean = brewPrefix()?.let { File(it).exists() } == true

    private fun isInstalled(): Boolean {
        val commandReady = commandPath()?.let { File(it).isFile } == true
        return commandReady && modelFile().isFile
    }

    fun isAvailable(): Boolean = isInstalled()

    fun currentState(statusOverride: String? = null, installing: Boolean = false): AudioTranscriptionFeatureState {
        val supported = when {
            isWindows() -> System.getProperty("os.arch").lowercase().contains("64")
            else -> brewExecutable() != null
        }
        val installed = isInstalled()
        val status = statusOverride ?: when {
            installed -> "Installed"
            isWindows() -> "Not Installed"
            brewExecutable() == null -> "Homebrew Required"
            else -> "Not Installed"
        }
        val detail = when {
            installed -> commandPath().orEmpty()
            isWindows() -> "Installs whisper.cpp runtime and the base model into the plugin runtime directory."
            brewExecutable() == null -> "Install Homebrew first to manage whisper-cpp on ${platformName()}."
            else -> "Installs whisper-cpp via Homebrew and downloads the base Whisper model."
        }
        return AudioTranscriptionFeatureState(
            id = FEATURE_ID,
            title = FEATURE_TITLE,
            installed = installed,
            installing = installing,
            supported = supported,
            status = status,
            detail = detail,
            installPath = installLocation()
        )
    }

    fun install(statusCallback: (String) -> Unit): AudioTranscriptionFeatureState {
        statusCallback("Preparing install...")
        featureRoot().mkdirs()
        modelRoot().mkdirs()

        if (isWindows()) {
            installWindowsRuntime(statusCallback)
        } else {
            installWithBrew(statusCallback)
        }

        downloadModel(statusCallback)
        return currentState("Installed")
    }

    fun uninstall(statusCallback: (String) -> Unit): AudioTranscriptionFeatureState {
        statusCallback("Removing Whisper...")
        if (isWindows()) {
            runtimeRoot().deleteRecursively()
        } else if (brewInstalled()) {
            val brew = brewExecutable() ?: error("Homebrew is not available")
            val (output, exitCode) = runCommand(listOf(brew, "uninstall", BREW_FORMULA))
            if (exitCode != 0) {
                throw IllegalStateException(output.ifBlank { "Unable to uninstall $BREW_FORMULA" })
            }
        }
        featureRoot().deleteRecursively()
        return currentState("Not Installed")
    }

    fun transcribeAudioBase64(audioBase64: String): String {
        if (!isAvailable()) {
            throw IllegalStateException("Whisper is not installed.")
        }

        val tempDir = File(featureRoot(), "transcription-temp").apply { mkdirs() }
        val requestId = "audio-${System.currentTimeMillis()}"
        val inputFile = File(tempDir, "$requestId.wav")

        try {
            Files.write(inputFile.toPath(), Base64.getDecoder().decode(audioBase64))
            return transcribeAudioFile(inputFile)
        } finally {
            inputFile.delete()
        }
    }

    fun transcribeAudioFile(inputFile: File): String {
        if (!isAvailable()) {
            throw IllegalStateException("Whisper is not installed.")
        }

        val command = commandPath() ?: throw IllegalStateException("Whisper CLI is not available.")
        val model = modelFile()
        if (!model.isFile) {
            throw IllegalStateException("Whisper model is missing.")
        }

        val outputBase = File(inputFile.parentFile, inputFile.nameWithoutExtension)
        val outputFile = File(inputFile.parentFile, "${inputFile.nameWithoutExtension}.txt")
        try {
            val language = GlobalSettingsStore.loadAudioTranscriptionSettings().language
            val args = mutableListOf(
                command,
                "-m", model.absolutePath,
                "-f", inputFile.absolutePath,
                "-otxt",
                "-of", outputBase.absolutePath,
                "-nt",
                "-np"
            )
            if (language != "auto") {
                args.addAll(listOf("-l", language))
            }
            val (output, exitCode) = runCommand(args, timeoutMinutes = 5)
            if (exitCode != 0) {
                throw IllegalStateException(output.ifBlank { "Whisper transcription failed." })
            }
            if (!outputFile.isFile) {
                throw IllegalStateException("Whisper did not produce a transcript.")
            }
            return outputFile.readText().trim()
        } finally {
            outputFile.delete()
        }
    }

    private fun installWindowsRuntime(statusCallback: (String) -> Unit) {
        if (!System.getProperty("os.arch").lowercase().contains("64")) {
            throw IllegalStateException("Whisper runtime is currently supported only on 64-bit Windows.")
        }

        runtimeRoot().deleteRecursively()
        runtimeRoot().mkdirs()
        val archiveFile = File(featureRoot(), "whisper-windows.zip")
        statusCallback("Downloading whisper.cpp...")
        downloadFile(WINDOWS_ARCHIVE_URL, archiveFile)
        statusCallback("Extracting whisper.cpp...")
        unzip(archiveFile, runtimeRoot())
        archiveFile.delete()

        val command = commandPath()
        if (command.isNullOrBlank()) {
            throw IllegalStateException("Whisper CLI was not found after extraction.")
        }
    }

    private fun installWithBrew(statusCallback: (String) -> Unit) {
        val brew = brewExecutable() ?: throw IllegalStateException("Homebrew is required on ${platformName()}.")
        statusCallback("Installing whisper-cpp with Homebrew...")
        val (output, exitCode) = runCommand(listOf(brew, "install", BREW_FORMULA), timeoutMinutes = 20)
        if (exitCode != 0 && !brewInstalled()) {
            throw IllegalStateException(output.ifBlank { "Homebrew install failed." })
        }
        val command = commandPath()
        if (command.isNullOrBlank()) {
            throw IllegalStateException("Whisper CLI was not found after Homebrew install.")
        }
    }

    private fun downloadModel(statusCallback: (String) -> Unit) {
        modelRoot().mkdirs()
        val target = modelFile()
        if (target.isFile && target.length() > 0) {
            statusCallback("Model already present.")
            return
        }
        statusCallback("Downloading model...")
        downloadFile(MODEL_URL, target)
    }

    private fun installLocation(): String {
        return when {
            isWindows() -> runtimeRoot().absolutePath
            else -> brewPrefix() ?: featureRoot().absolutePath
        }
    }

    private fun downloadFile(url: String, target: File) {
        target.parentFile?.mkdirs()
        val tempFile = File(target.parentFile, "${target.name}.part")
        val request = HttpRequest.newBuilder(URI.create(url)).GET().build()
        val response = httpClient.send(request, HttpResponse.BodyHandlers.ofInputStream())
        if (response.statusCode() !in 200..299) {
            throw IllegalStateException("Download failed with HTTP ${response.statusCode()}")
        }
        response.body().use { input ->
            Files.copy(input, tempFile.toPath(), StandardCopyOption.REPLACE_EXISTING)
        }
        Files.move(tempFile.toPath(), target.toPath(), StandardCopyOption.REPLACE_EXISTING)
    }

    private fun unzip(archiveFile: File, targetDir: File) {
        val canonicalTarget = targetDir.canonicalPath + File.separator
        ZipInputStream(BufferedInputStream(archiveFile.inputStream())).use { zip ->
            var entry = zip.nextEntry
            while (entry != null) {
                val outFile = File(targetDir, entry.name)
                if (!outFile.canonicalPath.startsWith(canonicalTarget)) {
                    throw IllegalStateException("Zip entry outside target directory: ${entry.name}")
                }
                if (entry.isDirectory) {
                    outFile.mkdirs()
                } else {
                    outFile.parentFile?.mkdirs()
                    FileOutputStream(outFile).use { output ->
                        zip.copyTo(output)
                    }
                }
                zip.closeEntry()
                entry = zip.nextEntry
            }
        }
    }

    private fun runCommand(command: List<String>, timeoutMinutes: Long = 10): Pair<String, Int> {
        val process = ProcessBuilder(command)
            .redirectErrorStream(true)
            .start()
        val output = StringBuilder()
        val readerThread = Thread {
            process.inputStream.bufferedReader().useLines { lines ->
                lines.forEach { line ->
                    output.appendLine(line)
                }
            }
        }
        readerThread.isDaemon = true
        readerThread.start()

        val finished = process.waitFor(timeoutMinutes, TimeUnit.MINUTES)
        if (!finished) {
            process.destroyForcibly()
            readerThread.join(1000)
            return "Command timed out" to -1
        }
        readerThread.join(1000)
        return output.toString() to process.exitValue()
    }
}
