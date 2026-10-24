package agentdock

import com.intellij.openapi.diagnostic.logger
import com.intellij.openapi.project.Project
import com.intellij.util.concurrency.AppExecutorUtil
import kotlinx.serialization.json.Json
import kotlinx.serialization.Serializable
import agentdock.ui.AgentDockUiHost
import agentdock.utils.jsStringLiteral
import java.util.concurrent.TimeUnit

@Serializable
data class ExternalCodeReference(
    val path: String,
    val fileName: String,
    val startLine: Int? = null,
    val endLine: Int? = null
)

object ExternalCodeReferenceDispatcher {
    private val LOG = logger<ExternalCodeReferenceDispatcher>()
    private val json = Json { encodeDefaults = true }

    fun dispatch(project: Project, reference: ExternalCodeReference, retriesLeft: Int = 10) {
        if (project.isDisposed) return

        val payload = json.encodeToString(reference).jsStringLiteral()
        val script = "window.dispatchEvent(new CustomEvent('external-code-reference', { detail: JSON.parse($payload) }));"
        if (AgentDockUiHost.getInstance(project).eval(script)) return

        if (retriesLeft <= 0) {
            LOG.warn("Failed to dispatch code reference after retries: ${reference.path}")
            return
        }

        AppExecutorUtil.getAppScheduledExecutorService().schedule(
            { dispatch(project, reference, retriesLeft - 1) },
            150,
            TimeUnit.MILLISECONDS
        )
    }
}
