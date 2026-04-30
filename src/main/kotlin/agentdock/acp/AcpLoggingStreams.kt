package agentdock.acp

import java.io.ByteArrayOutputStream

/**
 * OutputStream wrapper that intercepts line-by-line output for logging
 * while passing data through to the delegate stream.
 */
internal class LineLoggingOutputStream(
    private val delegate: java.io.OutputStream,
    private val onLine: (String) -> Unit
) : java.io.OutputStream() {
    private val buffer = ByteArrayOutputStream()

    override fun write(b: Int) {
        delegate.write(b)
        appendInternal(b)
    }

    override fun write(b: ByteArray, off: Int, len: Int) {
        delegate.write(b, off, len)
        for (i in off until (off + len).coerceAtMost(b.size)) {
            appendInternal(b[i].toInt() and 0xff)
        }
    }

    private fun appendInternal(b: Int) {
        if (b == '\n'.code) {
            flushLine()
        } else {
            buffer.write(b)
        }
    }

    private fun flushLine() {
        val line = buffer.toString(Charsets.UTF_8).removeSuffix("\r")
        buffer.reset()
        if (line.isNotBlank()) {
            onLine(line)
        }
    }

    override fun flush() = delegate.flush()

    override fun close() {
        flushLine()
        delegate.close()
    }
}

/**
 * InputStream wrapper that intercepts line-by-line input for logging
 * while providing data to the consumer.
 *
 * Lines exceeding MAX_LINE_BYTES are split into chunks so the consumer
 * receives all bytes, but only a preview is passed to onLine.
 */
internal class LineLoggingInputStream(
    delegate: java.io.InputStream,
    private val onLine: (String) -> Unit
) : java.io.InputStream() {
    private val input = delegate
    private var currentChunk = ByteArray(0)
    private var currentIndex = 0
    private var inLargeLine = false

    companion object {
        private const val MAX_LINE_BYTES = 256 * 1024
    }

    override fun read(): Int {
        if (!ensureChunk()) return -1
        return currentChunk[currentIndex++].toInt() and 0xff
    }

    override fun read(b: ByteArray, off: Int, len: Int): Int {
        if (!ensureChunk()) return -1
        val available = currentChunk.size - currentIndex
        val count = minOf(len, available)
        System.arraycopy(currentChunk, currentIndex, b, off, count)
        currentIndex += count
        return count
    }

    override fun close() {
        input.close()
    }

    private fun ensureChunk(): Boolean {
        if (currentIndex < currentChunk.size) return true

        val (bytes, hitLimit) = readRawLine() ?: return false

        when {
            !inLargeLine && !hitLimit -> {
                val line = bytes.toString(Charsets.UTF_8).trimEnd('\r', '\n')
                if (line.isNotBlank()) onLine(line)
            }
            !inLargeLine && hitLimit -> {
                val preview = bytes.toString(Charsets.UTF_8).take(200)
                onLine("[large message truncated, preview: $preview]")
                inLargeLine = true
            }
            inLargeLine && !hitLimit -> inLargeLine = false
            // inLargeLine && hitLimit: middle of large line, do nothing
        }

        currentChunk = bytes
        currentIndex = 0
        return true
    }

    // Returns (bytes, hitSizeLimit). When hitSizeLimit=true the line continues
    // in the underlying stream; when false the '\n' was consumed and is included.
    private fun readRawLine(): Pair<ByteArray, Boolean>? {
        val buffer = ByteArrayOutputStream()
        while (true) {
            val next = input.read()
            if (next == -1) {
                return if (buffer.size() == 0) null else Pair(buffer.toByteArray(), false)
            }
            if (next == '\n'.code) {
                buffer.write(next)
                return Pair(buffer.toByteArray(), false)
            }
            buffer.write(next)
            if (buffer.size() >= MAX_LINE_BYTES) {
                return Pair(buffer.toByteArray(), true)
            }
        }
    }
}
