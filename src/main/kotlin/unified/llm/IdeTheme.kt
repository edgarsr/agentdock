package unified.llm

import com.intellij.ui.JBColor
import com.intellij.openapi.editor.DefaultLanguageHighlighterColors
import com.intellij.openapi.editor.colors.EditorColorsManager
import com.intellij.openapi.editor.colors.EditorColors
import unified.llm.settings.GlobalSettingsStore
import java.awt.Color
import java.util.Locale
import javax.swing.UIManager

/**
 * Extracts IDE theme settings (colors, typography, layout) and generates CSS variables.
 */
object IdeTheme {

    private data class UiComponentDef(
        val colorProps: List<String> = emptyList()
    )

    private val uiComponents = linkedMapOf(
        "Panel" to UiComponentDef(listOf("background", "foreground")),
        "Label" to UiComponentDef(listOf("background", "foreground", "disabledForeground", "infoForeground", "errorForeground", "warningForeground")),
        "Button" to UiComponentDef(listOf("startBackground", "endBackground", "foreground", "startBorderColor", "borderColor", "disabledText", "disabledBorderColor", "focusedBorderColor")),
        "TextField" to UiComponentDef(listOf("background", "foreground", "borderColor", "caretForeground", "selectionBackground", "selectionForeground", "focusedBorderColor")),
        "List" to UiComponentDef(listOf("background", "foreground", "selectionBackground", "selectionForeground", "selectionInactiveBackground", "hoverBackground")),
        "Table" to UiComponentDef(listOf("background", "gridColor", "selectionBackground", "foreground")),
        "Notification" to UiComponentDef(listOf("background", "foreground", "errorBackground", "errorForeground")),
        "ToolTip" to UiComponentDef(listOf("background", "foreground")),
        "Button.default" to UiComponentDef(listOf("startBackground", "endBackground", "foreground", "borderColor", "focusColor", "focusedBorderColor")),
        "CheckBox" to UiComponentDef(listOf("background", "foreground")),
        "RadioButton" to UiComponentDef(listOf("background")),
        "ProgressBar" to UiComponentDef(listOf("passedColor")),
        "Hyperlink" to UiComponentDef(listOf("linkColor"))
    )

