package agentdock.audio

import agentdock.settings.AudioTranscriptionFeatureState
import agentdock.settings.AudioTranscriptionProviders
import agentdock.settings.AudioTranscriptionSettings
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.io.File
import java.net.URI
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.nio.charset.StandardCharsets
import java.time.Duration
import java.util.concurrent.CompletableFuture
import java.util.concurrent.ExecutionException

/** File-based client for Google's Gemini 3.5 Transcribe API. */
object GeminiTranscriber : AudioTranscriptionService {
    private const val FEATURE_ID = AudioTranscriptionProviders.GEMINI_TRANSCRIBER
    private const val FEATURE_TITLE = "Gemini 3.5 Transcribe (Google)"
    private const val MODEL = "gemini-3.5-transcribe"
    private const val API_BASE = "https://generativelanguage.googleapis.com/v1beta"
    private const val UPLOAD_URL = "https://generativelanguage.googleapis.com/upload/v1beta/files"
    private const val TRANSCRIPTION_URL = "$API_BASE/models/$MODEL:generateContent"
    private const val REQUEST_TIMEOUT_SECONDS = 30L

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

    override fun currentState(
        settings: AudioTranscriptionSettings,
        installing: Boolean,
    ): AudioTranscriptionFeatureState {
        return AudioTranscriptionFeatureState(
            id = FEATURE_ID,
            title = FEATURE_TITLE,
            installed = apiKey(settings) != null,
            installing = installing,
            supported = true,
            installPath = ""
        )
    }

    override fun transcribeAudioFile(inputFile: File, settings: AudioTranscriptionSettings): String {
        val key = apiKey(settings)
            ?: throw IllegalStateException("Enter a Google Gemini API key in Settings → Audio Input.")
        require(inputFile.isFile) { "Audio recording is missing." }
        require(inputFile.length() > 0L) { "Audio recording is empty." }

        var uploadedFile: UploadedFile? = null
        try {
            uploadedFile = upload(inputFile, key)
            val response = requestTranscription(uploadedFile.uri, key, settings.language)
            if (response.statusCode() !in 200..299) {
                throw IllegalStateException(apiError("Gemini Transcribe request", response.statusCode(), response.body()))
            }
            return transcript(response.body())
        } finally {
            uploadedFile?.let { delete(it.name, key) }
        }
    }

    private fun upload(inputFile: File, key: String): UploadedFile {
        val startRequest = HttpRequest.newBuilder(URI.create(UPLOAD_URL))
            .timeout(Duration.ofSeconds(REQUEST_TIMEOUT_SECONDS))
            .header("x-goog-api-key", key)
            .header("X-Goog-Upload-Protocol", "resumable")
            .header("X-Goog-Upload-Command", "start")
            .header("X-Goog-Upload-Header-Content-Length", inputFile.length().toString())
            .header("X-Goog-Upload-Header-Content-Type", "audio/wav")
            .header("Content-Type", "application/json")
            .POST(HttpRequest.BodyPublishers.ofString(
                "{\"file\":{\"display_name\":\"agent-dock-audio.wav\"}}",
                StandardCharsets.UTF_8
            ))
            .build()
        val startResponse = await(httpClient.sendAsync(startRequest, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8)))
        if (startResponse.statusCode() !in 200..299) {
            throw IllegalStateException(apiError("Gemini Transcribe upload", startResponse.statusCode(), startResponse.body()))
        }
        val uploadUrl = startResponse.headers().firstValue("x-goog-upload-url").orElse(null)
            ?: throw IllegalStateException("Gemini Transcribe upload did not return an upload URL.")

