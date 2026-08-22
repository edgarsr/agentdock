package agentdock.acp

import kotlinx.serialization.Serializable

/**
 * One agent's quota, as shown by the status bar widget.
 *
 * Shared because the widget runs on the client while the quota is fetched on the backend, next to
 * the agent credentials.
 */
@Serializable
data class QuotaDetail(
    val adapterId: String,
    val adapterName: String,
    val mainPercentage: Int,
    val details: List<String> = emptyList()
)
