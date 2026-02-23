package unified.llm.acp

import com.intellij.openapi.diagnostic.Logger
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import java.io.File

private val log = Logger.getInstance("unified.llm.acp.AcpAgentSettings")

/**
 * Manages persistent settings for ACP agents, such as whether they are enabled.
 * Uses a simple JSON file for persistence since the project doesn't use standard settings yet.
 */
object AcpAgentSettings {
    @Serializable
    private data class SettingsData(
        val enabledAgents: Map<String, Boolean> = emptyMap()
    )

    private val settingsFile = File(AcpAdapterPaths.getBaseRuntimeDir(), "settings/agents.json")
    private val json = Json { 
        prettyPrint = true
        ignoreUnknownKeys = true
    }

    private var currentSettings = loadSettings()

    @Synchronized
    fun isEnabled(agentId: String): Boolean {
        return currentSettings.enabledAgents[agentId] ?: true // Default to enabled
    }

    @Synchronized
    fun setEnabled(agentId: String, enabled: Boolean) {
        val newMap = currentSettings.enabledAgents.toMutableMap()
        newMap[agentId] = enabled
        currentSettings = currentSettings.copy(enabledAgents = newMap)
        saveSettings()
    }

    private fun loadSettings(): SettingsData {
        if (!settingsFile.isFile) return SettingsData()
        return try {
            json.decodeFromString<SettingsData>(settingsFile.readText())
        } catch (e: Exception) {
            log.warn("Failed to load agent settings, using defaults", e)
            SettingsData()
        }
    }

    private fun saveSettings() {
        try {
            settingsFile.parentFile.mkdirs()
            settingsFile.writeText(json.encodeToString(currentSettings))
        } catch (e: Exception) {
            log.error("Failed to save agent settings", e)
        }
    }
}
