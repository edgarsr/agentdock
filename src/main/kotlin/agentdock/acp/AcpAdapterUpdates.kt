package agentdock.acp

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.net.URI
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.time.Duration

internal object AcpAdapterUpdates {
    private val json = Json { ignoreUnknownKeys = true }
    private val http = HttpClient.newBuilder()
        .followRedirects(HttpClient.Redirect.NORMAL)
        .connectTimeout(Duration.ofSeconds(10))
        .build()

    fun isUpdateCheckSupported(adapterInfo: AcpAdapterConfig.AdapterInfo): Boolean {
        if (adapterInfo.id == "cursor-cli" || adapterInfo.id == "antigravity") return true
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
        if (adapterInfo.id == "antigravity") {
            return latestAntigravityVersion()
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

    private fun latestAntigravityVersion(): String? {
        val body = httpGet("https://raw.githubusercontent.com/agentclientprotocol/registry/main/antigravity-acp/agent.json")
            ?: return null
        return runCatching {
            val root = json.parseToJsonElement(body).jsonObject
            val binary = root["distribution"]?.jsonObject?.get("binary")?.jsonObject
            val archiveUrl = binary?.values?.firstNotNullOfOrNull {
                (it as? JsonObject)?.get("archive")?.jsonPrimitive?.contentOrNull
            }
            if (archiveUrl != null) {
                val match = Regex("""/agy-acp-server-(.+?)-(?:windows|darwin|linux)-""").find(archiveUrl)
                match?.groupValues?.get(1)?.trim()
            } else {
                val version = root["version"]?.jsonPrimitive?.contentOrNull?.trim()
                if (version != null) {
                    if (version.startsWith("agy_acp_server_")) version else "agy_acp_server_$version"
                } else null
            }
        }.getOrNull()
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
