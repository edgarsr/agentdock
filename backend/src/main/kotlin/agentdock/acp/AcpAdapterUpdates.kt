package agentdock.acp

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.net.URI
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.time.Duration

@Serializable
internal data class ManifestRelease(val version: String, val url: String)

internal object AcpAdapterUpdates {
    private val json = Json { ignoreUnknownKeys = true }
    private val http = HttpClient.newBuilder()
        .followRedirects(HttpClient.Redirect.NORMAL)
        .connectTimeout(Duration.ofSeconds(10))
        .build()

    fun isUpdateCheckSupported(adapterInfo: AcpAdapterConfig.AdapterInfo): Boolean {
        if (adapterInfo.id == "cursor-cli" || adapterInfo.distribution.manifestUrl != null) return true
        if (adapterInfo.distribution.version.firstOrNull()?.isDigit() == true) return false
        return when (adapterInfo.distribution.type) {
            AcpAdapterConfig.DistributionType.NPM -> !adapterInfo.distribution.packageName.isNullOrBlank()
            AcpAdapterConfig.DistributionType.ARCHIVE -> adapterInfo.distribution.updateSource != null
        }
    }

    fun latestAvailableVersion(adapterInfo: AcpAdapterConfig.AdapterInfo): String? {
        if (adapterInfo.id == "cursor-cli") {
            return latestCursorVersion()
        }
        if (adapterInfo.distribution.manifestUrl != null) {
            return latestManifestRelease(adapterInfo)?.version?.trim()
        }
        return when (adapterInfo.distribution.type) {
            AcpAdapterConfig.DistributionType.NPM -> latestNpmVersion(adapterInfo.distribution.packageName)
            AcpAdapterConfig.DistributionType.ARCHIVE -> latestArchiveVersion(adapterInfo.distribution.updateSource)
        }
    }

    private fun latestCursorVersion(): String? {
        val body = httpGet("https://cursor.com/install") ?: return null
        val match = Regex("""/lab/([^/]+)/""").find(body)
        return match?.groupValues?.get(1)?.trim()
    }

    /** Reads the release manifest of [adapterInfo], or returns `null` without one or when it is unavailable. */
    fun latestManifestRelease(adapterInfo: AcpAdapterConfig.AdapterInfo): ManifestRelease? {
        val manifestUrl = adapterInfo.distribution.manifestUrl ?: return null
        val body = httpGet(resolveDistributionUrl(manifestUrl, adapterInfo)) ?: return null
        return runCatching { json.decodeFromString<ManifestRelease>(body) }.getOrNull()
            ?.takeIf { it.version.isNotBlank() && it.url.isNotBlank() }
    }

    private fun latestNpmVersion(packageName: String?): String? {
        val trimmed = packageName?.trim().takeUnless { it.isNullOrEmpty() } ?: return null
        val encoded = trimmed.replace("/", "%2F")
        val body = httpGet("https://registry.npmjs.org/$encoded") ?: return null
        val root = json.parseToJsonElement(body).jsonObject
        return root["dist-tags"]?.jsonObject?.get("latest")?.jsonPrimitive?.content?.trim()?.takeIf { it.isNotEmpty() }
    }

    private fun latestArchiveVersion(updateSource: AcpAdapterConfig.UpdateSource?): String? {
        val source = updateSource ?: return null
        return when (source.type) {
            AcpAdapterConfig.UpdateSourceType.GITHUB_RELEASE -> {
                val owner = source.owner?.trim().takeUnless { it.isNullOrEmpty() } ?: return null
                val repo = source.repo?.trim().takeUnless { it.isNullOrEmpty() } ?: return null
                val body = httpGet("https://api.github.com/repos/$owner/$repo/releases/latest") ?: return null
                val tagName = json.parseToJsonElement(body).jsonObject["tag_name"]?.jsonPrimitive?.content?.trim()
                    ?.takeIf { it.isNotEmpty() }
                    ?: return null
                tagName.removePrefix(source.tagPrefix)
            }
        }
    }

    private fun httpGet(url: String): String? {
        return runCatching {
            val request = HttpRequest.newBuilder(URI.create(url))
                .timeout(Duration.ofSeconds(15))
                .header("Accept", "application/json")
                .header("User-Agent", "AgentDock-Plugin")
                .GET()
                .build()
            val response = http.send(request, HttpResponse.BodyHandlers.ofString())
            if (response.statusCode() in 200..299) response.body() else null
        }.getOrNull()
    }
}
