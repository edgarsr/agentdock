package agentdock.audio

import agentdock.settings.AudioTranscriptionFeatureState
import agentdock.settings.AudioTranscriptionSettings
import agentdock.utils.AgentDockPaths
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
import java.util.concurrent.TimeUnit
import java.util.concurrent.locks.ReentrantReadWriteLock
import java.util.zip.ZipInputStream

object WhisperFeatureManager : AudioTranscriptionService {
    private const val FEATURE_ID = "whisper-transcription"
    private const val FEATURE_TITLE = "Whisper"
    private const val WINDOWS_ARCHIVE_URL = "https://github.com/ggml-org/whisper.cpp/releases/download/v1.8.4/whisper-bin-x64.zip"
    private const val MODEL_URL = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin?download=true"
    private const val MODEL_FILE_NAME = "ggml-base.bin"
    private val httpClient by lazy {
        HttpClient.newBuilder()
            .followRedirects(HttpClient.Redirect.ALWAYS)
            .connectTimeout(Duration.ofSeconds(30))
            .build()
    }
    private val runtimeLock = ReentrantReadWriteLock()

    private fun featureRoot(): File = File(AgentDockPaths.baseRuntimeDir(), "features/whisper")
    private fun runtimeRoot(): File = File(featureRoot(), "runtime")
    private fun modelRoot(): File = File(featureRoot(), "models")
    private fun modelFile(): File = File(modelRoot(), MODEL_FILE_NAME)
    private fun isWindows(): Boolean = System.getProperty("os.name").lowercase().contains("win")
    private fun isSupportedPlatform(): Boolean = isWindows() && System.getProperty("os.arch").lowercase().contains("64")

    init {
        cleanupTemporaryArtifacts()
    }

    private fun commandPath(): String? = findCommandUnder(runtimeRoot())

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

    private fun isInstalled(): Boolean {
        if (!isSupportedPlatform()) return false
        val commandReady = commandPath()?.let { File(it).isFile } == true
        return commandReady && modelFile().isFile
    }

    fun isAvailable(): Boolean = isInstalled()

    override val id: String = FEATURE_ID
    override val installable: Boolean = true

    override fun currentState(
        settings: AudioTranscriptionSettings,
        installing: Boolean,
    ): AudioTranscriptionFeatureState {
        val supported = isSupportedPlatform()
        val installed = isInstalled()
        return AudioTranscriptionFeatureState(
            id = FEATURE_ID,
            title = FEATURE_TITLE,
            installed = installed,
            installing = installing,
            supported = supported,
            installable = installable,
            installPath = installLocation()
        )
    }

    override fun install(
        settings: AudioTranscriptionSettings,
    ): AudioTranscriptionFeatureState = withWriteLock {
        if (!isSupportedPlatform()) {
            throw IllegalStateException("Whisper runtime is currently supported only on 64-bit Windows.")
        }
        cleanupTemporaryArtifacts()
        featureRoot().mkdirs()
        modelRoot().mkdirs()
        installWindowsRuntime()
        downloadModel()
        currentState(settings, installing = false)
    }

    override fun uninstall(
        settings: AudioTranscriptionSettings,
    ): AudioTranscriptionFeatureState = withWriteLock {
        if (!isSupportedPlatform()) {
            throw IllegalStateException("Whisper runtime is currently supported only on 64-bit Windows.")
        }
        runtimeRoot().deleteRecursively()
        featureRoot().deleteRecursively()
        currentState(settings, installing = false)
    }

    override fun transcribeAudioFile(inputFile: File, settings: AudioTranscriptionSettings): String {
        return withReadLock {
            transcribeAudioFileLocked(inputFile, settings)
        }
    }

    private fun transcribeAudioFileLocked(inputFile: File, settings: AudioTranscriptionSettings): String {
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
            val language = settings.language
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

    private fun <T> withReadLock(block: () -> T): T {
        runtimeLock.readLock().lockInterruptibly()
        return try {
            block()
        } finally {
            runtimeLock.readLock().unlock()
        }
    }

    private fun <T> withWriteLock(block: () -> T): T {
        runtimeLock.writeLock().lock()
        return try {
            block()
        } finally {
            runtimeLock.writeLock().unlock()
        }
    }

    private fun installWindowsRuntime() {
        if (!isSupportedPlatform()) {
            throw IllegalStateException("Whisper runtime is currently supported only on 64-bit Windows.")
        }

        runtimeRoot().deleteRecursively()
        runtimeRoot().mkdirs()
        val archiveFile = File(featureRoot(), "whisper-windows.zip")
        try {
            downloadFile(WINDOWS_ARCHIVE_URL, archiveFile)
            unzip(archiveFile, runtimeRoot())
        } finally {
            archiveFile.delete()
        }

        val command = commandPath()
        if (command.isNullOrBlank()) {
            throw IllegalStateException("Whisper CLI was not found after extraction.")
        }
    }

    private fun downloadModel() {
        modelRoot().mkdirs()
        val target = modelFile()
        if (target.isFile && target.length() > 0) {
            return
        }
        downloadFile(MODEL_URL, target)
    }

    private fun cleanupTemporaryArtifacts() {
        if (!featureRoot().isDirectory) return
        featureRoot().walkTopDown()
            .filter { it.isFile && (it.name == "whisper-windows.zip" || it.name.endsWith(".part")) }
            .forEach { it.delete() }
    }

    private fun installLocation(): String = runtimeRoot().absolutePath

    private fun downloadFile(url: String, target: File) {
        target.parentFile?.mkdirs()
        val tempFile = File(target.parentFile, "${target.name}.part")
        try {
            val request = HttpRequest.newBuilder(URI.create(url)).GET().build()
            val response = httpClient.send(request, HttpResponse.BodyHandlers.ofInputStream())
            response.body().use { input ->
                if (response.statusCode() !in 200..299) {
                    throw IllegalStateException("Download failed with HTTP ${response.statusCode()}")
                }
                Files.copy(input, tempFile.toPath(), StandardCopyOption.REPLACE_EXISTING)
            }
            Files.move(tempFile.toPath(), target.toPath(), StandardCopyOption.REPLACE_EXISTING)
        } finally {
            tempFile.delete()
        }
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

        val finished = try {
            process.waitFor(timeoutMinutes, TimeUnit.MINUTES)
        } catch (interrupted: InterruptedException) {
            process.destroyForcibly()
            runCatching { readerThread.join(1000) }
            Thread.currentThread().interrupt()
            throw interrupted
        }
        if (!finished) {
            process.destroyForcibly()
            readerThread.join(1000)
            return "Command timed out" to -1
        }
        readerThread.join(1000)
        return output.toString() to process.exitValue()
    }
}
