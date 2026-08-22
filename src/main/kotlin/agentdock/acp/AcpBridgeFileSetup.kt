package agentdock.acp

import com.intellij.openapi.fileEditor.FileEditorManager
import com.intellij.openapi.application.readAction
import com.intellij.openapi.fileTypes.FileTypeManager
import com.intellij.openapi.vfs.LocalFileSystem
import com.intellij.psi.codeStyle.NameUtil
import com.intellij.psi.search.FilenameIndex
import com.intellij.psi.search.GlobalSearchScope
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
import agentdock.utils.LocalFilePathPolicy
import agentdock.utils.jsStringLiteral
import java.io.File


internal fun AcpBridge.installFileChangeQueries() {
    host.register("undoFile") { payload ->
        val request = runCatching {
            val raw = payload
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
    }

    host.register("undoAllFiles") { payload ->
        val request = runCatching {
            val obj = Json.parseToJsonElement(payload).jsonObject
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
    }

    host.register("processFile") { payload ->
        runCatching {
            val obj = Json.parseToJsonElement(payload).jsonObject
            val sessionId = obj["sessionId"]?.jsonPrimitive?.content ?: ""
            val adapterName = obj["adapterName"]?.jsonPrimitive?.content ?: ""
            val filePath = obj["filePath"]?.jsonPrimitive?.content ?: ""
            val toolCallIds = obj["toolCallIds"]?.jsonArray?.mapNotNull { it.jsonPrimitive.contentOrNull }.orEmpty()
            if (sessionId.isNotEmpty() && adapterName.isNotEmpty() && filePath.isNotEmpty() && toolCallIds.isNotEmpty()) {
                ChangesStateService.markFileProcessed(
                    service.project.basePath.orEmpty(),
                    sessionId,
                    adapterName,
                    filePath,
                    toolCallIds
                )
            }
        }
    }

    host.register("keepAll") { payload ->
        runCatching {
            val obj = Json.parseToJsonElement(payload).jsonObject
            val sessionId = obj["sessionId"]?.jsonPrimitive?.content ?: ""
            val adapterName = obj["adapterName"]?.jsonPrimitive?.content ?: ""
            val toolCallIds = obj["toolCallIds"]?.jsonArray?.mapNotNull { it.jsonPrimitive.contentOrNull }.orEmpty()
            if (sessionId.isNotEmpty() && adapterName.isNotEmpty()) {
                ChangesStateService.markAllProcessed(
                    service.project.basePath.orEmpty(),
                    sessionId,
                    adapterName,
                    toolCallIds
                )
            }
        }
    }

    host.register("getChangesState") { payload ->
        runCatching {
            val obj = Json.parseToJsonElement(payload).jsonObject
            val chatId = obj["chatId"]?.jsonPrimitive?.content ?: ""
            val sessionId = obj["sessionId"]?.jsonPrimitive?.content ?: ""
            val adapterName = obj["adapterName"]?.jsonPrimitive?.content ?: ""
            if (chatId.isNotEmpty() && sessionId.isNotEmpty() && adapterName.isNotEmpty()) {
                val state = ChangesStateService.loadState(service.project.basePath.orEmpty(), sessionId, adapterName)
                val hasPluginEdits = state != null
                pushChangesState(chatId, state ?: ChangesState(sessionId, adapterName), hasPluginEdits)
            }
        }
    }

    host.register("computeFileChangeStats") { payload ->
        val raw = payload
        // The id is read before anything that can fail, so a failure is still answered
        // instead of leaving the frontend request pending until its timeout.
        val requestId = runCatching {
            Json.parseToJsonElement(raw).jsonObject["requestId"]?.jsonPrimitive?.content
        }.getOrNull().orEmpty()

        if (requestId.isNotBlank()) {
            val files = runCatching {
                adapterJson.decodeFromString<FileChangeStatsRequestPayload>(raw).files.mapNotNull { file ->
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
            }.getOrDefault(emptyList())
            pushFileChangeStats(FileChangeStatsResultPayload(requestId = requestId, files = files))
        }
    }

    host.register("showDiff") { payload ->
        runCatching {
            val obj = Json.parseToJsonElement(payload).jsonObject
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
    }

}

internal fun AcpBridge.installMiscQueries() {
    host.register("searchFiles") { payload ->
        val rawQuery = payload.trim()
        scope.launch(kotlinx.coroutines.Dispatchers.IO) {
            val results = mutableListOf<RankedFileSearchItem>()
            val seenPaths = mutableSetOf<String>()
            val project = service.project
            val basePath = project.basePath ?: ""
            val fileIndex = com.intellij.openapi.roots.ProjectFileIndex.getInstance(project)
            val fileTypeManager = FileTypeManager.getInstance()
            val searchScope = GlobalSearchScope.projectScope(project)
            val matcher = rawQuery.takeIf { it.isNotEmpty() }?.let { NameUtil.buildMatcher("*$it").build() }

            fun addCandidate(virtualFile: com.intellij.openapi.vfs.VirtualFile): Boolean {
                if (virtualFile.isDirectory) return false
                val path = virtualFile.path
                if (seenPaths.contains(path)) return false
                if (!fileIndex.isInContent(virtualFile) || fileIndex.isExcluded(virtualFile) || fileTypeManager.isFileIgnored(virtualFile)) return false

                val name = virtualFile.name
                val relPath = path.removePrefix(basePath).trimStart('/', '\\')
                if (isHiddenDirectoryFileSearchPath(relPath, rawQuery)) return false
                if (matcher != null && !matcher.matches(name)) return false
                val matchingDegree = matcher?.matchingDegree(name).takeIf { it != null && it > 0 } ?: 0

                results.add(
                    RankedFileSearchItem(
                        item = FileSearchItem(relPath, name),
                        matchingDegree = matchingDegree,
                        isSourceContent = fileIndex.isInSourceContent(virtualFile),
                        isBinary = virtualFile.fileType.isBinary
                    )
                )
                seenPaths.add(path)
                return true
            }

            readAction {
                // Priority 1: Open files
                com.intellij.openapi.fileEditor.FileEditorManager.getInstance(project).openFiles?.forEach {
                    if (results.size < 50) addCandidate(it)
                }

                // Priority 2: Recent files
                com.intellij.openapi.fileEditor.impl.EditorHistoryManager.getInstance(project).fileList?.reversed()?.forEach {
                    if (results.size < 50) addCandidate(it)
                }

                if (matcher != null && results.size < 50) {
                    val activeMatcher = matcher
                    FilenameIndex.processAllFileNames({ fileName ->
                        if (results.size >= FILE_SEARCH_MAX_CANDIDATES) return@processAllFileNames false
                        if (!activeMatcher.matches(fileName)) return@processAllFileNames true

                        FilenameIndex.getVirtualFilesByName(fileName, searchScope).forEach { virtualFile ->
                            if (results.size >= FILE_SEARCH_MAX_CANDIDATES) return@processAllFileNames false
                            addCandidate(virtualFile)
                        }
                        true
                    }, searchScope, null)
                } else if (rawQuery.isEmpty() && results.size < 50 && basePath.isNotEmpty()) {
                    fileIndex.iterateContent { virtualFile ->
                        if (results.size >= 50) return@iterateContent false
                        addCandidate(virtualFile)
                        true
                    }
                }
            }
            val list = if (matcher == null) {
                results.map { it.item }.take(50)
            } else {
                results.sortedWith(
                    compareByDescending<RankedFileSearchItem> { it.isSourceContent }
                        .thenBy { it.isBinary }
                        .thenByDescending { it.matchingDegree }
                        .thenBy { it.item.path }
                )
                    .map { it.item }
                    .take(50)
            }
            val json = try { kotlinx.serialization.json.Json.encodeToString<List<FileSearchItem>>(list) } catch (e: Exception) { "[]" }
            host.eval("if(window.__onFilesResult) window.__onFilesResult(" + json + ");")
        }
    }
    host.register("openFile") { payload ->
        val request = runCatching {
            val obj = Json.parseToJsonElement(payload).jsonObject
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
    }

    host.register("attachFile") { chatId ->
        val normalizedChatId = chatId.trim()
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
                        val canInline = mimeType.startsWith("image/") || mimeType.startsWith("video/")
                        val base64 = if (canInline && size < 2 * 1024 * 1024) {
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
                            put("path", file.path)
                            if (base64 != null) {
                                put("data", base64)
                            }
                        }.toString()
                    }

                    val jsonArrayStr = results.joinToString(",")
                    host.eval("if(window.__onAttachmentsAdded) window.__onAttachmentsAdded(${normalizedChatId.jsStringLiteral()}, [$jsonArrayStr]);")
                }
            }
        }
    }

}

internal fun AcpBridge.installFileIconQuery() {
    val provider = FileIconProvider(service.project)
    fileIconProvider = provider

    host.register("iconFile") { payload ->
        val path = runCatching {
            Json.parseToJsonElement(payload).jsonObject["path"]?.jsonPrimitive?.content
        }.getOrNull().orEmpty()

        if (path.isNotBlank()) scope.launch(Dispatchers.IO) {
            // One file per request, so the read action stays short enough not to stall writes.
            val icon = readAction { provider.iconForPath(path) }.orEmpty()
            host.eval("if(window.__onFileIconResult) window.__onFileIconResult(" +
                        "${buildJsonObject { put("path", path); put("icon", icon) }});")
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

private data class RankedFileSearchItem(
    val item: FileSearchItem,
    val matchingDegree: Int,
    val isSourceContent: Boolean,
    val isBinary: Boolean
)

private const val FILE_SEARCH_MAX_CANDIDATES = 500

internal fun isHiddenDirectoryFileSearchPath(relPath: String, rawQuery: String): Boolean {
    if (rawQuery.trim().startsWith(".")) return false

    val segments = relPath.replace('\\', '/')
        .trimStart('/')
        .split('/')
        .filter { it.isNotBlank() }

    return segments.dropLast(1).any { it.startsWith(".") }
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
