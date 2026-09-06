package agentdock.audio

import agentdock.settings.AudioTranscriptionFeatureState
import agentdock.settings.AudioTranscriptionProviders
import agentdock.settings.AudioTranscriptionSettings
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.io.File
import java.net.URI
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.nio.charset.StandardCharsets
import java.time.Duration
import java.util.concurrent.ExecutionException

/**
 * Small file-based demo client for OpenAI's GPT Transcribe API.
 *
 * The key is read from the client-side settings snapshot so the demo can be configured entirely
 * from Agent Dock settings.
 */
object GptTranscriber : AudioTranscriptionService {
    private const val FEATURE_ID = AudioTranscriptionProviders.GPT_TRANSCRIBER
    private const val FEATURE_TITLE = "GPT Transcriber"
    private const val MODEL = "gpt-transcribe"
    private const val TRANSCRIPTIONS_URL = "https://api.openai.com/v1/audio/transcriptions"
    private const val MAX_AUDIO_BYTES = 25L * 1024L * 1024L

    private val httpClient by lazy {
        HttpClient.newBuilder()
            .followRedirects(HttpClient.Redirect.NORMAL)
            .connectTimeout(Duration.ofSeconds(15))
            .build()
    }
    private val json = Json { ignoreUnknownKeys = true }

    override val id: String = FEATURE_ID

    private fun apiKey(settings: AudioTranscriptionSettings): String? = settings.providers[FEATURE_ID]?.apiKey
        ?.trim()
        ?.takeIf { it.isNotEmpty() }

    private fun isConfigured(settings: AudioTranscriptionSettings): Boolean = apiKey(settings) != null

    override fun currentState(
        settings: AudioTranscriptionSettings,
        installing: Boolean,
    ): AudioTranscriptionFeatureState {
        val configured = isConfigured(settings)
        return AudioTranscriptionFeatureState(
            id = FEATURE_ID,
            title = FEATURE_TITLE,
            installed = configured,
            installing = installing,
            supported = true,
            installPath = ""
        )
    }

    override fun transcribeAudioFile(inputFile: File, settings: AudioTranscriptionSettings): String {
        val key = apiKey(settings)
            ?: throw IllegalStateException("Enter an OpenAI API key in Settings → Audio Input.")
        require(inputFile.isFile) { "Audio recording is missing." }
        require(inputFile.length() in 1L..MAX_AUDIO_BYTES) {
            "Audio recording must be between 1 byte and 25 MB."
        }

        val boundary = "AgentDock-${System.nanoTime()}"
        val body = multipartBody(inputFile, boundary, settings.language)
        val request = HttpRequest.newBuilder(URI.create(TRANSCRIPTIONS_URL))
            .timeout(Duration.ofSeconds(30))
            .header("Authorization", "Bearer $key")
            .header("Accept", "application/json")
            .header("Content-Type", "multipart/form-data; boundary=$boundary")
            .POST(HttpRequest.BodyPublishers.ofByteArray(body))
            .build()

        val responseFuture = httpClient.sendAsync(request, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8))
        val response = try {
            responseFuture.get()
        } catch (interrupted: InterruptedException) {
            responseFuture.cancel(true)
            Thread.currentThread().interrupt()
            throw interrupted
        } catch (error: ExecutionException) {
            throw (error.cause ?: error)
        }
        if (response.statusCode() !in 200..299) {
            throw IllegalStateException(apiError(response.statusCode(), response.body()))
        }

        return json.parseToJsonElement(response.body()).jsonObject["text"]
            ?.jsonPrimitive
            ?.contentOrNull
            ?.trim()
            ?.takeIf { it.isNotEmpty() }
            ?: throw IllegalStateException("GPT Transcriber returned an empty transcript.")
    }

    private fun multipartBody(inputFile: File, boundary: String, language: String): ByteArray {
        val prefix = buildString {
            append("--$boundary\r\n")
            append("Content-Disposition: form-data; name=\"model\"\r\n\r\n")
            append(MODEL)
            append("\r\n--$boundary\r\n")
            append("Content-Disposition: form-data; name=\"response_format\"\r\n\r\n")
            append("json")
            append("\r\n")
            if (language != "auto") {
                append("--$boundary\r\n")
                append("Content-Disposition: form-data; name=\"language\"\r\n\r\n")
                append(language)
                append("\r\n")
            }
            append("--$boundary\r\n")
            append("Content-Disposition: form-data; name=\"file\"; filename=\"audio.wav\"\r\n")
            append("Content-Type: audio/wav\r\n\r\n")
        }.toByteArray(StandardCharsets.UTF_8)
        val suffix = "\r\n--$boundary--\r\n".toByteArray(StandardCharsets.UTF_8)
        return prefix + inputFile.readBytes() + suffix
    }

    private fun apiError(statusCode: Int, responseBody: String): String {
        val message = runCatching {
            json.parseToJsonElement(responseBody).jsonObject["error"]
                ?.jsonObject
                ?.get("message")
                ?.jsonPrimitive
                ?.contentOrNull
        }.getOrNull()?.trim()?.takeIf(String::isNotEmpty)
        return message ?: "GPT Transcriber request failed (HTTP $statusCode)."
    }
}
