package agentdock.acp

import com.intellij.openapi.fileEditor.FileEditorManager
import com.intellij.openapi.application.readAction
import com.intellij.openapi.vfs.LocalFileSystem
import com.intellij.ui.jcef.JBCefJSQuery
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.*
import kotlinx.serialization.decodeFromString
import agentdock.changes.AgentChangeCalculator
import agentdock.changes.AgentDiffViewer
import agentdock.changes.ChangesState
import agentdock.changes.ChangesStateService
import agentdock.changes.UndoFileHandler
import agentdock.changes.UndoOperation
import agentdock.history.AgentDockHistoryService
import agentdock.utils.LocalFilePathPolicy
import java.io.File


internal fun AcpBridge.installFileChangeQueries() {
    undoFileQuery = JBCefJSQuery.create(browser as com.intellij.ui.jcef.JBCefBrowserBase).apply {
        addHandler { payload ->
            val request = runCatching {
                val raw = payload ?: "{}"
                val obj = Json.parseToJsonElement(raw).jsonObject
                UndoSingleFileRequest(
                    chatId = obj["chatId"]?.jsonPrimitive?.content ?: "",
                    filePath = obj["filePath"]?.jsonPrimitive?.content ?: "",
                    status = obj["status"]?.jsonPrimitive?.content ?: "M",
                    operations = obj["operations"]?.jsonArray?.map { opEl ->
                        val opObj = opEl.jsonObject
                        UndoOperation(
                            opObj["oldText"]?.jsonPrimitive?.content ?: "",
                            opObj["newText"]?.jsonPrimitive?.content ?: ""
                        )
                    } ?: emptyList()
                )
            }.getOrNull()

            if (request != null && request.chatId.isNotEmpty() && request.filePath.isNotEmpty()) {
                runOnEdt {
                    val result = UndoFileHandler.undoSingleFile(
                        service.project,
                        request.filePath,
                        request.status,
                        request.operations
                    )
                    pushUndoResult(request.chatId, result)
                }
            }
            JBCefJSQuery.Response("ok")
        }
    }

    undoAllFilesQuery = JBCefJSQuery.create(browser as com.intellij.ui.jcef.JBCefBrowserBase).apply {
        addHandler { payload ->
            val request = runCatching {
                val obj = Json.parseToJsonElement(payload ?: "{}").jsonObject
                val filesArr = obj["files"]?.jsonArray ?: return@runCatching null
                UndoAllFilesRequest(
                    chatId = obj["chatId"]?.jsonPrimitive?.content ?: "",
                    files = filesArr.map { fEl ->
                        val fObj = fEl.jsonObject
                        val path = fObj["filePath"]?.jsonPrimitive?.content ?: ""
                        val status = fObj["status"]?.jsonPrimitive?.content ?: "M"
                        val operations = fObj["operations"]?.jsonArray?.map { opEl ->
                            val opObj = opEl.jsonObject
                            UndoOperation(
                                opObj["oldText"]?.jsonPrimitive?.content ?: "",
                                opObj["newText"]?.jsonPrimitive?.content ?: ""
                            )
                        } ?: emptyList()
                        Triple(path, status, operations)
                    }
                )
            }.getOrNull()

            if (request != null && request.chatId.isNotEmpty()) {
                runOnEdt {
                    val result = UndoFileHandler.undoAllFiles(service.project, request.files)
                    pushUndoResult(request.chatId, result)
                }
            }
            JBCefJSQuery.Response("ok")
        }
    }

    processFileQuery = JBCefJSQuery.create(browser as com.intellij.ui.jcef.JBCefBrowserBase).apply {
        addHandler { payload ->
            runCatching {
                val obj = Json.parseToJsonElement(payload ?: "{}").jsonObject
                val sessionId = obj["sessionId"]?.jsonPrimitive?.content ?: ""
                val adapterName = obj["adapterName"]?.jsonPrimitive?.content ?: ""
                val filePath = obj["filePath"]?.jsonPrimitive?.content ?: ""
                val toolCallIndex = obj["toolCallIndex"]?.jsonPrimitive?.content?.toIntOrNull()
                if (sessionId.isNotEmpty() && adapterName.isNotEmpty() && filePath.isNotEmpty() && toolCallIndex != null) {
                    ChangesStateService.markFileProcessed(
                        service.project.basePath.orEmpty(),
                        sessionId,
                        adapterName,
                        filePath,
                        toolCallIndex
                    )
                }
            }
            JBCefJSQuery.Response("ok")
        }
    }

    keepAllQuery = JBCefJSQuery.create(browser as com.intellij.ui.jcef.JBCefBrowserBase).apply {
        addHandler { payload ->
            runCatching {
                val obj = Json.parseToJsonElement(payload ?: "{}").jsonObject
                val sessionId = obj["sessionId"]?.jsonPrimitive?.content ?: ""
                val adapterName = obj["adapterName"]?.jsonPrimitive?.content ?: ""
                val toolCallIndex = obj["toolCallIndex"]?.jsonPrimitive?.content?.toIntOrNull() ?: 0
                if (sessionId.isNotEmpty() && adapterName.isNotEmpty()) {
                    ChangesStateService.setBaseIndex(service.project.basePath.orEmpty(), sessionId, adapterName, toolCallIndex)
                }
            }
            JBCefJSQuery.Response("ok")
        }
    }

    removeProcessedFilesQuery = JBCefJSQuery.create(browser as com.intellij.ui.jcef.JBCefBrowserBase).apply {
        addHandler { payload ->
            runCatching {
                val obj = Json.parseToJsonElement(payload ?: "{}").jsonObject
                val sessionId = obj["sessionId"]?.jsonPrimitive?.content ?: ""
                val adapterName = obj["adapterName"]?.jsonPrimitive?.content ?: ""
                val filePaths = obj["filePaths"]?.jsonArray?.mapNotNull { it.jsonPrimitive?.content } ?: emptyList()
                if (sessionId.isNotEmpty() && adapterName.isNotEmpty() && filePaths.isNotEmpty()) {
                    ChangesStateService.removeProcessedFiles(service.project.basePath.orEmpty(), sessionId, adapterName, filePaths)
                }
            }
            JBCefJSQuery.Response("ok")
        }
    }

    getChangesStateQuery = JBCefJSQuery.create(browser as com.intellij.ui.jcef.JBCefBrowserBase).apply {
        addHandler { payload ->
            runCatching {
                val obj = Json.parseToJsonElement(payload ?: "{}").jsonObject
                val chatId = obj["chatId"]?.jsonPrimitive?.content ?: ""
                val sessionId = obj["sessionId"]?.jsonPrimitive?.content ?: ""
                val adapterName = obj["adapterName"]?.jsonPrimitive?.content ?: ""
                if (chatId.isNotEmpty() && sessionId.isNotEmpty() && adapterName.isNotEmpty()) {
                    val state = ChangesStateService.loadState(service.project.basePath.orEmpty(), sessionId, adapterName)
                    val hasPluginEdits = state != null
                    pushChangesState(chatId, state ?: ChangesState(sessionId, adapterName), hasPluginEdits)
                }
            }
            JBCefJSQuery.Response("ok")
        }
    }

    computeFileChangeStatsQuery = JBCefJSQuery.create(browser as com.intellij.ui.jcef.JBCefBrowserBase).apply {
        addHandler { payload ->
            runCatching {
                val request = adapterJson.decodeFromString<FileChangeStatsRequestPayload>(payload ?: "{}")
                if (request.requestId.isNotBlank()) {
                    val files = request.files.mapNotNull { file ->
                        val operations = file.operations.map { UndoOperation(oldText = it.oldText, newText = it.newText) }
                        AgentChangeCalculator.computeFileStats(
                            project = service.project,
                            filePath = file.filePath,
                            status = file.status,
                            operations = operations
                        )?.let {
                            FileChangeStatsPayload(
                                filePath = it.filePath,
                                additions = it.additions,
                                deletions = it.deletions
                            )
                        }
                    }
                    pushFileChangeStats(FileChangeStatsResultPayload(requestId = request.requestId, files = files))
                }
            }
            JBCefJSQuery.Response("ok")
        }
    }

    showDiffQuery = JBCefJSQuery.create(browser as com.intellij.ui.jcef.JBCefBrowserBase).apply {
        addHandler { payload ->
            runCatching {
                val obj = Json.parseToJsonElement(payload ?: "{}").jsonObject
                val filePath = obj["filePath"]?.jsonPrimitive?.content ?: ""
                val status = obj["status"]?.jsonPrimitive?.content ?: "M"
                val ops = obj["operations"]?.jsonArray?.map { opEl ->
                    val opObj = opEl.jsonObject
                    UndoOperation(
                        opObj["oldText"]?.jsonPrimitive?.content ?: "",
                        opObj["newText"]?.jsonPrimitive?.content ?: ""
                    )
                } ?: emptyList()
                if (filePath.isNotEmpty()) {
                    runOnEdt {
                        AgentDiffViewer.showAgentDiff(service.project, filePath, status, ops)
                    }
                }
            }
            JBCefJSQuery.Response("ok")
        }
    }

}

