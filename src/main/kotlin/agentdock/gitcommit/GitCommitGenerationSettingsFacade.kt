package agentdock.gitcommit

import com.intellij.openapi.project.Project
import agentdock.acp.AcpAdapterConfig
import agentdock.settings.GlobalSettingsStore

data class GitCommitGenerationConfig(
    val adapterId: String,
    val modelId: String,
    val reasoningEffortId: String,
    val instructions: String
)

object GitCommitGenerationSettingsFacade {
    fun resolve(project: Project): GitCommitGenerationConfig? {
        if (project.basePath.isNullOrBlank()) {
            return null
        }

        return runCatching {
            val settings = GlobalSettingsStore.load().gitCommitGeneration
            if (!settings.enabled) {
                return null
            }

            val adapterId = settings.adapterId.trim()
            if (adapterId.isBlank()) {
                return null
            }

            val adapterInfo = runCatching { AcpAdapterConfig.getAdapterInfo(adapterId) }.getOrNull()
                ?: return null

            GitCommitGenerationConfig(
                adapterId = adapterInfo.id,
                modelId = settings.modelId.trim(),
                reasoningEffortId = settings.reasoningEffortId.trim(),
                instructions = settings.instructions.trim()
            )
        }.getOrNull()
    }
}
