package unified.llm.settings

import java.io.File
import java.util.concurrent.atomic.AtomicBoolean
import javax.sound.sampled.AudioFileFormat
import javax.sound.sampled.AudioFormat
import javax.sound.sampled.AudioInputStream
import javax.sound.sampled.AudioSystem
import javax.sound.sampled.DataLine
import javax.sound.sampled.TargetDataLine

object AudioCaptureManager {
    private const val MAX_RECORDING_DURATION_MS = 5 * 60 * 1000L
    private val captureFormat = AudioFormat(16_000f, 16, 1, true, false)
    private var line: TargetDataLine? = null
    private var recordingFile: File? = null
    private var writerThread: Thread? = null
    private var autoStopTimer: java.util.Timer? = null
    private val recording = AtomicBoolean(false)

    @Synchronized
    fun isRecording(): Boolean = recording.get()

    @Synchronized
    fun startRecording(): File {
        if (recording.get()) {
            throw IllegalStateException("Audio recording is already active.")
        }

        val tempDir = File(WhisperFeatureManager.featureStorageRoot(), "recordings").apply { mkdirs() }
        val outputFile = File(tempDir, "capture-${System.currentTimeMillis()}.wav")
        val info = DataLine.Info(TargetDataLine::class.java, captureFormat)
        val targetLine = AudioSystem.getLine(info) as? TargetDataLine
            ?: throw IllegalStateException("Microphone input is not available.")

        targetLine.open(captureFormat)
        targetLine.start()

        val audioStream = AudioInputStream(targetLine)
        val thread = Thread {
            AudioSystem.write(audioStream, AudioFileFormat.Type.WAVE, outputFile)
        }.apply {
            isDaemon = true
            start()
        }

        line = targetLine
        recordingFile = outputFile
        writerThread = thread
        recording.set(true)

        autoStopTimer = java.util.Timer("audio-auto-stop", true).apply {
            schedule(object : java.util.TimerTask() {
                override fun run() {
                    if (recording.get()) {
                        try { stopRecording() } catch (_: Exception) {}
                    }
                }
            }, MAX_RECORDING_DURATION_MS)
        }

        return outputFile
    }

    @Synchronized
    fun stopRecording(): File {
        if (!recording.get()) {
            throw IllegalStateException("Audio recording is not active.")
        }

        val targetLine = line ?: throw IllegalStateException("Audio line is not available.")
        val outputFile = recordingFile ?: throw IllegalStateException("Recording file is missing.")
        val thread = writerThread

        autoStopTimer?.cancel()
        autoStopTimer = null

        targetLine.stop()
        targetLine.close()
        thread?.join(5_000)

        line = null
        recordingFile = null
        writerThread = null
        recording.set(false)

        if (!outputFile.isFile) {
            throw IllegalStateException("Recording output was not created.")
        }

        return outputFile
    }
}
