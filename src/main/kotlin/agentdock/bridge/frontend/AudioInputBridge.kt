package agentdock.bridge.frontend

import agentdock.settings.AudioRecordingStatePayload
import agentdock.settings.AudioTranscriptionFeatureState
import agentdock.settings.AudioTranscriptionRequest
import agentdock.settings.AudioTranscriptionResultPayload
import agentdock.settings.AudioCaptureManager
import agentdock.settings.StopRecordingRequest
import agentdock.settings.WhisperFeatureManager
import agentdock.utils.jsStringLiteral
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json

/**
 * Dictation, on the machine that has the microphone.
 *
 * These commands never reach the backend: recording, the speech model and the transcription all
 * belong to the user's own machine. In Split Mode that is what makes voice input work at all, and
 * in a monolithic IDE it is the same process anyway.
 */
internal class AudioInputBridge(
    private val commands: FrontendCommands,
    private val eval: (String) -> Unit,
    private val scope: CoroutineScope,
) {
    private val json = Json {
        ignoreUnknownKeys = true
        encodeDefaults = true
    }

    fun install() {
        commands.register("loadAudioTranscriptionFeature") {
            scope.launch(Dispatchers.IO) {
                push(WhisperFeatureManager.currentState())
            }
        }

        commands.register("installAudioTranscriptionFeature") {
            scope.launch(Dispatchers.IO) {
                push(WhisperFeatureManager.currentState(statusOverride = "Installing...", installing = true))
                runCatching {
                    WhisperFeatureManager.install { status ->
                        push(WhisperFeatureManager.currentState(statusOverride = status, installing = true))
                    }
                }.onSuccess { state ->
                    push(state)
                }.onFailure { error ->
                    push(WhisperFeatureManager.currentState(statusOverride = "Error", installing = false).copy(detail = error.message.orEmpty()))
                }
            }
        }

        commands.register("uninstallAudioTranscriptionFeature") {
            scope.launch(Dispatchers.IO) {
                push(WhisperFeatureManager.currentState(statusOverride = "Uninstalling...", installing = true))
                runCatching {
                    WhisperFeatureManager.uninstall { status ->
                        push(WhisperFeatureManager.currentState(statusOverride = status, installing = true))
                    }
                }.onSuccess { state ->
                    push(state)
                }.onFailure { error ->
                    push(WhisperFeatureManager.currentState(statusOverride = "Error", installing = false).copy(detail = error.message.orEmpty()))
                }
            }
        }

        commands.register("transcribeAudioInput") { payload ->
            if (payload.isBlank()) return@register
            scope.launch(Dispatchers.IO) {
                val result = runCatching {
                    val request = json.decodeFromString<AudioTranscriptionRequest>(payload)
                    val text = WhisperFeatureManager.transcribeAudioBase64(request.audioBase64)
                    AudioTranscriptionResultPayload(
                        requestId = request.requestId,
                        success = true,
                        text = text
                    )
                }.getOrElse { error ->
                    val requestId = runCatching {
                        json.decodeFromString<AudioTranscriptionRequest>(payload).requestId
                    }.getOrDefault("")
                    AudioTranscriptionResultPayload(
                        requestId = requestId,
                        success = false,
                        error = error.message.orEmpty()
                    )
                }
                pushResult(result)
            }
        }

        commands.register("startAudioRecording") {
            scope.launch(Dispatchers.IO) {
                val state = runCatching {
                    AudioCaptureManager.startRecording()
                    AudioRecordingStatePayload(recording = true)
                }.getOrElse { error ->
                    AudioRecordingStatePayload(recording = false, error = error.message.orEmpty())
                }
                pushRecordingState(state)
            }
        }

        commands.register("stopAudioRecording") { payload ->
            if (payload.isBlank()) return@register
            scope.launch(Dispatchers.IO) {
                val requestId = runCatching {
                    json.decodeFromString<StopRecordingRequest>(payload).requestId
                }.getOrDefault("")
                val result = runCatching {
                    val recordedFile = AudioCaptureManager.stopRecording()
                    try {
                        val text = WhisperFeatureManager.transcribeAudioFile(recordedFile)
                        AudioTranscriptionResultPayload(
                            requestId = requestId,
                            success = true,
                            text = text
                        )
                    } finally {
                        recordedFile.delete()
                    }
                }.getOrElse { error ->
                    AudioTranscriptionResultPayload(
                        requestId = requestId,
                        success = false,
                        error = error.message.orEmpty()
                    )
                }
                pushRecordingState(AudioRecordingStatePayload(recording = false))
                pushResult(result)
            }
        }
    }

    private fun push(state: AudioTranscriptionFeatureState) {
        val payload = json.encodeToString(state).jsStringLiteral()
        eval("if(window.__onAudioTranscriptionFeature) window.__onAudioTranscriptionFeature(JSON.parse($payload));")
    }

    private fun pushResult(result: AudioTranscriptionResultPayload) {
        val payload = json.encodeToString(result).jsStringLiteral()
        eval("if(window.__onAudioTranscriptionResult) window.__onAudioTranscriptionResult(JSON.parse($payload));")
    }

    private fun pushRecordingState(state: AudioRecordingStatePayload) {
        val payload = json.encodeToString(state).jsStringLiteral()
        eval("if(window.__onAudioRecordingState) window.__onAudioRecordingState(JSON.parse($payload));")
    }
}