    fun generateCssBlock(): String {
        val sb = StringBuilder()
        sb.append(":root {\n")
        val scheme = EditorColorsManager.getInstance().globalScheme
        val editorBackground = scheme.defaultBackground
        val baseBackground = uiColor("Panel.background", editorBackground)

        // 1. UI Component colors from UIManager
        for ((component, def) in uiComponents) {
            for (prop in def.colorProps) {
                val uiKey = "$component.$prop"
                val fallback = when (uiKey) {
                    "Button.startBorderColor" -> uiColor("Button.borderColor", Color(0, 0, 0, 0))
                    else -> Color(0, 0, 0, 0)
                }
                val originalColor = UIManager.getColor(uiKey) ?: JBColor.namedColor(uiKey, fallback)
                val color = if (
                    uiKey == "List.hoverBackground" &&
                    (isTransparent(originalColor) || areColorsSimilar(originalColor, baseBackground))
                ) {
                    adjustBrightness(baseBackground, 1.20)
                } else {
                    originalColor
                }
                sb.append("  --ide-${uiKey.replace(".", "-")}: ${toCssColor(color)};\n")
            }
        }

        // 2. Base fonts only — UI and Code
        val baseFont = com.intellij.util.ui.JBFont.regular()
        sb.append("  --ide-font-family: '${baseFont.family}', sans-serif;\n")
        sb.append("  --ide-font-size: ${baseFont.size2D}px;\n")
        sb.append("  --ui-font-size-offset: ${GlobalSettingsStore.uiFontSizeOffsetPx()}px;\n")

        sb.append("  --ide-code-font-family: '${scheme.editorFontName}', monospace;\n")
        sb.append("  --ide-code-font-size: ${scheme.editorFontSize}px;\n")

        // 3. Editor colors
        sb.append("  --ide-editor-bg: ${toCssColor(scheme.defaultBackground)};\n")
        sb.append("  --ide-editor-fg: ${toCssColor(scheme.defaultForeground)};\n")

        // 4. Syntax highlighting
        val syntaxMap = mapOf(
            "keyword" to DefaultLanguageHighlighterColors.KEYWORD,
            "string" to DefaultLanguageHighlighterColors.STRING,
            "number" to DefaultLanguageHighlighterColors.NUMBER,
            "comment" to DefaultLanguageHighlighterColors.LINE_COMMENT,
            "function" to DefaultLanguageHighlighterColors.FUNCTION_DECLARATION,
            "class" to DefaultLanguageHighlighterColors.CLASS_NAME,
            "tag" to DefaultLanguageHighlighterColors.MARKUP_TAG,
            "attr" to DefaultLanguageHighlighterColors.MARKUP_ATTRIBUTE
        )

        for ((name, key) in syntaxMap) {
            val attrs = scheme.getAttributes(key)
            val color = attrs?.foregroundColor
            if (color != null) {
                sb.append("  --ide-syntax-$name: ${toCssColor(color)};\n")
            }
        }

        // 5. VCS and semantic colors from EditorColorsScheme
        val addedColor = scheme.getColor(EditorColors.ADDED_LINES_COLOR)
        if (addedColor != null) {
            sb.append("  --ide-vcs-added: ${toCssColor(addedColor)};\n")
        }

        val deletedColor = scheme.getColor(EditorColors.DELETED_LINES_COLOR)
        if (deletedColor != null) {
            sb.append("  --ide-vcs-deleted: ${toCssColor(deletedColor)};\n")
        }

        // 6. Dynamic background variations
        val isDark = !JBColor.isBright()

        // Secondary: use editor background if different from panel, otherwise calculate
        val secondaryBackground = if (areColorsSimilar(baseBackground, editorBackground)) {
            // Editor and panel backgrounds are similar - calculate variation
            adjustBrightness(baseBackground, if (isDark) 1.15 else 0.9)
        } else {
            // Use editor background as secondary
            editorBackground
        }
        sb.append("  --ide-background-secondary: ${toCssColor(secondaryBackground)};\n")
        sb.append("  --ide-surface-hover-filter: ${if (isDark) "brightness(1.3)" else "brightness(0.98)"};\n")
        sb.append("  --ide-surface-active-filter: ${if (isDark) "brightness(1.3)" else "brightness(0.98)"};\n")

        // 7. Dynamic border color (must be different from both backgrounds)
        val originalBorder = uiColor(
            "Borders.color",
            adjustBrightness(baseBackground, if (isDark) 1.25 else 0.85)
        )
        val borderColor = if (areColorsSimilar(originalBorder, baseBackground) ||
                             areColorsSimilar(originalBorder, secondaryBackground)) {
            // Border is too similar to backgrounds - adjust it
            // In dark theme: make lighter than both backgrounds
            // In light theme: make darker than both backgrounds
            adjustBrightness(baseBackground, if (isDark) 1.25 else 0.85)
        } else {
            // Border is distinct - use original
            originalBorder
        }
        sb.append("  --ide-Borders-color: ${toCssColor(borderColor)};\n")
        val contrastBorderColor = uiColor("Borders.ContrastBorderColor", borderColor)
        sb.append("  --ide-Borders-ContrastBorderColor: ${toCssColor(contrastBorderColor)};\n")

        // Scrollbar color based on border
        val scrollbarColor = adjustBrightness(borderColor, if (isDark) 1.15 else 0.90)
        sb.append("  --ide-scrollbar-color: ${toCssColor(scrollbarColor)};\n")

        val userMessageStyle = GlobalSettingsStore.userMessageBackgroundStyle()
        val userMessageBackgroundVar = when (userMessageStyle) {
            "background-secondary" -> "--ide-background-secondary"
            "primary" -> "--ide-Button-default-startBackground"
            "secondary" -> "--ide-Button-startBackground"
            "input" -> "--ide-TextField-background"
            "editor-bg" -> "--ide-editor-bg"
            else -> "--ide-List-selectionBackground"
        }
        sb.append("  --user-message-bg: var($userMessageBackgroundVar);\n")

        // 8. Layout and spacing
        val listIndent = UIManager.getInt("Tree.leftChildIndent").takeIf { it > 0 }
            ?: com.intellij.util.ui.JBUI.scale(20)
        val paraSpacing = com.intellij.util.ui.JBUI.scale(10)
        sb.append("  --ide-list-indent: ${listIndent}px;\n")
        sb.append("  --ide-paragraph-spacing: ${paraSpacing}px;\n")

        sb.append("}\n")
        return sb.toString()
    }

    private fun areColorsSimilar(color1: Color, color2: Color, threshold: Int = 10): Boolean {
        val rDiff = kotlin.math.abs(color1.red - color2.red)
        val gDiff = kotlin.math.abs(color1.green - color2.green)
        val bDiff = kotlin.math.abs(color1.blue - color2.blue)

        return rDiff <= threshold && gDiff <= threshold && bDiff <= threshold
    }

    private fun adjustBrightness(color: Color, factor: Double): Color {
        val hsb = FloatArray(3)
        Color.RGBtoHSB(color.red, color.green, color.blue, hsb)

        val newBrightness = (hsb[2] * factor).coerceIn(0.0, 1.0).toFloat()
        val rgb = Color.HSBtoRGB(hsb[0], hsb[1], newBrightness)

        return Color(rgb)
    }

    private fun isTransparent(color: Color): Boolean {
        return color.alpha == 0
    }

    private fun uiColor(uiKey: String, fallback: Color): Color {
        return UIManager.getColor(uiKey) ?: JBColor.namedColor(uiKey, fallback)
    }

    private fun toCssColor(color: Color): String {
        val alpha = color.alpha / 255.0
        return if (alpha >= 1.0) {
            "rgb(${color.red}, ${color.green}, ${color.blue})"
        } else {
            "rgba(${color.red}, ${color.green}, ${color.blue}, ${String.format(Locale.US, "%.2f", alpha)})"
        }
    }
}
