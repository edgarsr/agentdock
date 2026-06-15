package agentdock

import java.nio.charset.StandardCharsets

/**
 * Handles reading and preparing frontend resources (HTML, CSS, JS).
 */
object AssetLoader {

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

            val injection = """
                <style>
                $cssContent
                </style>
                <style id="ide-theme-style">
                $themeCss
                </style>
                <script type="module">
                $jsContent
                </script>
            """.trimIndent()

            html.replace("</head>", "$injection</head>")
        } catch (e: Exception) {
            "<html><body style='background:#1e1e1e;color:white;padding:20px;'>" +
                "<h2>Error loading UI</h2><p>Failed to load plugin UI.</p></body></html>"
        }
    }

    private fun readResource(resourceClass: Class<*>, path: String): String {
        val stream = resourceClass.getResourceAsStream(path) 
            ?: throw Exception("Resource not found: $path.")
        return stream.use { it.readBytes().toString(StandardCharsets.UTF_8) }
    }
}
