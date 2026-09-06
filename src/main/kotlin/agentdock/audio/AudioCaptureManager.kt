package agentdock.audio

import agentdock.utils.AgentDockPaths
import java.io.File
import java.nio.channels.FileChannel
import java.nio.channels.FileLock
import java.nio.file.StandardOpenOption
import java.util.Timer
import java.util.UUID
import javax.sound.sampled.AudioFileFormat
import javax.sound.sampled.AudioFormat
import javax.sound.sampled.AudioInputStream
import javax.sound.sampled.AudioSystem
import javax.sound.sampled.DataLine
import javax.sound.sampled.TargetDataLine

object AudioCaptureManager {
    private const val MAX_RECORDING_DURATION_MS = 2 * 60 * 1000L
    private const val STALE_SESSION_AGE_MS = 10 * 60 * 1000L
    private const val WRITER_WAIT_TIMEOUT_MS = 2_000L
    private const val WRITER_INTERRUPT_GRACE_MS = 500L
    private const val DEFERRED_CLEANUP_POLL_MS = 100L
    private val captureFormat = AudioFormat(16_000f, 16, 1, true, false)
    private val processSessionId = UUID.randomUUID().toString()

    private var sessionDirectory: File? = null
    private var sessionLockChannel: FileChannel? = null
    private var sessionLock: FileLock? = null
    private var line: TargetDataLine? = null
    private var recordingStream: AudioInputStream? = null
    private var recordingFile: File? = null
    private var writerThread: Thread? = null
    @Volatile
    private var writerFailure: Throwable? = null
    private var pendingWriterCleanupPath: String? = null
    private var autoStopTimer: Timer? = null
    private var recording = false
    private var recordingOwner: String? = null
    private val retainedRecordings = mutableSetOf<String>()

    private data class WriterWaitResult(
        val finished: Boolean,
        val interrupted: Boolean,
    )

    /** Removes recordings left by an interrupted process without touching a live process session. */
    @Synchronized
    fun cleanupStaleRecordings() {
        cleanupStaleSessionDirectories()
    }

    @Synchronized
    fun startRecording(ownerId: String, onStopped: ((String) -> Unit)? = null): File {
        require(ownerId.isNotBlank()) { "Audio recording owner is missing." }
        check(!recording) { "Audio recording is already active." }
        check(pendingWriterCleanupPath == null) { "Audio recording is still stopping." }

        cleanupStaleRecordings()
        val outputFile = File(openSessionDirectory(), "capture-${UUID.randomUUID()}.wav")
        val info = DataLine.Info(TargetDataLine::class.java, captureFormat)
        var targetLine: TargetDataLine? = null
        var audioStream: AudioInputStream? = null
        var localWriterThread: Thread? = null

        try {
            targetLine = AudioSystem.getLine(info) as? TargetDataLine
                ?: throw IllegalStateException("Microphone input is not available.")
            targetLine.open(captureFormat)
            targetLine.start()
            audioStream = AudioInputStream(targetLine)

            writerFailure = null
            val stream = audioStream
            recording = true
            recordingOwner = ownerId
            line = targetLine
            recordingStream = audioStream
            recordingFile = outputFile
            val writer = Thread {
                try {
                    stream.use { AudioSystem.write(it, AudioFileFormat.Type.WAVE, outputFile) }
                } catch (error: Throwable) {
                    writerFailure = error
                    scheduleWriterFailure(ownerId, outputFile, onStopped, error)
                }
            }.apply {
                isDaemon = true
                name = "audio-writer-${processSessionId}"
            }
            writerThread = writer
            localWriterThread = writer
            writer.start()

            autoStopTimer = Timer("audio-auto-stop-${processSessionId}", true).apply {
                schedule(object : java.util.TimerTask() {
                    override fun run() {
                        autoStopRecording(ownerId, outputFile, onStopped)
                    }
                }, MAX_RECORDING_DURATION_MS)
            }

            return outputFile
        } catch (error: Throwable) {
            autoStopTimer?.cancel()
            autoStopTimer = null
            runCatching { audioStream?.close() }
            runCatching { targetLine?.stop() }
            runCatching { targetLine?.close() }
            val wait = waitForWriter(localWriterThread)
            if (!wait.finished && localWriterThread != null) {
                deferWriterCleanup(localWriterThread, outputFile)
                resetRecordingState(keepWriter = true)
            } else {
                resetRecordingState()
                outputFile.delete()
            }
            closeSessionIfIdle()
            throw error
        }
    }

    private fun recordingsRoot(): File = File(
        AgentDockPaths.baseRuntimeDir(),
        "features/audio-transcription/recordings"
    )

