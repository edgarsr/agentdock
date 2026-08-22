package agentdock.bridge.frontend

import agentdock.acp.QuotaDetail
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * The client-side copy of the backend's quota state, for the status bar widget.
 *
 * Quotas are fetched where the agent credentials are - on the backend - but the widget lives in the
 * status bar of this process. The backend sends a snapshot whenever the numbers change.
 */
object QuotaSnapshot {

    private val _quotas = MutableStateFlow<Map<String, QuotaDetail>>(emptyMap())
    val quotas = _quotas.asStateFlow()

    fun apply(quotas: List<QuotaDetail>) {
        _quotas.value = quotas.associateBy { it.adapterId }
    }
}
