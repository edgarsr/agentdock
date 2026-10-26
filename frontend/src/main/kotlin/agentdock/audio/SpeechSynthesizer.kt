package agentdock.audio

import agentdock.settings.AudioOutputProviderSettings
import agentdock.settings.AudioOutputProviders
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonPrimitive
import java.io.InputStream
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.nio.charset.StandardCharsets
import java.time.Duration

interface SpeechSynthesizer {
    /**
     * Provider boundary for reading responses aloud. Implementations block until [text] is synthesized
     * and hand the audio to [onAudio] as it streams in: 24 kHz, 16-bit signed little-endian mono PCM.
     */
    fun synthesize(text: String, settings: AudioOutputProviderSettings, onAudio: (ByteArray) -> Unit)
}

object SpeechSynthesizers {
    private val synthesizers = mapOf(
        AudioOutputProviders.GPT_SPEECH to { GptSpeech },
        AudioOutputProviders.GEMINI_SPEECH to { GeminiSpeech },
    )

    fun find(provider: String): SpeechSynthesizer? = synthesizers[provider]?.invoke()
}

internal val speechJson = Json { ignoreUnknownKeys = true }

private val speechHttpClient by lazy {
    HttpClient.newBuilder()
        .followRedirects(HttpClient.Redirect.NORMAL)
        .connectTimeout(Duration.ofSeconds(15))
        .build()
}

/** Sends [request] and returns the streaming response body, or throws the API's error message. */
internal fun openSpeechStream(request: HttpRequest, operation: String): InputStream {
    val response = speechHttpClient.send(request, HttpResponse.BodyHandlers.ofInputStream())
    if (response.statusCode() in 200..299) return response.body()
    val body = response.body().use { it.readBytes().toString(StandardCharsets.UTF_8) }
    val message = runCatching { speechJson.parseToJsonElement(body) }.getOrNull()?.let(::speechErrorMessage)
    throw IllegalStateException(message ?: "$operation failed (HTTP ${response.statusCode()}).")
}

internal fun speechErrorMessage(element: JsonElement): String? =
    ((element as? JsonObject)?.get("error") as? JsonObject)?.get("message")?.jsonPrimitive?.contentOrNull
        ?.trim()
        ?.takeIf(String::isNotEmpty)
