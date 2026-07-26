package agentdock.acp

import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import agentdock.utils.atomicWriteText
import java.io.File

@Serializable
data class AcpAgentPreference(
    val configOptions: Map<String, String> = emptyMap()
)

@Serializable
data class AcpAgentPreferencesState(
    val lastAgentId: String = "",
    val agents: Map<String, AcpAgentPreference> = emptyMap()
)

object AcpAgentPreferencesStore {
    private data class StoredState(
        val state: AcpAgentPreferencesState,
        val valid: Boolean
    )

    private val json = Json {
        ignoreUnknownKeys = true
        prettyPrint = true
        encodeDefaults = true
    }
    private val lock = Any()
    private var cachedState: StoredState? = null

    private fun stateFile(): File = File(AcpAdapterPaths.getBaseRuntimeDir(), "acp-agent-preferences.json")

    fun load(): AcpAgentPreferencesState = synchronized(lock) {
        readStoredState().state
    }

    fun save(state: AcpAgentPreferencesState): AcpAgentPreferencesState = synchronized(lock) {
        val normalized = normalize(state)
        val stored = readStoredState()
        if (stored.valid && stored.state == normalized) stored.state else writeState(normalized)
    }

    fun lastAgentId(): String? = load().lastAgentId.takeIf { it.isNotBlank() }

    fun preferenceFor(adapterId: String): AcpAgentPreference? {
        if (adapterId.isBlank()) return null
        return load().agents[adapterId]?.takeIf { it.configOptions.isNotEmpty() }
    }

    fun rememberAgent(adapterId: String) {
        val trimmedAdapterId = adapterId.trim()
        if (trimmedAdapterId.isEmpty()) return
        updateState { current -> current.copy(lastAgentId = trimmedAdapterId) }
    }

    fun rememberConfigOptions(adapterId: String, values: Map<String, String>) {
        val trimmedAdapterId = adapterId.trim()
        val normalizedValues = values.mapNotNull { (id, value) ->
            val normalizedId = id.trim()
            val normalizedValue = value.trim()
            if (normalizedId.isEmpty() || normalizedValue.isEmpty()) null else normalizedId to normalizedValue
        }.toMap()
        if (trimmedAdapterId.isEmpty() || normalizedValues.isEmpty()) return
        updateState { current ->
            current.copy(
                lastAgentId = current.lastAgentId,
                agents = current.agents + (trimmedAdapterId to AcpAgentPreference(normalizedValues))
            )
        }
    }

    private fun updateState(transform: (AcpAgentPreferencesState) -> AcpAgentPreferencesState): AcpAgentPreferencesState =
        synchronized(lock) {
            val stored = readStoredState()
            val updated = normalize(transform(stored.state))
            if (stored.valid && stored.state == updated) stored.state else writeState(updated)
        }

    private fun readStoredState(): StoredState {
        cachedState?.let { return it }
        val file = stateFile()
        if (!file.isFile) {
            return StoredState(AcpAgentPreferencesState(), valid = false).also { cachedState = it }
        }
        return runCatching {
            StoredState(
                state = normalize(json.decodeFromString<AcpAgentPreferencesState>(file.readText())),
                valid = true
            )
        }.getOrDefault(StoredState(AcpAgentPreferencesState(), valid = false))
            .also { cachedState = it }
    }

    private fun writeState(state: AcpAgentPreferencesState): AcpAgentPreferencesState {
        val file = stateFile()
        file.parentFile?.mkdirs()
        file.atomicWriteText(json.encodeToString(state))
        cachedState = StoredState(state, valid = true)
        return state
    }

    private fun normalize(state: AcpAgentPreferencesState): AcpAgentPreferencesState {
        val normalizedAgents = state.agents.entries.mapNotNull { (adapterId, pref) ->
            val trimmedAdapterId = adapterId.trim()
            if (trimmedAdapterId.isEmpty()) {
                null
            } else {
                val normalizedPref = AcpAgentPreference(pref.configOptions.mapNotNull { (id, value) ->
                    val normalizedId = id.trim()
                    val normalizedValue = value.trim()
                    if (normalizedId.isEmpty() || normalizedValue.isEmpty()) null
                    else normalizedId to normalizedValue
                }.toMap())
                if (normalizedPref.configOptions.isEmpty()) {
                    null
                } else {
                    trimmedAdapterId to normalizedPref
                }
            }
        }.toMap()
        val normalizedLastAgentId = state.lastAgentId.trim().takeIf { it.isNotEmpty() } ?: ""
        return AcpAgentPreferencesState(
            lastAgentId = normalizedLastAgentId,
            agents = normalizedAgents
        )
    }
}
