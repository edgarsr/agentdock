package unified.llm.systeminstructions

import com.intellij.openapi.application.ApplicationManager
import com.intellij.ui.jcef.JBCefBrowser
import com.intellij.ui.jcef.JBCefJSQuery
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.Json
import org.cef.browser.CefBrowser
import unified.llm.utils.escapeForJsString

private val json = Json { ignoreUnknownKeys = true }

class SystemInstructionsBridge(
    private val browser: JBCefBrowser,
    private val scope: CoroutineScope
) {
    private var loadQuery: JBCefJSQuery? = null
    private var saveQuery: JBCefJSQuery? = null

    fun install() {
        loadQuery = JBCefJSQuery.create(browser as com.intellij.ui.jcef.JBCefBrowserBase).apply {
            addHandler {
                scope.launch(Dispatchers.IO) {
                    push(SystemInstructionsStore.load())
                }
                JBCefJSQuery.Response("ok")
            }
        }

        saveQuery = JBCefJSQuery.create(browser as com.intellij.ui.jcef.JBCefBrowserBase).apply {
            addHandler { payload ->
                if (!payload.isNullOrBlank()) {
                    scope.launch(Dispatchers.IO) {
                        runCatching {
                            val instructions = json.decodeFromString(ListSerializer(SystemInstruction.serializer()), payload)
                            SystemInstructionsStore.save(instructions)
                            push(instructions)
                        }
                    }
                }
                JBCefJSQuery.Response("ok")
            }
        }
    }

    fun injectApi(cefBrowser: CefBrowser) {
        val loadInject = loadQuery?.inject("") ?: "console.error('[SystemInstructionsBridge] Load query not ready')"
        val saveInject = saveQuery?.inject("json") ?: "console.error('[SystemInstructionsBridge] Save query not ready')"

        val script = """
            (function() {
                window.__onSystemInstructions = window.__onSystemInstructions || function(instructions) {};
                window.__loadSystemInstructions = function() {
                    try { $loadInject } catch (e) { console.error('[SystemInstructionsBridge] Load error', e); }
                };
                window.__saveSystemInstructions = function(json) {
                    if (!json) return;
                    try { $saveInject } catch (e) { console.error('[SystemInstructionsBridge] Save error', e); }
                };
            })();
        """.trimIndent()
        cefBrowser.executeJavaScript(script, cefBrowser.url, 0)
    }

    private fun push(instructions: List<SystemInstruction>) {
        val payload = Json.encodeToString(ListSerializer(SystemInstruction.serializer()), instructions).escapeForJsString()
        ApplicationManager.getApplication().invokeLater {
            browser.cefBrowser.executeJavaScript(
                "if(window.__onSystemInstructions) window.__onSystemInstructions(JSON.parse('$payload'));",
                browser.cefBrowser.url,
                0
            )
        }
    }
}
