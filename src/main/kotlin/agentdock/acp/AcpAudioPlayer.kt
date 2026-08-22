package agentdock.acp

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import agentdock.bridge.frontend.FrontendSettings
import java.io.BufferedInputStream
import javax.sound.sampled.AudioFormat
import javax.sound.sampled.AudioSystem
import javax.sound.sampled.LineEvent

/**
 * Handles sound playback for ACP bridge notifications.
 */
internal class AcpAudioPlayer(private val scope: CoroutineScope) {

    fun playResponseCompleteSound() {
        playSound("/sounds/notification.wav")
    }

    fun playPermissionRequestSound() {
        playSound("/sounds/request.wav")
    }

    private fun playSound(resourcePath: String) {
        scope.launch(Dispatchers.IO) {
            if (!FrontendSettings.current.audioNotificationsEnabled) {
                return@launch
            }
            try {
                val resourceStream = AcpAudioPlayer::class.java.getResourceAsStream(resourcePath)
                if (resourceStream == null) {
                    return@launch
                }
                BufferedInputStream(resourceStream).use { bufferedStream ->
                    AudioSystem.getAudioInputStream(bufferedStream).use { sourceStream ->
                        val sourceFormat = sourceStream.format
                        val decodedFormat = AudioFormat(
                            AudioFormat.Encoding.PCM_SIGNED,
                            sourceFormat.sampleRate,
                            16,
                            sourceFormat.channels,
                            sourceFormat.channels * 2,
                            sourceFormat.sampleRate,
                            false
                        )

                        val playableStream =
                            if (sourceFormat.encoding == AudioFormat.Encoding.PCM_SIGNED && sourceFormat.sampleSizeInBits == 16) {
                                sourceStream
                            } else {
                                AudioSystem.getAudioInputStream(decodedFormat, sourceStream)
                            }

                        playableStream.use { audioStream ->
                            val clip = AudioSystem.getClip()
                            clip.addLineListener { event ->
                                if (event.type == LineEvent.Type.STOP) {
                                    clip.close()
                                }
                            }
                            clip.open(audioStream)
                            clip.start()
                        }
                    }
                }
            } catch (e: Exception) {
            }
        }
    }
}
