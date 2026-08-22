package agentdock.bridge.frontend

import agentdock.rpc.AgentDockRpcApi
import agentdock.rpc.LocalBridgeHost
import agentdock.rpc.NativeState
import agentdock.ui.AgentDockQuotaWidgetFactory
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.components.Service
import com.intellij.openapi.project.Project
import com.intellij.openapi.startup.ProjectActivity
import com.intellij.openapi.wm.impl.status.widget.StatusBarWidgetsManager
import com.intellij.platform.project.projectId
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.launch

@Service(Service.Level.PROJECT)
class FrontendNativeStateService(
    private val project: Project,
    private val scope: CoroutineScope,
) {
    init {
        scope.launch(Dispatchers.IO) { collectState() }
    }

    fun launch(block: suspend CoroutineScope.() -> Unit): Job =
        scope.launch(Dispatchers.IO, block = block)

    private suspend fun collectState() {
        val local = LocalBridgeHost.getInstanceOrNull(project)
        var previousWidgetEnabled: Boolean? = null

        while (!project.isDisposed) {
            try {
                val states: Flow<NativeState> = local?.nativeState()
                    ?: AgentDockRpcApi.getInstance().nativeState(project.projectId())
                states.collect { state ->
                    FrontendSettings.apply(state.settings)
                    QuotaSnapshot.apply(state.quotas)

                    if (previousWidgetEnabled != state.settings.quotaWidgetEnabled) {
                        previousWidgetEnabled = state.settings.quotaWidgetEnabled
                        ApplicationManager.getApplication().invokeLater {
                            if (!project.isDisposed) {
                                project.getService(StatusBarWidgetsManager::class.java)
                                    ?.updateWidget(AgentDockQuotaWidgetFactory::class.java)
                            }
                        }
                    }
                }
            } catch (e: CancellationException) {
                throw e
            } catch (_: Exception) {}
            delay(REMOTE_RECONNECT_DELAY_MS)
        }
    }
}

/** Starts native state synchronization without waiting for the JCEF tool window to be opened. */
class FrontendNativeStateActivity : ProjectActivity {
    override suspend fun execute(project: Project) {
        project.getService(FrontendNativeStateService::class.java)
    }

}