    private fun openSessionDirectory(): File {
        sessionDirectory?.let { return it }

        val directory = File(recordingsRoot(), "session-${processSessionId}").apply { mkdirs() }
        var channel: FileChannel? = null
        try {
            channel = FileChannel.open(
                File(directory, ".lock").toPath(),
                StandardOpenOption.CREATE,
                StandardOpenOption.WRITE
            )
            val lock = channel.tryLock()
                ?: throw IllegalStateException("Audio recording session is already in use.")
            sessionDirectory = directory
            sessionLockChannel = channel
            sessionLock = lock
            return directory
        } catch (error: Throwable) {
            runCatching { channel?.close() }
            directory.deleteRecursively()
            throw error
        }
    }

    private fun cleanupStaleSessionDirectories() {
        val currentPath = sessionDirectory?.canonicalPath
        recordingsRoot().listFiles()
            ?.filter { it.isDirectory && it.name.startsWith("session-") }
            ?.forEach { directory ->
                if (directory.canonicalPath == currentPath) return@forEach

                val lockFile = File(directory, ".lock")
                val unlocked = if (lockFile.isFile) {
                    runCatching {
                        FileChannel.open(
                            lockFile.toPath(),
                            StandardOpenOption.READ,
                            StandardOpenOption.WRITE
                        ).use { channel ->
                            channel.tryLock()?.use { true } ?: false
                        }
                    }.getOrDefault(false)
                } else {
                    isStaleSession(directory)
                }
                if (unlocked) directory.deleteRecursively()
            }
    }

    private fun isStaleSession(directory: File): Boolean =
        directory.lastModified() > 0 && System.currentTimeMillis() - directory.lastModified() > STALE_SESSION_AGE_MS

    private fun autoStopRecording(
        ownerId: String,
        outputFile: File,
        onStopped: ((String) -> Unit)?,
    ) {
        var message = "Audio recording timed out."
        synchronized(this) {
            if (!isCurrentRecording(ownerId, outputFile)) return

            val currentFile = recordingFile
            val stoppedFile = runCatching { stopRecording(ownerId) }
                .getOrElse { error ->
                    if (isCurrentRecording(ownerId, outputFile)) forceStopRecording()
                    message = error.message ?: "Audio recording failed."
                    null
                }
            if (pendingWriterCleanupPath == null) {
                (stoppedFile ?: currentFile)?.let(::releaseRecording)
            }
        }
        onStopped?.invoke(message)
    }

    @Synchronized
    fun isRecording(ownerId: String): Boolean = recording && recordingOwner == ownerId

    private fun isCurrentRecording(ownerId: String, outputFile: File): Boolean =
        recording && recordingOwner == ownerId && recordingFile == outputFile

    @Synchronized
    fun stopRecording(ownerId: String): File {
        check(recording) { "Audio recording is not active." }
        check(recordingOwner == ownerId) { "Audio recording belongs to another chat." }

        val targetLine = line
        val outputFile = recordingFile
        if (targetLine == null || outputFile == null) {
            val currentFile = recordingFile
            forceStopRecording()
            if (pendingWriterCleanupPath == null) currentFile?.delete()
            closeSessionIfIdle()
            throw IllegalStateException("Audio recording state is incomplete.")
        }
        val thread = writerThread
        val stream = recordingStream

        autoStopTimer?.cancel()
        autoStopTimer = null

        var lineFailure: Throwable? = null
        runCatching { targetLine.stop() }.onFailure { lineFailure = it }
        runCatching { targetLine.close() }.onFailure { if (lineFailure == null) lineFailure = it }
        runCatching { stream?.close() }

        val wait = waitForWriter(thread)
        if (!wait.finished && thread != null) {
            deferWriterCleanup(thread, outputFile)
            resetRecordingState(keepWriter = true)
            closeSessionIfIdle()
            throw IllegalStateException("Audio recording writer did not stop.")
        }

        val writerError = writerFailure
        resetRecordingState()

        val failure = lineFailure ?: writerError
        if (failure != null || wait.interrupted || !outputFile.isFile) {
            outputFile.delete()
            closeSessionIfIdle()
            throw IllegalStateException(
                failure?.message?.takeIf(String::isNotBlank)
                    ?: if (wait.interrupted) "Audio recording stop was interrupted."
                    else "Recording output was not created.",
                failure
            )
        }

        retainedRecordings.add(outputFile.canonicalPath)
        return outputFile
    }

    @Synchronized
    fun cancelRecording(ownerId: String): Boolean {
        if (recordingOwner != ownerId) return false

        val currentFile = recordingFile
        val stoppedFile = if (recording) {
            runCatching { stopRecording(ownerId) }.getOrNull()
        } else {
            null
        }
        if (recording) forceStopRecording()
        if (pendingWriterCleanupPath == null) {
            (stoppedFile ?: currentFile)?.let(::releaseRecording)
        }
        return currentFile != null || stoppedFile != null
    }

