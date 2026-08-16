package agentdock

import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.diagnostic.logger
import com.intellij.openapi.project.Project
import com.intellij.ui.jcef.JBCefBrowser
import com.intellij.util.concurrency.AppExecutorUtil
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import kotlinx.serialization.Serializable
import agentdock.utils.jsStringLiteral
import java.util.concurrent.ConcurrentHashMap
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
    private val browsers = ConcurrentHashMap<Project, JBCefBrowser>()
    private val json = Json { encodeDefaults = true }

    fun register(project: Project, browser: JBCefBrowser) {
        browsers[project] = browser
    }

    fun unregister(project: Project, browser: JBCefBrowser) {
        browsers.remove(project, browser)
    }

    fun dispatch(project: Project, reference: ExternalCodeReference, retriesLeft: Int = 10) {
        if (project.isDisposed) return

        val browser = browsers[project]
        if (browser != null) {
            val payload = json.encodeToString(reference).jsStringLiteral()
            ApplicationManager.getApplication().invokeLater {
                if (!project.isDisposed) {
                    browser.cefBrowser.executeJavaScript(
                        """
                        (function() {
                          const payload = JSON.parse($payload);
                          window.dispatchEvent(new CustomEvent('external-code-reference', { detail: payload }));
                        })();
                        """.trimIndent(),
                        browser.cefBrowser.url,
                        0
                    )
                }
            }
            return
        }

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
