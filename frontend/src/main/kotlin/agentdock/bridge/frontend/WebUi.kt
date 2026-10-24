package agentdock.bridge.frontend

import java.io.IOException
import java.io.OutputStream
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference

/**
 * The UI shown in a web browser tab, reached through [AgentDockWebServer].
 *
 * Scripts reach the page as server-sent events while its stream is open; while it is not they are
 * dropped, because a page whose stream reconnects reloads and restores the UI. A stream that falls
 * too far behind ends for the same reason.
 */
internal class WebUi : UiSink {

    /** The frames of the open stream. A reconnected page opens a new one before the old one is found dead. */
    private val frames = AtomicReference<LinkedBlockingQueue<String>?>()

    override fun eval(js: String) {
        val queue = frames.get() ?: return
        if (queue.size < MAX_QUEUED_FRAMES) queue.add(frame("message", js)) else frames.compareAndSet(queue, null)
    }

    override fun reload() {
        frames.get()?.add(frame("reload", ""))
    }

    override fun supersede() {
        frames.get()?.add(SUPERSEDED)
    }

    /** Ends the stream, so the page says the IDE is not reachable. */
    fun close() {
        frames.get()?.add(CLOSED)
    }

    override fun handleLocally(name: String, payload: String): Boolean {
        if (name != "readUiVisibility") return false
        eval("window.dispatchEvent(new CustomEvent('agent-dock-ui-visibility',{detail:!document.hidden}));")
        return true
    }

    /** Writes the page's events to [out] until the page goes away, another page takes the UI or a newer stream opens. */
    fun stream(out: OutputStream) {
        val own = LinkedBlockingQueue<String>()
        frames.set(own)
        try {
            write(out, frame("active", ""))
            val batch = ArrayList<String>()
            while (frames.get() === own) {
                // The frames queued meanwhile go out in one write.
                batch.add(own.poll(HEARTBEAT_SECONDS, TimeUnit.SECONDS) ?: HEARTBEAT)
                own.drainTo(batch)
                val end = batch.indexOfFirst { it === SUPERSEDED || it === CLOSED }
                if (end >= 0) {
                    val elsewhere = if (batch[end] === SUPERSEDED) listOf(frame("elsewhere", "")) else emptyList()
                    write(out, (batch.subList(0, end) + elsewhere).joinToString(""))
                    return
                }
                write(out, batch.joinToString(""))
                batch.clear()
            }
        } catch (_: IOException) {
        } catch (_: InterruptedException) {
        } finally {
            frames.compareAndSet(own, null)
        }
    }

    companion object {
        private const val HEARTBEAT_SECONDS = 15L
        /** Reached only by a stream whose page stopped reading. */
        private const val MAX_QUEUED_FRAMES = 10_000
        /** A comment, which also tells a closed connection apart within [HEARTBEAT_SECONDS]. */
        private const val HEARTBEAT = ":\n\n"
        /** Queued in place of a frame, which always starts with `event:`. */
        private const val SUPERSEDED = "superseded"
        private const val CLOSED = "closed"

        fun frame(event: String, data: String): String = buildString {
            append("event: ").append(event).append('\n')
            data.replace("\r\n", "\n").replace('\r', '\n').split('\n').forEach { append("data: ").append(it).append('\n') }
            append('\n')
        }

        fun write(out: OutputStream, text: String) {
            out.write(text.toByteArray(Charsets.UTF_8))
            out.flush()
        }
    }
}
