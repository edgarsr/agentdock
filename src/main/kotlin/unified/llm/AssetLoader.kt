package unified.llm

import com.intellij.openapi.diagnostic.Logger
import java.nio.charset.StandardCharsets

/**
 * Handles reading and preparing frontend resources (HTML, CSS, JS).
 */
object AssetLoader {

    private val log = Logger.getInstance(AssetLoader::class.java)

    fun loadAndInlineAssets(resourceClass: Class<*>): String {
        return try {
            val indexHtml = readResource(resourceClass, "/webview/index.html")
            val jsContent = readResource(resourceClass, "/webview/assets/index.js")
            val cssContent = readResource(resourceClass, "/webview/assets/index.css")
            
            // Read fonts as base64 to ensure they load in JCEF
            val regularFontBase64 = readBinaryResourceAsBase64(resourceClass, "/fonts/Inter-Regular.woff2")
            val boldFontBase64 = readBinaryResourceAsBase64(resourceClass, "/fonts/Inter-Bold.woff2")

            var html = indexHtml

            // Remove Vite-generated script/link tags
            html = html.replace(Regex("""<script[^>]*src="\./assets/index\.js"[^>]*>\s*</script>"""), "")
            html = html.replace(Regex("""<link[^>]*href="\./assets/index\.css"[^>]*>"""), "")

            // Generate dynamic CSS from current theme
            val themeCss = IdeTheme.generateCssBlock()

            val fontFaceCss = """
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

            val injection = """
                <style>
                $fontFaceCss
                $themeCss
                $cssContent
                </style>
                <script type="module">
                $jsContent
                </script>
            """.trimIndent()

            html.replace("</head>", "$injection</head>")
        } catch (e: Exception) {
            log.warn("Failed to load plugin UI", e)
            "<html><body style='background:#1e1e1e;color:white;padding:20px;'>" +
                "<h2>Error loading UI</h2><p>Failed to load plugin UI. Check the IDE log for details.</p></body></html>"
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
