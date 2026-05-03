package agentdock.acp

import com.intellij.openapi.Disposable
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.util.Disposer
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.*
import java.util.concurrent.ConcurrentHashMap

@Serializable
data class QuotaDetail(
    val adapterId: String,
    val adapterName: String,
    val mainPercentage: Int,
    val details: List<String> = emptyList(),
    val rawJson: String = ""
)

object AcpQuotaService : Disposable {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val _quotas = MutableStateFlow<Map<String, QuotaDetail>>(emptyMap())
    val quotas = _quotas.asStateFlow()

    private var pollingJob: Job? = null

    init {
        Disposer.register(ApplicationManager.getApplication(), this)
        startPolling()
    }

    private fun startPolling() {
        pollingJob?.cancel()
        pollingJob = scope.launch {
            while (isActive) {
                updateQuotas()
                delay(5 * 60 * 1000) // 5 minutes
            }
        }
    }

    suspend fun updateQuotas() {
        val adapters = AcpAdapterConfig.getAllAdapters().values.filter { 
            AcpAdapterPaths.isDownloaded(it.id)
        }
        
        val newQuotas = ConcurrentHashMap<String, QuotaDetail>()
        
        adapters.map { adapter ->
            scope.launch {
                val rawJson = when (adapter.id) {
                    "claude-code" -> AcpUsageDataFetcher.fetchClaudeUsageData()
                    "codex" -> AcpUsageDataFetcher.fetchCodexUsageData()
                    "gemini-cli" -> AcpUsageDataFetcher.fetchGeminiUsageData(adapter.id)
                    "github-copilot-cli" -> AcpUsageDataFetcher.fetchCopilotUsageData(adapter.id)
                    else -> null
                }
                
                if (!rawJson.isNullOrBlank()) {
                    val detail = parseUsageDetail(adapter.id, adapter.name, rawJson)
                    if (detail != null) {
                        newQuotas[adapter.id] = detail
                    }
                }
            }
        }.joinAll()
        
        _quotas.value = newQuotas.toMap()
    }

    fun updateQuotaForAdapter(adapterId: String, rawJson: String) {
        try {
            val adapter = runCatching { AcpAdapterConfig.getAdapterInfo(adapterId) }.getOrNull() ?: return
            val detail = parseUsageDetail(adapterId, adapter.name, rawJson)
            if (detail != null) {
                val current = _quotas.value.toMutableMap()
                current[adapterId] = detail
                _quotas.value = current
            }
        } catch (_: Exception) {}
    }

    private fun parseUsageDetail(adapterId: String, adapterName: String, rawJson: String): QuotaDetail? {
        return try {
            val json = Json.parseToJsonElement(rawJson).jsonObject
            val details = mutableListOf<String>()
            var mainPercent = 0

            when (adapterId) {
                "claude-code" -> {
                    val fiveHour = json["five_hour"]?.jsonObject
                    val sevenDay = json["seven_day"]?.jsonObject
                    
                    val fiveHourPct = fiveHour?.get("utilization")?.jsonPrimitive?.doubleOrNull?.toInt()
                    val sevenDayPct = sevenDay?.get("utilization")?.jsonPrimitive?.doubleOrNull?.toInt()
                    
                    fiveHourPct?.let { details.add("5h: $it%") }
                    sevenDayPct?.let { details.add("7d: $it%") }
                    
                    mainPercent = listOfNotNull(fiveHourPct, sevenDayPct).maxOrNull() ?: 0
                }
                "gemini-cli" -> {
                    val buckets = json["quota"]?.jsonObject?.get("buckets")?.jsonArray ?: emptyList()
                    val usages = buckets.mapNotNull { b ->
                        val obj = b.jsonObject
                        val modelId = obj["modelId"]?.jsonPrimitive?.content ?: "Model"
                        val remaining = obj["remainingFraction"]?.jsonPrimitive?.doubleOrNull
                        remaining?.let { modelId to ((1.0 - it) * 100).toInt() }
                    }
                    usages.forEach { details.add("${it.first}: ${it.second}%") }
                    mainPercent = usages.map { it.second }.maxOrNull() ?: 0
                }
                "codex" -> {
                    val primary = json["primary_window"]?.jsonObject
                    val secondary = json["secondary_window"]?.jsonObject
                    
                    val pPct = primary?.get("remaining_fraction")?.jsonPrimitive?.doubleOrNull?.let { (1.0 - it) * 100 }?.toInt()
                    val sPct = secondary?.get("remaining_fraction")?.jsonPrimitive?.doubleOrNull?.let { (1.0 - it) * 100 }?.toInt()
                    
                    pPct?.let { details.add("Primary: $it%") }
                    sPct?.let { details.add("Secondary: $it%") }
                    
                    mainPercent = listOfNotNull(pPct, sPct).maxOrNull() ?: 0
                }
                "github-copilot-cli" -> {
                    val premium = json["quota_snapshots"]?.jsonObject?.get("premium_interactions")?.jsonObject
                    if (premium?.get("unlimited")?.jsonPrimitive?.booleanOrNull == true) {
                        details.add("Premium: Unlimited")
                        mainPercent = 0
                    } else {
                        // Other copilot logic if available
                    }
                }
            }
            
            QuotaDetail(adapterId, adapterName, mainPercent, details, rawJson)
        } catch (_: Exception) {
            null
        }
    }

    override fun dispose() {
        scope.cancel()
    }
}