        val uploadRequest = HttpRequest.newBuilder(URI.create(uploadUrl))
            .timeout(Duration.ofSeconds(REQUEST_TIMEOUT_SECONDS))
            .header("X-Goog-Upload-Offset", "0")
            .header("X-Goog-Upload-Command", "upload, finalize")
            .header("Content-Type", "audio/wav")
            .POST(HttpRequest.BodyPublishers.ofFile(inputFile.toPath()))
            .build()
        val uploadResponse = await(httpClient.sendAsync(uploadRequest, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8)))
        if (uploadResponse.statusCode() !in 200..299) {
            throw IllegalStateException(apiError("Gemini Transcribe upload", uploadResponse.statusCode(), uploadResponse.body()))
        }

        val file = json.parseToJsonElement(uploadResponse.body()).jsonObject["file"]?.jsonObject
            ?: throw IllegalStateException("Gemini Transcribe upload returned no file.")
        val name = file["name"]?.jsonPrimitive?.contentOrNull?.trim().orEmpty()
        val uri = file["uri"]?.jsonPrimitive?.contentOrNull?.trim().orEmpty()
        if (name.isEmpty() || uri.isEmpty()) {
            throw IllegalStateException("Gemini Transcribe upload returned an invalid file.")
        }
        return UploadedFile(name, uri)
    }

    private fun requestTranscription(
        fileUri: String,
        key: String,
        language: String,
    ): HttpResponse<String> {
        val body = transcriptionBody(fileUri, language)
        val request = HttpRequest.newBuilder(URI.create(TRANSCRIPTION_URL))
            .timeout(Duration.ofSeconds(REQUEST_TIMEOUT_SECONDS))
            .header("x-goog-api-key", key)
            .header("Content-Type", "application/json")
            .header("Accept", "application/json")
            .POST(HttpRequest.BodyPublishers.ofString(body, StandardCharsets.UTF_8))
            .build()
        return await(httpClient.sendAsync(request, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8)))
    }

    private fun transcriptionBody(fileUri: String, language: String): String {
        val languageCode = when (language.trim().lowercase()) {
            "en" -> "en-US"
            "de" -> "de-DE"
            "lv" -> "lv-LV"
            "fr" -> "fr-FR"
            "es" -> "es-419"
            else -> null
        }
        val languageConfig = if (languageCode == null) "" else
            ",\"generationConfig\":{\"audioTranscriptionConfig\":{\"languageCodes\":[\"$languageCode\"]}}"
        return "{\"contents\":[{\"parts\":[{\"fileData\":{\"fileUri\":${JsonPrimitive(fileUri)},\"mimeType\":\"audio/wav\"}}]}]$languageConfig}"
    }

    private fun transcript(responseBody: String): String {
        val root = json.parseToJsonElement(responseBody).jsonObject
        val direct = root["text"]?.jsonPrimitive?.contentOrNull?.trim()
        if (!direct.isNullOrEmpty()) return direct

        val texts = mutableListOf<String>()
        root["candidates"]?.jsonArray?.forEach { candidate ->
            candidate.jsonObject["content"]?.jsonObject?.get("parts")?.jsonArray?.forEach { part ->
                val partObject = part.jsonObject
                partObject["text"]?.jsonPrimitive?.contentOrNull?.trim()?.takeIf { it.isNotEmpty() }?.let(texts::add)
                partObject["audioTranscription"]?.jsonObject?.get("text")?.jsonPrimitive?.contentOrNull
                    ?.trim()?.takeIf { it.isNotEmpty() }?.let(texts::add)
            }
        }
        return texts.joinToString("\n").trim().takeIf { it.isNotEmpty() }
            ?: throw IllegalStateException("Gemini Transcribe returned an empty transcript.")
    }

    private fun delete(name: String, key: String) {
        // Cleanup runs independently of transcription cancellation and result delivery.
        val interrupted = Thread.interrupted()
        try {
            val request = HttpRequest.newBuilder(URI.create("$API_BASE/$name"))
                .timeout(Duration.ofSeconds(5))
                .header("x-goog-api-key", key)
                .DELETE()
                .build()
            httpClient.sendAsync(request, HttpResponse.BodyHandlers.discarding())
        } catch (_: Exception) {
            // Files API also expires uploaded files automatically; cleanup must not mask the result.
        } finally {
            if (interrupted) Thread.currentThread().interrupt()
        }
    }

    private fun apiError(operation: String, statusCode: Int, responseBody: String): String {
        val message = runCatching {
            json.parseToJsonElement(responseBody).jsonObject["error"]
                ?.jsonObject
                ?.get("message")
                ?.jsonPrimitive
                ?.contentOrNull
        }.getOrNull()?.trim()?.takeIf(String::isNotEmpty)
        return message ?: "$operation failed (HTTP $statusCode)."
    }

    private fun <T> await(future: CompletableFuture<T>): T {
        return try {
            future.get()
        } catch (interrupted: InterruptedException) {
            future.cancel(true)
            Thread.currentThread().interrupt()
            throw interrupted
        } catch (error: ExecutionException) {
            throw (error.cause ?: error)
        }
    }

    private data class UploadedFile(val name: String, val uri: String)
}
