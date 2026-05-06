package agentdock.ui

import agentdock.acp.AcpQuotaService
import agentdock.acp.QuotaDetail
import agentdock.settings.GlobalSettingsStore
import com.intellij.openapi.project.Project
import com.intellij.openapi.util.IconLoader
import com.intellij.util.IconUtil
import com.intellij.openapi.wm.CustomStatusBarWidget
import com.intellij.openapi.wm.StatusBar
import com.intellij.openapi.wm.StatusBarWidget
import com.intellij.openapi.wm.StatusBarWidgetFactory
import com.intellij.ui.JBColor
import com.intellij.ui.awt.RelativePoint
import com.intellij.ui.components.JBLabel
import com.intellij.openapi.ui.popup.JBPopupFactory
import com.intellij.util.ui.JBUI
import kotlinx.coroutines.*
import java.awt.BorderLayout
import java.awt.Component
import java.awt.FlowLayout
import java.awt.Graphics
import java.awt.Graphics2D
import java.awt.RenderingHints
import java.awt.event.MouseAdapter
import java.awt.event.MouseEvent
import javax.swing.*

class AgentDockQuotaWidgetFactory : StatusBarWidgetFactory {
    override fun getId(): String = "AgentDockQuotaWidget"
    override fun getDisplayName(): String = "AgentDock Quota"
    override fun isAvailable(project: Project): Boolean = GlobalSettingsStore.load().quotaWidgetEnabled
    override fun createWidget(project: Project): StatusBarWidget = AgentDockQuotaWidget(project)
    override fun disposeWidget(widget: StatusBarWidget) {
        widget.dispose()
    }
    override fun canBeEnabledOn(statusBar: StatusBar): Boolean = true
}

class AgentDockQuotaWidget(project: Project) : CustomStatusBarWidget {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private var statusBar: StatusBar? = null
    private var isHovered = false

    private val noQuotaLabel = JBLabel("No Quotas").apply {
        foreground = JBColor.GRAY
        alignmentY = Component.CENTER_ALIGNMENT
    }
    private val quotaSlots = listOf(
        JBLabel("", SwingConstants.LEFT).apply {
            isVisible = false
            alignmentY = Component.CENTER_ALIGNMENT
        },
        JBLabel("", SwingConstants.LEFT).apply {
            isVisible = false
            alignmentY = Component.CENTER_ALIGNMENT
            border = JBUI.Borders.empty(0, 6, 0, 0)
        }
    )
    private val overflowLabel = JBLabel("").apply {
        isVisible = false
        alignmentY = Component.CENTER_ALIGNMENT
        border = JBUI.Borders.empty(0, 6, 0, 0)
    }

