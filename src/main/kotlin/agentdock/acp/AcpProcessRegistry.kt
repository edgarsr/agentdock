package agentdock.acp

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.io.File
import java.io.RandomAccessFile
import java.security.MessageDigest
import java.util.UUID

internal object AcpProcessRegistry {
    private val store = AcpProcessRegistryStore(
        baseDir = File(AcpExecutionMode.localBaseRuntimeDir(), "processes"),
        currentOwnerPid = ProcessHandle.current().pid(),
        currentOwnerId = "${ProcessHandle.current().pid()}-${UUID.randomUUID()}",
        isProcessAlive = { pid -> runCatching { ProcessHandle.of(pid).map { it.isAlive }.orElse(false) }.getOrDefault(false) },
        destroyRegisteredProcess = { pid, root -> AcpProcessUtils.destroyProcessTreeIfUsingAdapterRoot(pid, File(root)) },
        // Only reached while the last owner closes, where nothing will touch the adapter files
        // again, so the kill is issued without waiting for the processes to confirm they died.
        stopProcessesUsingRoots = { roots ->
            AcpProcessUtils.stopProcessesUsingAdapterRootPaths(roots.map(::File), awaitExit = false)
        }
    )

    // The registry is best-effort housekeeping: a failure here must never reach the UI or stop the
    // caller, and nothing is logged - see "Failure handling" in AGENTS.md.
    private fun runQuietly(action: () -> Unit) {
        runCatching(action)
    }

    fun registerOwner() = runQuietly {
        store.registerOwner()
    }

    fun registerProcess(adapterId: String, adapterRoot: String, process: Process) = runQuietly {
        val pid = runCatching { process.toHandle().pid() }.getOrNull() ?: return@runQuietly
        store.registerProcess(adapterId, adapterRoot, pid)
    }

    fun unregisterProcess(process: Process?) = runQuietly {
        val pid = runCatching { process?.toHandle()?.pid() }.getOrNull() ?: return@runQuietly
        store.unregisterProcess(pid)
    }

    fun closeOwnerAndCleanupIfLast() = runQuietly {
        store.closeOwnerAndCleanupIfLast()
    }
}