internal fun AcpBridge.installMiscQueries() {
    searchFilesQuery = JBCefJSQuery.create(browser as com.intellij.ui.jcef.JBCefBrowserBase).apply {
        addHandler { payload ->
            val rawQuery = payload?.trim() ?: ""
            val query = rawQuery.lowercase()
            scope.launch(kotlinx.coroutines.Dispatchers.IO) {
                val results = mutableListOf<FileSearchItem>()
                val seenPaths = mutableSetOf<String>()
                val project = service.project
                val basePath = project.basePath ?: ""
                
                fun addIfMatch(virtualFile: com.intellij.openapi.vfs.VirtualFile): Boolean {
                    if (virtualFile.isDirectory) return false
                    val path = virtualFile.path
                    if (seenPaths.contains(path)) return false
                    
                    val name = virtualFile.name
                    val relPath = path.removePrefix(basePath).trimStart('/', '\\')
                    
                    val matches = if (rawQuery.isNotEmpty()) {
                        fuzzyFileMatch(name, query) || fuzzyFileMatch(relPath, query) || relPath.lowercase().contains(query)
                    } else true
                    
                    if (matches) {
                        results.add(FileSearchItem(relPath, name))
                        seenPaths.add(path)
                        return true
                    }
                    return false
                }

                readAction {
                    // Priority 1: Open files
                    com.intellij.openapi.fileEditor.FileEditorManager.getInstance(project).openFiles?.forEach {
                        if (results.size < 50) addIfMatch(it)
                    }
                    
                    // Priority 2: Recent files
                    com.intellij.openapi.fileEditor.impl.EditorHistoryManager.getInstance(project).fileList?.reversed()?.forEach {
                        if (results.size < 50) addIfMatch(it)
                    }
                    
                    // Priority 3: Index iteration (the rest)
                    if (results.size < 50 && basePath.isNotEmpty()) {
                        com.intellij.openapi.roots.ProjectFileIndex.getInstance(project).iterateContent { virtualFile ->
                            if (results.size >= 50) return@iterateContent false
                            addIfMatch(virtualFile)
                            true
                        }
                    }
                }
                val list = results.toList()
                val json = try { kotlinx.serialization.json.Json.encodeToString<List<FileSearchItem>>(list) } catch (e: Exception) { "[]" }
                runOnEdt {
                    browser.cefBrowser.executeJavaScript(
                        "if(window.__onFilesResult) window.__onFilesResult(" + json + ");",
                        browser.cefBrowser.url, 0
                    )
                }
            }
            JBCefJSQuery.Response("ok")
        }
    }
    openFileQuery = JBCefJSQuery.create(browser as com.intellij.ui.jcef.JBCefBrowserBase).apply {
        addHandler { payload ->
            val request = runCatching {
                val obj = Json.parseToJsonElement(payload ?: "{}").jsonObject
                OpenFileRequest(
                    filePath = obj["filePath"]?.jsonPrimitive?.content ?: "",
                    line = obj["line"]?.jsonPrimitive?.intOrNull ?: -1
                )
            }.getOrNull()

            if (request != null && request.filePath.isNotEmpty()) {
                runOnEdt {
                    openRequestedFile(request)
                }
            }
            JBCefJSQuery.Response("ok")
        }
    }

    openUrlQuery = JBCefJSQuery.create(browser as com.intellij.ui.jcef.JBCefBrowserBase).apply {
        addHandler { url ->
            if (url != null && url.isNotBlank()) {
                runOnEdt {
                    runCatching {
                        com.intellij.ide.BrowserUtil.browse(url)
                    }
                }
            }
            JBCefJSQuery.Response("ok")
        }
    }

    attachFileQuery = JBCefJSQuery.create(browser as com.intellij.ui.jcef.JBCefBrowserBase).apply {
        addHandler { chatId ->
            val normalizedChatId = chatId?.trim().orEmpty()
            if (normalizedChatId.isNotEmpty()) {
                runOnEdt {
                    val descriptor = com.intellij.openapi.fileChooser.FileChooserDescriptor(true, false, false, false, false, true)
                    descriptor.title = "Select Files to Attach"
                    com.intellij.openapi.fileChooser.FileChooser.chooseFiles(descriptor, service.project, null) { files ->
                        val results = files.map { file ->
                            val ioFile = File(file.path)
                            val size = ioFile.length()
                            val name = file.name
                            val mimeType = java.net.URLConnection.guessContentTypeFromName(name) ?: "application/octet-stream"
                            val base64 = if (size < 2 * 1024 * 1024) {
                                try {
                                    java.util.Base64.getEncoder().encodeToString(ioFile.readBytes())
                                } catch (e: Exception) {
                                    null
                                }
                            } else {
                                null
                            }

                            val fileId = java.util.UUID.randomUUID().toString().substring(0, 8)
                            buildJsonObject {
                                put("id", fileId)
                                put("name", name)
                                put("mimeType", mimeType)
                                if (base64 != null) {
                                    put("data", base64)
                                } else {
                                    put("path", file.path)
                                }
                            }.toString()
                        }

                        val jsonArrayStr = results.joinToString(",")
                        browser.cefBrowser.executeJavaScript(
                            "if(window.__onAttachmentsAdded) window.__onAttachmentsAdded(${jsStringLiteral(normalizedChatId)}, [$jsonArrayStr]);",
                            browser.cefBrowser.url, 0
                        )
                    }
                }
            }
            JBCefJSQuery.Response("ok")
        }
    }

}