    private val panel = object : JPanel() {
        init {
            layout = BoxLayout(this, BoxLayout.X_AXIS)
        }
        override fun paintComponent(g: Graphics) {
            val g2 = g as Graphics2D
            g2.color = JBColor.namedColor("StatusBar.background", JBColor(0xBDBDBD, 0x3C3F41))
            g2.fillRect(0, 0, width, height)
            if (isHovered) {
                g2.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON)
                g2.color = JBColor.namedColor("StatusBar.Widget.hoverBackground", JBColor(0xD5D5D5, 0x4C5052))
                val vInset = JBUI.scale(4)
                val arc = JBUI.scale(4)
                g2.fillRoundRect(0, vInset, width, height - vInset * 2, arc, arc)
            }
        }
        override fun getMaximumSize(): java.awt.Dimension =
            java.awt.Dimension(super.getMaximumSize().width, Int.MAX_VALUE)
    }.apply {
        isOpaque = true
        cursor = java.awt.Cursor.getPredefinedCursor(java.awt.Cursor.HAND_CURSOR)
        border = JBUI.Borders.empty(0, 4)
        toolTipText = "Agent Quotas"
        add(noQuotaLabel)
        quotaSlots.forEach { add(it) }
        add(overflowLabel)
    }

    init {
        panel.addMouseListener(object : MouseAdapter() {
            override fun mouseClicked(e: MouseEvent) { showPopup(e) }
            override fun mouseEntered(e: MouseEvent) { isHovered = true; panel.repaint() }
            override fun mouseExited(e: MouseEvent) { isHovered = false; panel.repaint() }
        })

        scope.launch {
            AcpQuotaService.getInstance().quotas.collect { quotas ->
                updateUI(quotas)
            }
        }
    }

    private fun updateUI(quotas: Map<String, QuotaDetail>) {
        if (quotas.isEmpty()) {
            noQuotaLabel.isVisible = true
            quotaSlots.forEach { it.isVisible = false }
            overflowLabel.isVisible = false
        } else {
            noQuotaLabel.isVisible = false
            val sorted = quotas.values.sortedByDescending { it.mainPercentage }
            quotaSlots.forEachIndexed { i, label ->
                if (i < sorted.size) {
                    val quota = sorted[i]
                    label.text = "${quota.mainPercentage}%"
                    label.icon = loadAdapterIcon(quota.adapterId)
                    label.isVisible = true
                } else {
                    label.isVisible = false
                }
            }
            if (sorted.size > 2) {
                overflowLabel.text = "+${sorted.size - 2}"
                overflowLabel.isVisible = true
            } else {
                overflowLabel.isVisible = false
            }
        }
        panel.revalidate()
        panel.repaint()
        statusBar?.updateWidget(ID())
    }

    private fun loadAdapterIcon(adapterId: String): Icon? {
        val isDark = !JBColor.isBright()
        val path = when (adapterId) {
            "claude-code" -> "/icons/claude.svg"
            "gemini-cli" -> "/icons/gemini.svg"
            "codex" -> if (isDark) "/icons/codex-dark.svg" else "/icons/codex-light.svg"
            "github-copilot-cli" -> if (isDark) "/icons/copilot-dark.svg" else "/icons/copilot-light.svg"
            else -> "/icons/agent_dock_toolwindow.svg"
        }
        return try {
            val icon = IconLoader.getIcon(path, javaClass)
            val targetSize = JBUI.scale(14)
            if (icon.iconHeight == targetSize) icon
            else IconUtil.scale(icon, null, targetSize.toFloat() / icon.iconHeight)
        } catch (_: Exception) {
            null
        }
    }

    private fun showPopup(e: MouseEvent) {
        showQuotaPopup()
    }

    private fun showQuotaPopup() {
        val quotas = AcpQuotaService.getInstance().quotas.value.values.toList()
        if (quotas.isEmpty()) return

        val container = JPanel().apply {
            layout = BoxLayout(this, BoxLayout.Y_AXIS)
            border = JBUI.Borders.empty(4, 0)
        }

        quotas.forEachIndexed { index, quota ->
            val header = JPanel(BorderLayout(8, 0)).apply { isOpaque = false }
            header.add(JBLabel(quota.adapterName, loadAdapterIcon(quota.adapterId), SwingConstants.LEFT).apply {
                font = font.deriveFont(java.awt.Font.BOLD)
            }, BorderLayout.CENTER)
            header.add(JBLabel("${quota.mainPercentage}%").apply {
                foreground = when {
                    quota.mainPercentage >= 90 -> JBColor.RED
                    quota.mainPercentage >= 75 -> JBColor.ORANGE
                    else -> JBColor.GREEN
                }
                border = JBUI.Borders.emptyLeft(12)
            }, BorderLayout.EAST)

            val row = JPanel(BorderLayout(8, 4)).apply {
                isOpaque = false
                border = JBUI.Borders.empty(6, 12)
                add(header, BorderLayout.NORTH)
            }

            if (quota.details.isNotEmpty()) {
                val detailsPanel = JPanel(FlowLayout(FlowLayout.LEFT, 4, 0)).apply { isOpaque = false }
                quota.details.forEach {
                    detailsPanel.add(JBLabel(it).apply {
                        font = font.deriveFont(font.size * 0.9f)
                        foreground = JBColor.GRAY
                    })
                }
                row.add(detailsPanel, BorderLayout.CENTER)
            }

            container.add(row)

            if (index < quotas.size - 1) {
                container.add(JSeparator())
            }
        }

        val ps = container.preferredSize
        container.preferredSize = java.awt.Dimension(ps.width.coerceAtLeast(220).coerceAtMost(500), ps.height)

        val popup = JBPopupFactory.getInstance()
            .createComponentPopupBuilder(container, null)
            .setTitle("Agent Quotas")
            .setMovable(false)
            .setResizable(false)
            .createPopup()

        // Title bar height + popup border + padding overhead (approximate, scales with DPI)
        val popupOverhead = JBUI.scale(42)
        val totalHeight = container.preferredSize.height + popupOverhead
        popup.show(RelativePoint(panel, java.awt.Point(0, -totalHeight)))
    }

    override fun ID(): String = "AgentDockQuotaWidget"

    override fun install(statusBar: StatusBar) {
        this.statusBar = statusBar
    }

    override fun dispose() {
        scope.cancel()
        statusBar = null
    }

    override fun getComponent(): JComponent = panel
}