internal class AcpProcessRegistryStore(
    private val baseDir: File,
    private val currentOwnerPid: Long,
    private val currentOwnerId: String,
    private val isProcessAlive: (Long) -> Boolean,
    private val destroyRegisteredProcess: (Long, String) -> Unit,
    private val stopProcessesUsingRoots: (List<String>) -> Unit
) {
    private val ownersDir = File(baseDir, "owners")
    private val rootsDir = File(baseDir, "roots")
    private val lockFile = File(baseDir, "registry.lock")
    private val localLock = Any()
    private val ownerFile: File get() = File(ownersDir, "$currentOwnerId.json")

    fun registerOwner() = withRegistryLock {
        ownersDir.mkdirs()
        rootsDir.mkdirs()
        cleanupDeadOwnersLocked()
        writeOwnerLocked(readCurrentOwnerLocked() ?: OwnerState(currentOwnerId, currentOwnerPid))
    }

    fun registerProcess(adapterId: String, adapterRoot: String, pid: Long) = withRegistryLock {
        ownersDir.mkdirs()
        rootsDir.mkdirs()
        val normalizedRoot = normalizeRoot(adapterRoot)
        rememberRootLocked(normalizedRoot)
        val current = readCurrentOwnerLocked() ?: OwnerState(currentOwnerId, currentOwnerPid)
        val roots = (current.adapterRoots + AdapterRoot(adapterId, normalizedRoot))
            .distinctBy { "${it.adapterId}\u0000${it.root}" }
        val processes = (current.processes.filterNot { it.pid == pid } + OwnedProcess(pid, adapterId, normalizedRoot))
            .filter { isProcessAlive(it.pid) || it.pid == pid }
        writeOwnerLocked(current.copy(adapterRoots = roots, processes = processes))
    }

    fun unregisterProcess(pid: Long) = withRegistryLock {
        val current = readCurrentOwnerLocked() ?: return@withRegistryLock
        writeOwnerLocked(current.copy(processes = current.processes.filterNot { it.pid == pid }))
    }

    fun closeOwnerAndCleanupIfLast() = withRegistryLock {
        val current = readCurrentOwnerLocked()
        if (ownerFile.exists()) {
            ownerFile.delete()
        }

        val otherOwners = readOwnerStatesLocked()
        val liveOwners = otherOwners.filter { isProcessAlive(it.ownerPid) }
        val deadOwners = otherOwners.filterNot { isProcessAlive(it.ownerPid) }
        deadOwners.forEach { owner ->
            owner.processes.forEach { process -> destroyRegisteredProcess(process.pid, process.adapterRoot) }
            File(ownersDir, "${owner.ownerId}.json").delete()
        }

        if (liveOwners.isNotEmpty()) return@withRegistryLock

        val roots = (listOfNotNull(current) + deadOwners)
            .flatMap { it.adapterRoots.map(AdapterRoot::root) + it.processes.map(OwnedProcess::adapterRoot) }
            .plus(readRememberedRootsLocked())
            .map(::normalizeRoot)
            .filter { it.isNotBlank() }
            .distinct()
        stopProcessesUsingRoots(roots)
        rootsDir.listFiles().orEmpty().forEach { it.delete() }
    }

    private fun cleanupDeadOwnersLocked() {
        ownerFilesLocked().forEach { file ->
            val owner = readOwnerStateLocked(file)
            if (owner == null) {
                // Damaged state carries no information any more, so the file is litter either way.
                // Removing it here is what keeps a crash from leaving something behind for good.
                file.delete()
                return@forEach
            }
            if (owner.ownerId == currentOwnerId || isProcessAlive(owner.ownerPid)) return@forEach
            owner.processes.forEach { process -> destroyRegisteredProcess(process.pid, process.adapterRoot) }
            file.delete()
        }
    }

    private fun readCurrentOwnerLocked(): OwnerState? = readOwnerStateLocked(ownerFile)

    private fun ownerFilesLocked(): List<File> =
        ownersDir.listFiles { file -> file.isFile && file.extension == "json" }.orEmpty().toList()

    private fun readOwnerStatesLocked(): List<OwnerState> = ownerFilesLocked().mapNotNull(::readOwnerStateLocked)

    private fun readOwnerStateLocked(file: File): OwnerState? {
        if (!file.isFile) return null
        // A truncated or unreadable owner file (crash mid-write, full disk) is treated as absent
        // instead of failing the whole registry operation - see "Failure handling" in AGENTS.md.
        val json = runCatching { Json.parseToJsonElement(file.readText()).jsonObject }.getOrNull() ?: return null
        val ownerId = json["ownerId"]?.jsonPrimitive?.contentOrNull?.takeIf { it.isNotBlank() } ?: return null
        val ownerPid = json["ownerPid"]?.jsonPrimitive?.contentOrNull?.toLongOrNull() ?: return null
        val roots = json["adapterRoots"]?.jsonArray?.mapNotNull { element ->
            val root = element.jsonObject
            val adapterId = root["adapterId"]?.jsonPrimitive?.contentOrNull?.takeIf { it.isNotBlank() } ?: return@mapNotNull null
            val adapterRoot = root["root"]?.jsonPrimitive?.contentOrNull?.takeIf { it.isNotBlank() } ?: return@mapNotNull null
            AdapterRoot(adapterId, adapterRoot)
        }.orEmpty()
        val processes = json["processes"]?.jsonArray?.mapNotNull { element ->
            val process = element.jsonObject
            val pid = process["pid"]?.jsonPrimitive?.contentOrNull?.toLongOrNull() ?: return@mapNotNull null
            val adapterId = process["adapterId"]?.jsonPrimitive?.contentOrNull?.takeIf { it.isNotBlank() } ?: return@mapNotNull null
            val adapterRoot = process["adapterRoot"]?.jsonPrimitive?.contentOrNull?.takeIf { it.isNotBlank() } ?: return@mapNotNull null
            OwnedProcess(pid, adapterId, adapterRoot)
        }.orEmpty()
        return OwnerState(ownerId, ownerPid, roots, processes)
    }

    private fun writeOwnerLocked(owner: OwnerState) {
        ownersDir.mkdirs()
        val now = System.currentTimeMillis().toString()
        val json = buildJsonObject {
            put("ownerId", JsonPrimitive(owner.ownerId))
            put("ownerPid", JsonPrimitive(owner.ownerPid.toString()))
            put("updatedAt", JsonPrimitive(now))
            put("adapterRoots", JsonArray(owner.adapterRoots.map { root ->
                buildJsonObject {
                    put("adapterId", JsonPrimitive(root.adapterId))
                    put("root", JsonPrimitive(root.root))
                }
            }))
            put("processes", buildJsonArray {
                owner.processes.forEach { process ->
                    add(buildJsonObject {
                        put("pid", JsonPrimitive(process.pid.toString()))
                        put("adapterId", JsonPrimitive(process.adapterId))
                        put("adapterRoot", JsonPrimitive(process.adapterRoot))
                    })
                }
            })
        }
        ownerFile.writeText(Json.encodeToString(JsonObject.serializer(), json))
    }

    private fun rememberRootLocked(root: String) {
        if (root.isBlank()) return
        rootsDir.mkdirs()
        File(rootsDir, "${sha256(root)}.root").writeText(root)
    }

    private fun readRememberedRootsLocked(): List<String> {
        return rootsDir.listFiles { file -> file.isFile && file.extension == "root" }
            .orEmpty()
            .mapNotNull { file -> file.readText().trim().takeIf { it.isNotBlank() } }
    }

    private fun normalizeRoot(root: String): String =
        File(root).absoluteFile.normalize().path.replace('\\', '/').trimEnd('/')

    private fun sha256(value: String): String {
        val bytes = MessageDigest.getInstance("SHA-256").digest(value.toByteArray(Charsets.UTF_8))
        return bytes.joinToString("") { "%02x".format(it) }
    }

    private fun <T> withRegistryLock(action: () -> T): T {
        synchronized(localLock) {
            baseDir.mkdirs()
            RandomAccessFile(lockFile, "rw").use { file ->
                file.channel.use { channel ->
                    channel.lock().use {
                        return action()
                    }
                }
            }
        }
    }

    internal data class OwnerState(
        val ownerId: String,
        val ownerPid: Long,
        val adapterRoots: List<AdapterRoot> = emptyList(),
        val processes: List<OwnedProcess> = emptyList()
    )

    internal data class AdapterRoot(
        val adapterId: String,
        val root: String
    )

    internal data class OwnedProcess(
        val pid: Long,
        val adapterId: String,
        val adapterRoot: String
    )
}