    @Synchronized
    fun releaseRecording(file: File) {
        val path = file.canonicalPath
        if (path == pendingWriterCleanupPath) return
        retainedRecordings.remove(path)
        file.delete()
        File(file.parentFile, "${file.nameWithoutExtension}.txt").delete()
        closeSessionIfIdle()
    }

    @Synchronized
    private fun forceStopRecording() {
        autoStopTimer?.cancel()
        autoStopTimer = null

        val thread = writerThread
        val file = recordingFile
        runCatching { line?.stop() }
        runCatching { line?.close() }
        runCatching { recordingStream?.close() }
        val wait = waitForWriter(thread)
        if (!wait.finished && thread != null && file != null) {
            deferWriterCleanup(thread, file)
            resetRecordingState(keepWriter = true)
        } else {
            resetRecordingState()
        }
    }

    private fun scheduleWriterFailure(
        ownerId: String,
        outputFile: File,
        onStopped: ((String) -> Unit)?,
        error: Throwable,
    ) {
        val handler = Thread {
            handleWriterFailure(ownerId, outputFile, onStopped, error)
        }.apply {
            isDaemon = true
            name = "audio-writer-failure-${processSessionId}"
        }
        runCatching { handler.start() }
    }

    private fun handleWriterFailure(
        ownerId: String,
        outputFile: File,
        onStopped: ((String) -> Unit)?,
        error: Throwable,
    ) {
        var notify = false
        synchronized(this) {
            if (!isCurrentRecording(ownerId, outputFile)) return

            autoStopTimer?.cancel()
            autoStopTimer = null
            val thread = writerThread
            val file = recordingFile ?: outputFile
            runCatching { line?.stop() }
            runCatching { line?.close() }
            runCatching { recordingStream?.close() }
            val wait = waitForWriter(thread)
            if (!wait.finished && thread != null) {
                deferWriterCleanup(thread, file)
                resetRecordingState(keepWriter = true)
            } else {
                resetRecordingState()
                file.delete()
                closeSessionIfIdle()
            }
            notify = true
        }
        if (notify) {
            onStopped?.invoke(error.message?.takeIf(String::isNotBlank) ?: "Audio recording failed.")
        }
    }

    private fun waitForWriter(thread: Thread?): WriterWaitResult {
        if (thread == null || thread === Thread.currentThread()) {
            return WriterWaitResult(finished = true, interrupted = false)
        }

        try {
            thread.join(WRITER_WAIT_TIMEOUT_MS)
        } catch (_: InterruptedException) {
            thread.interrupt()
            Thread.currentThread().interrupt()
            return WriterWaitResult(finished = !thread.isAlive, interrupted = true)
        }
        if (thread.isAlive) {
            thread.interrupt()
            try {
                thread.join(WRITER_INTERRUPT_GRACE_MS)
            } catch (_: InterruptedException) {
                Thread.currentThread().interrupt()
                return WriterWaitResult(finished = !thread.isAlive, interrupted = true)
            }
        }
        return WriterWaitResult(finished = !thread.isAlive, interrupted = false)
    }

    private fun deferWriterCleanup(thread: Thread, file: File) {
        if (pendingWriterCleanupPath != null) return

        val path = file.canonicalPath
        pendingWriterCleanupPath = path
        retainedRecordings.add(path)
        Thread {
            while (thread.isAlive) {
                try {
                    thread.join(DEFERRED_CLEANUP_POLL_MS)
                } catch (_: InterruptedException) {
                    // Keep polling until the writer has actually stopped; the manager lock is
                    // acquired only after the writer is gone.
                }
            }
            synchronized(this) {
                if (writerThread === thread) writerThread = null
                pendingWriterCleanupPath = null
                writerFailure = null
                retainedRecordings.remove(path)
                file.delete()
                closeSessionIfIdle()
            }
        }.apply {
            isDaemon = true
            name = "audio-writer-cleanup-${processSessionId}"
        }.start()
    }

    private fun resetRecordingState(keepWriter: Boolean = false) {
        line = null
        recordingStream = null
        recordingFile = null
        if (!keepWriter) {
            writerThread = null
            writerFailure = null
        }
        recordingOwner = null
        recording = false
    }

    private fun closeSessionIfIdle() {
        if (recording || pendingWriterCleanupPath != null || retainedRecordings.isNotEmpty()) return
        val directory = sessionDirectory ?: return

        runCatching { sessionLock?.release() }
        runCatching { sessionLockChannel?.close() }
        sessionLock = null
        sessionLockChannel = null
        sessionDirectory = null
        directory.deleteRecursively()
    }
}
