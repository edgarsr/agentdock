package agentdock

import java.nio.charset.StandardCharsets

/**
 * Handles reading and preparing frontend resources (HTML, CSS, JS).
 */
object AssetLoader {

    private var fontFaceCssCache: String? = null

    fun generateFontFaceCss(resourceClass: Class<*>): String {
        return fontFaceCssCache ?: run {
            val regularFontBase64 = readBinaryResourceAsBase64(resourceClass, "/fonts/Inter-Regular.woff2")
            val boldFontBase64 = readBinaryResourceAsBase64(resourceClass, "/fonts/Inter-Bold.woff2")
            val css = """
                @font-face {
                    font-family: 'Inter';
                    src: url(data:font/woff2;base64,$regularFontBase64) format('woff2');
                    font-weight: 400;
                    font-style: normal;
                }
                @font-face {
                    font-family: 'Inter';
                    src: url(data:font/woff2;base64,$boldFontBase64) format('woff2');
                    font-weight: 700;
                    font-style: normal;
                }
            """.trimIndent()
            fontFaceCssCache = css
            css
        }
    }

    fun loadAndInlineAssets(resourceClass: Class<*>): String {
        return try {
            val indexHtml = readResource(resourceClass, "/webview/index.html")
            val jsContent = readResource(resourceClass, "/webview/assets/index.js")
            val cssContent = readResource(resourceClass, "/webview/assets/index.css")

            var html = indexHtml

            // Remove Vite-generated script/link tags
            html = html.replace(Regex("""<script[^>]*src="\./assets/index\.js"[^>]*>\s*</script>"""), "")
            html = html.replace(Regex("""<link[^>]*href="\./assets/index\.css"[^>]*>"""), "")

            // Generate dynamic CSS from current theme
            val themeCss = IdeTheme.generateCssBlock()

            val fontFaceCss = generateFontFaceCss(resourceClass)

            val pluginVersion = BuildConfig.PLUGIN_VERSION

            // The web browser tab's icon and the one it shows while a chat is processing, in the colour the IDE shows
            // the tool window icon in.
            val iconSuffix = if (IdeTheme.isDarkTheme()) "_dark.svg" else ".svg"
            val icon = readBinaryResourceAsBase64(resourceClass, "/icons/agent_dock_toolwindow$iconSuffix")
            val processingIcon = readBinaryResourceAsBase64(resourceClass, "/icons/agent_dock_toolwindow_processing$iconSuffix")

            val injection = """
                <link rel="icon" href="data:image/svg+xml;base64,$icon" data-processing="data:image/svg+xml;base64,$processingIcon">
                <style>
                $fontFaceCss
                $cssContent
                </style>
                <style id="ide-theme-style">
                $themeCss
                </style>
                <script>window.__pluginVersion = "$pluginVersion";</script>
                <script type="module">
                $jsContent
                </script>
            """.trimIndent()

            html.replace("</head>", "$injection</head>")
        } catch (_: Exception) {
            "<html><body style='background:#1e1e1e;color:white;padding:20px;'>" +
                "<h2>Error loading UI</h2><p>Failed to load plugin UI.</p></body></html>"
        }
    }

    private fun readResource(resourceClass: Class<*>, path: String): String {
        val stream = resourceClass.getResourceAsStream(path) 
            ?: throw Exception("Resource not found: $path.")
        return stream.use { it.readBytes().toString(StandardCharsets.UTF_8) }
    }

    private fun readBinaryResourceAsBase64(resourceClass: Class<*>, path: String): String {
        val stream = resourceClass.getResourceAsStream(path) 
            ?: throw Exception("Binary resource not found: $path.")
        val bytes = stream.use { it.readBytes() }
        return java.util.Base64.getEncoder().encodeToString(bytes)
    }
}
