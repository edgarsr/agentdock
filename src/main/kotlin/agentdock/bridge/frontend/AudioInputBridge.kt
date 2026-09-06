package agentdock.bridge.frontend

import agentdock.audio.AudioCaptureManager
import agentdock.audio.AudioTranscriptionService
import agentdock.audio.AudioTranscriptionServices
import agentdock.settings.AudioRecordingStatePayload
import agentdock.settings.AudioTranscriptionFeatureState
import agentdock.settings.AudioTranscriptionProviders
import agentdock.settings.AudioTranscriptionResultPayload
import agentdock.settings.AudioTranscriptionSettings
import agentdock.settings.StopRecordingRequest
import agentdock.utils.jsStringLiteral
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.runInterruptible
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import java.io.File
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Dictation, on the machine that has the microphone.
 *
 * These commands never reach the backend: microphone capture and the API request run in the
 * process that owns the user's microphone. In Split Mode that keeps voice input on the client,
 * and in a monolithic IDE it is the same process anyway.
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
    private val transcriptionJobs = ConcurrentHashMap<String, Job>()
    private val recordingStartJobs = ConcurrentHashMap<String, Job>()
    private val recordingOwners = ConcurrentHashMap.newKeySet<String>()

    @Volatile
    private var latestAudioSettings: AudioTranscriptionSettings? = null

    @Volatile
    private var disposed = false

    fun install() {
        scope.launch(Dispatchers.IO) {
            if (selectedSettings().provider == AudioTranscriptionProviders.NONE) return@launch
            runCatching { AudioCaptureManager.cleanupStaleRecordings() }
        }

        commands.register("loadAudioTranscriptionFeature") { payload ->
            val settings = requestedSettings(payload)
            scope.launch(Dispatchers.IO) {
                push(currentFeatureState(settings))
            }
        }

        commands.register("installAudioTranscriptionFeature") { payload ->
            val settings = requestedSettings(payload)
            scope.launch(Dispatchers.IO) {
                performFeatureAction(settings) { service, settings ->
                    service.install(settings)
                }
            }
        }

        commands.register("uninstallAudioTranscriptionFeature") { payload ->
            val settings = requestedSettings(payload)
            scope.launch(Dispatchers.IO) {
                performFeatureAction(settings) { service, settings ->
                    service.uninstall(settings)
                }
            }
        }

        commands.register("cancelAudioTranscription") { payload ->
            val requestId = runCatching {
                json.decodeFromString<StopRecordingRequest>(payload).requestId
            }.getOrDefault("")
            if (requestId.isNotBlank()) {
                transcriptionJobs[requestId]?.cancel()
            }
        }

        commands.register("cancelAudioRecording") { payload ->
            val ownerId = payload.trim()
            if (ownerId.isBlank()) return@register
            val startJob = recordingStartJobs[ownerId]
            startJob?.cancel()
            scope.launch(Dispatchers.IO) {
                val cancelled = AudioCaptureManager.cancelRecording(ownerId)
                if (cancelled || startJob != null) {
                    recordingOwners.remove(ownerId)
                    pushRecordingState(AudioRecordingStatePayload(recording = false, ownerId = ownerId))
                }
            }
        }

        commands.register("startAudioRecording") { payload ->
            val ownerId = payload.trim()
            if (disposed || ownerId.isBlank()) return@register
            if (recordingStartJobs.containsKey(ownerId) ||
                recordingOwners.contains(ownerId) ||
                AudioCaptureManager.isRecording(ownerId)
            ) return@register

            val job = scope.launch(Dispatchers.IO, start = CoroutineStart.LAZY) {
                try {
                    currentCoroutineContext().ensureActive()
                    val settings = selectedSettings()
                    val service = selectedService(settings)
                    val providerReady = service?.currentState(settings)?.installed == true
                    currentCoroutineContext().ensureActive()
                    if (!providerReady) {
                        pushRecordingState(
                            AudioRecordingStatePayload(
                                recording = false,
                                error = "Audio transcription provider is not ready.",
                                ownerId = ownerId
                            )
                        )
                        return@launch
                    }

                    currentCoroutineContext().ensureActive()
                    AudioCaptureManager.startRecording(ownerId) { message ->
                        recordingOwners.remove(ownerId)
                        pushRecordingState(
                            AudioRecordingStatePayload(
                                recording = false,
                                error = message,
                                ownerId = ownerId
                            )
                        )
                    }
                    currentCoroutineContext().ensureActive()
                    if (disposed) throw CancellationException("Audio input bridge is disposed.")
                    if (!AudioCaptureManager.isRecording(ownerId)) return@launch
                    recordingOwners.add(ownerId)
                    if (!AudioCaptureManager.isRecording(ownerId)) {
                        recordingOwners.remove(ownerId)
                        return@launch
                    }
                } catch (error: CancellationException) {
                    AudioCaptureManager.cancelRecording(ownerId)
                    recordingOwners.remove(ownerId)
                    throw error
                } catch (error: Throwable) {
                    AudioCaptureManager.cancelRecording(ownerId)
                    recordingOwners.remove(ownerId)
                    pushRecordingState(
                        AudioRecordingStatePayload(
                            recording = false,
                            error = error.message.orEmpty(),
                            ownerId = ownerId
                        )
                    )
                }
            }
            if (recordingStartJobs.putIfAbsent(ownerId, job) != null) {
                job.cancel()
                return@register
            }
            job.invokeOnCompletion { recordingStartJobs.remove(ownerId, job) }
            job.start()
        }

        commands.register("stopAudioRecording") { payload ->
            if (payload.isBlank()) return@register
            val request = runCatching {
                json.decodeFromString<StopRecordingRequest>(payload)
            }.getOrNull() ?: return@register
            val requestId = request.requestId
            val ownerId = request.ownerId
            val pendingStart = recordingStartJobs[ownerId]?.takeUnless { it.isCompleted }
            val activeRecording = ownerId.isNotBlank() && AudioCaptureManager.isRecording(ownerId)
            if (!activeRecording && pendingStart != null) {
                pendingStart.cancel()
                recordingOwners.remove(ownerId)
                pushRecordingState(AudioRecordingStatePayload(recording = false, ownerId = ownerId))
                if (requestId.isNotBlank()) {
                    pushResult(
                        AudioTranscriptionResultPayload(
                            requestId = requestId,
                            success = false,
                            cancelled = true
                        )
                    )
                }
                scope.launch(Dispatchers.IO) {
                    AudioCaptureManager.cancelRecording(ownerId)
                }
                return@register
            }

            val settings = selectedSettings()
            val service = selectedService(settings)
            if (requestId.isBlank() || ownerId.isBlank() || service == null || !activeRecording) {
                if (requestId.isNotBlank()) {
                    pushResult(
                        AudioTranscriptionResultPayload(
                            requestId = requestId,
                            success = false,
                            error = "Audio recording is not active."
                        )
                    )
                }
                return@register
            }
            val startCompletion = pendingStart
            launchTranscription(requestId, ownerId) {
                if (startCompletion != null) {
                    startCompletion.join()
                    if (startCompletion.isCancelled || !AudioCaptureManager.isRecording(ownerId)) {
                        return@launchTranscription AudioTranscriptionResultPayload(
                            requestId = requestId,
                            success = false,
                            cancelled = true
                        )
                    }
                }
                stopAndTranscribe(requestId, ownerId, service, settings)
            }
        }
    }

    fun dispose() {
        disposed = true
        val owners = (recordingOwners + recordingStartJobs.keys).toSet()
        recordingStartJobs.values.forEach { it.cancel() }
        recordingStartJobs.clear()
        transcriptionJobs.values.forEach { it.cancel() }
        transcriptionJobs.clear()
        owners.forEach { ownerId ->
            AudioCaptureManager.cancelRecording(ownerId)
        }
        recordingOwners.clear()
    }

    private fun launchTranscription(
        requestId: String,
        ownerId: String,
        block: suspend () -> AudioTranscriptionResultPayload,
    ) {
        if (requestId.isBlank()) return

        val resultSent = AtomicBoolean(false)
        fun emitResult(result: AudioTranscriptionResultPayload) {
            if (!resultSent.compareAndSet(false, true)) return
            pushRecordingState(AudioRecordingStatePayload(recording = false, ownerId = ownerId))
            pushResult(result)
        }

        val job = scope.launch(Dispatchers.IO, start = CoroutineStart.LAZY) {
            try {
                val result = block()
                currentCoroutineContext().ensureActive()
                emitResult(result)
            } catch (error: CancellationException) {
                throw error
            } catch (error: InterruptedException) {
                throw CancellationException("Audio transcription cancelled.", error)
            } catch (error: Throwable) {
                emitResult(
                    AudioTranscriptionResultPayload(
                        requestId = requestId,
                        success = false,
                        error = error.message.orEmpty()
                    )
                )
            }
        }
        transcriptionJobs.put(requestId, job)?.cancel()
        job.invokeOnCompletion { cause ->
            transcriptionJobs.remove(requestId, job)
            if (cause is CancellationException || cause is InterruptedException) {
                emitResult(
                    AudioTranscriptionResultPayload(
                        requestId = requestId,
                        success = false,
                        cancelled = true
                    )
                )
            }
        }
        job.start()
    }

    private suspend fun stopAndTranscribe(
        requestId: String,
        ownerId: String,
        service: AudioTranscriptionService,
        settings: AudioTranscriptionSettings,
    ): AudioTranscriptionResultPayload {
        var recordedFile: File? = null
        try {
            val file = AudioCaptureManager.stopRecording(ownerId)
            recordedFile = file
            recordingOwners.remove(ownerId)
            currentCoroutineContext().ensureActive()
            val text = runInterruptible(Dispatchers.IO) {
                service.transcribeAudioFile(file, settings)
            }
            return AudioTranscriptionResultPayload(
                requestId = requestId,
                success = true,
                text = text
            )
        } finally {
            recordedFile?.let { AudioCaptureManager.releaseRecording(it) }
            if (recordedFile == null) {
                AudioCaptureManager.cancelRecording(ownerId)
                recordingOwners.remove(ownerId)
            }
        }
    }

    private fun performFeatureAction(
        settings: AudioTranscriptionSettings,
        action: (AudioTranscriptionService, AudioTranscriptionSettings) -> AudioTranscriptionFeatureState,
    ) {
        val service = selectedService(settings)
        if (service == null || !service.installable) {
            push(currentFeatureState(settings))
            return
        }

        push(service.currentState(settings, installing = true))
        runCatching {
            action(service, settings)
        }.onSuccess { state ->
            push(state)
        }.onFailure {
            push(service.currentState(settings))
        }
    }

    private fun requestedSettings(payload: String): AudioTranscriptionSettings {
        val requested = runCatching {
            json.decodeFromString<AudioTranscriptionSettings>(payload)
        }.getOrNull()
        if (requested != null) {
            val normalized = requested.copy(provider = requested.provider.trim().lowercase())
            latestAudioSettings = normalized
            return normalized
        }

        val provider = payload.trim().lowercase()
            .takeIf { AudioTranscriptionServices.find(it) != null }
            ?: selectedSettings().provider
        return selectedSettings().copy(provider = provider)
    }

    private fun selectedSettings(): AudioTranscriptionSettings =
        latestAudioSettings ?: FrontendSettings.current.audioTranscription

    private fun selectedService(settings: AudioTranscriptionSettings): AudioTranscriptionService? =
        AudioTranscriptionServices.find(settings.provider)

    private fun currentFeatureState(settings: AudioTranscriptionSettings): AudioTranscriptionFeatureState {
        return selectedService(settings)?.currentState(settings) ?: AudioTranscriptionFeatureState(
            id = AudioTranscriptionProviders.NONE,
            title = "None",
            installed = false,
            installing = false,
            supported = true
        )
    }

    private fun push(state: AudioTranscriptionFeatureState) {
        if (disposed) return
        val payload = json.encodeToString(state).jsStringLiteral()
        eval("if(window.__onAudioTranscriptionFeature) window.__onAudioTranscriptionFeature(JSON.parse($payload));")
    }

    private fun pushResult(result: AudioTranscriptionResultPayload) {
        if (disposed) return
        val payload = json.encodeToString(result).jsStringLiteral()
        eval("if(window.__onAudioTranscriptionResult) window.__onAudioTranscriptionResult(JSON.parse($payload));")
    }

    private fun pushRecordingState(state: AudioRecordingStatePayload) {
        if (disposed) return
        val payload = json.encodeToString(state).jsStringLiteral()
        eval("if(window.__onAudioRecordingState) window.__onAudioRecordingState(JSON.parse($payload));")
    }
}
