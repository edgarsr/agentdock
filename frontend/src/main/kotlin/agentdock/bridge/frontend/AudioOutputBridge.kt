package agentdock.bridge.frontend

import agentdock.audio.SpeechSynthesizers
import agentdock.settings.AudioOutputProviderSettings
import agentdock.settings.SpeechRequest
import agentdock.settings.SpeechResultPayload
import agentdock.utils.jsCallback
import agentdock.utils.jsStringLiteral
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.runInterruptible
import kotlinx.serialization.json.Json
import java.io.ByteArrayOutputStream
import java.util.concurrent.ConcurrentHashMap
import javax.sound.sampled.AudioFormat
import javax.sound.sampled.AudioSystem
import javax.sound.sampled.SourceDataLine

/**
 * Reading responses aloud with a cloud voice, on the machine that has the speakers.
 *
 * Like dictation, these commands never reach the backend: the API request and playback run in the
 * process that plays the sound. System voices need none of this; the page speaks them itself.
 */
internal class AudioOutputBridge(
    private val commands: FrontendCommands,
    private val eval: (String) -> Unit,
    private val scope: CoroutineScope,
) {
    private val json = Json {
        ignoreUnknownKeys = true
        encodeDefaults = true
    }
    private val lock = Any()
    private var active: Playback? = null

    /** Audio of the last read response, so reading it again costs no new API requests. */
    private var cache = SpeechCache("", ConcurrentHashMap())

    @Volatile
    private var disposed = false

    fun install() {
        commands.register("startSpeech") { payload ->
            val request = runCatching { json.decodeFromString<SpeechRequest>(payload) }.getOrNull()
                ?: return@register
            if (!disposed && request.requestId.isNotBlank()) start(request)
        }

        commands.register("stopSpeech") { requestId ->
            synchronized(lock) { active?.takeIf { it.requestId == requestId.trim() } }?.stop()
        }
    }

    fun dispose() {
        disposed = true
        synchronized(lock) { active }?.stop()
    }

    private fun start(request: SpeechRequest) {
        val settings = FrontendSettings.current.audioOutput
        val providerSettings = settings.providers[settings.provider] ?: AudioOutputProviderSettings()
        val voice = "${settings.provider}/${providerSettings.voice}"
        val playback = Playback(request.requestId)
        playback.job = scope.launch(Dispatchers.IO, start = CoroutineStart.LAZY) {
            val error = try {
                val synthesizer = SpeechSynthesizers.find(settings.provider)
                    ?: throw IllegalStateException("Speech provider is not available.")
                play(playback, request.chunks, playback.stored) { text, onAudio ->
                    synthesizer.synthesize(text, providerSettings, onAudio)
                }
                null
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (failure: Throwable) {
                // Stopping closes the line and the stream under a running request; that is not a failure.
                currentCoroutineContext().ensureActive()
                failure.message?.takeIf(String::isNotBlank) ?: "Reading aloud failed."
            }
            push(SpeechResultPayload(requestId = request.requestId, error = error))
        }
        val previous = synchronized(lock) {
            // Only this response's chunks are kept; audio of other responses is released.
            cache.takeIf { it.voice == voice }?.audio?.forEach { (text, pcm) ->
                if (text in request.chunks) playback.stored[text] = pcm
            }
            cache = SpeechCache(voice, playback.stored)
            active.also { active = playback }
        }
        previous?.stop()
        playback.job.invokeOnCompletion {
            synchronized(lock) { if (active === playback) active = null }
        }
        playback.job.start()
    }

    /**
     * Requests the chunks one after another while earlier audio is still playing, so the next chunk
     * is usually ready before the previous one ends.
     */
    private suspend fun play(
        playback: Playback,
        chunks: List<String>,
        stored: MutableMap<String, ByteArray>,
        synthesize: (String, (ByteArray) -> Unit) -> Unit,
    ) = coroutineScope {
        val audio = Channel<ByteArray>(Channel.UNLIMITED)
        launch {
            val failure = runCatching {
                chunks.forEach { chunk ->
                    stored[chunk]?.let { pcm ->
                        audio.trySend(pcm)
                        return@forEach
                    }
                    val received = ByteArrayOutputStream()
                    runInterruptible {
                        synthesize(chunk) { pcm ->
                            audio.trySend(pcm)
                            received.write(pcm)
                        }
                    }
                    // Only fully received chunks are stored; a stopped chunk is requested again next time.
                    stored[chunk] = received.toByteArray()
                }
            }.exceptionOrNull()
            // Audio that already arrived still plays before a failure is reported.
            audio.close(failure)
        }

        AudioSystem.getSourceDataLine(PCM_FORMAT).use { line ->
            playback.line = line
            currentCoroutineContext().ensureActive()
            line.open(PCM_FORMAT)
            line.start()
            var pending = ByteArray(0)
            for (pcm in audio) {
                currentCoroutineContext().ensureActive()
                // Network chunks can split a 16-bit sample; carry the odd byte into the next write.
                val data = pending + pcm
                val frames = data.size - data.size % PCM_FORMAT.frameSize
                pending = data.copyOfRange(frames, data.size)
                line.write(data, 0, frames)
            }
            line.drain()
        }
    }

    private fun push(result: SpeechResultPayload) {
        if (disposed) return
        val payload = json.encodeToString(result).jsStringLiteral()
        eval(jsCallback("__onSpeechResult", "JSON.parse($payload)"))
    }

    private class SpeechCache(val voice: String, val audio: Map<String, ByteArray>)

    private class Playback(val requestId: String) {
        lateinit var job: Job
        val stored = ConcurrentHashMap<String, ByteArray>()

        @Volatile
        var line: SourceDataLine? = null

        /** Closing the line releases a blocked write or drain; cancelling the job ends the request. */
        fun stop() {
            job.cancel()
            line?.close()
        }
    }

    private companion object {
        val PCM_FORMAT = AudioFormat(24_000f, 16, 1, true, false)
    }
}