private data class UndoSingleFileRequest(
    val chatId: String,
    val filePath: String,
    val status: String,
    val operations: List<UndoOperation>
)

private data class UndoAllFilesRequest(
    val chatId: String,
    val files: List<Triple<String, String, List<UndoOperation>>>
)

private data class OpenFileRequest(
    val filePath: String,
    val line: Int
)

private fun fuzzyFileMatch(candidate: String, lowercaseQuery: String): Boolean {
    if (lowercaseQuery.isEmpty()) return true
    var queryIndex = 0
    for (char in candidate) {
        if (char.lowercaseChar() == lowercaseQuery[queryIndex]) {
            queryIndex += 1
            if (queryIndex == lowercaseQuery.length) return true
        }
    }
    return false
}

private fun AcpBridge.openRequestedFile(request: OpenFileRequest): Boolean {
    return runCatching {
        val resolved = LocalFilePathPolicy.resolve(service.project, request.filePath)
        val vf = LocalFileSystem.getInstance().refreshAndFindFileByIoFile(File(resolved.canonicalPath))
            ?.takeIf { it.exists() }
            ?: return false

        if (request.line >= 0) {
            val descriptor = com.intellij.openapi.fileEditor.OpenFileDescriptor(service.project, vf, request.line, 0)
            FileEditorManager.getInstance(service.project).openEditor(descriptor, true)
        } else {
            FileEditorManager.getInstance(service.project).openFile(vf, true)
        }
        true
    }.getOrDefault(false)
}
