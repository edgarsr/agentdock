package agentdock.ui

import agentdock.acp.AcpQuotaService
import agentdock.acp.QuotaDetail
import com.intellij.openapi.project.Project
import com.intellij.openapi.util.IconLoader
import com.intellij.openapi.wm.CustomStatusBarWidget
import com.intellij.openapi.wm.StatusBar
import com.intellij.openapi.wm.StatusBarWidget
import com.intellij.openapi.wm.StatusBarWidgetFactory
import com.intellij.ui.JBColor
import com.intellij.ui.awt.RelativePoint
import com.intellij.ui.components.JBLabel
import com.intellij.openapi.ui.popup.JBPopupFactory
import com.intellij.ui.components.JBList
import com.intellij.util.ui.JBUI
import kotlinx.coroutines.*
import java.awt.BorderLayout
import java.awt.Component
import java.awt.FlowLayout
import java.awt.event.MouseAdapter
import java.awt.event.MouseEvent
import javax.swing.*

class AgentDockQuotaWidgetFactory : StatusBarWidgetFactory {
    override fun getId(): String = "AgentDockQuotaWidget"
    override fun getDisplayName(): String = "AgentDock Quota"
    override fun isAvailable(project: Project): Boolean = true
    override fun createWidget(project: Project): StatusBarWidget = AgentDockQuotaWidget(project)
    override fun disposeWidget(widget: StatusBarWidget) {
        widget.dispose()
    }
    override fun canBeEnabledOn(statusBar: StatusBar): Boolean = true
}

class AgentDockQuotaWidget(private val project: Project) : CustomStatusBarWidget {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private var statusBar: StatusBar? = null
    
    private val panel = JPanel(FlowLayout(FlowLayout.LEFT, 6, 0)).apply {
        isOpaque = false
        cursor = java.awt.Cursor.getPredefinedCursor(java.awt.Cursor.HAND_CURSOR)
        border = JBUI.Borders.empty(0, 4)
    }

    init {
        panel.addMouseListener(object : MouseAdapter() {
            override fun mouseClicked(e: MouseEvent) {
                showPopup(e)
            }
        })

        scope.launch {
            AcpQuotaService.quotas.collect { quotas ->
                updateUI(quotas)
            }
        }
    }

    private fun updateUI(quotas: Map<String, QuotaDetail>) {
        panel.removeAll()
        if (quotas.isEmpty()) {
            panel.add(JBLabel("No Quotas").apply { foreground = JBColor.GRAY })
        } else {
            // Show top 2 worst or just icons if too many
            val sorted = quotas.values.sortedByDescending { it.mainPercentage }
            sorted.take(2).forEach { quota ->
                val icon = loadAdapterIcon(quota.adapterId)
                val label = JBLabel("${quota.mainPercentage}%", icon, SwingConstants.LEFT)
                panel.add(label)
            }
            if (sorted.size > 2) {
                panel.add(JBLabel("+${sorted.size - 2}"))
            }
        }
        panel.revalidate()
        panel.repaint()
        statusBar?.updateWidget(ID())
    }

    private fun loadAdapterIcon(adapterId: String): Icon? {
        val path = when (adapterId) {
            "claude-code" -> "/icons/claude.svg"
            "gemini-cli" -> "/icons/gemini.svg"
            "codex" -> "/icons/codex.svg"
            "github-copilot-cli" -> "/icons/copilot.svg"
            else -> "/icons/agent_dock_toolwindow.svg"
        }
        return try {
            IconLoader.getIcon(path, javaClass)
        } catch (_: Exception) {
            null
        }
    }

    private fun showPopup(e: MouseEvent) {
        // Sync quotas in background when clicked
        scope.launch {
            withContext(Dispatchers.IO) {
                AcpQuotaService.updateQuotas()
            }
        }

        val quotas = AcpQuotaService.quotas.value.values.toList()
        if (quotas.isEmpty()) return

        val listModel = DefaultListModel<QuotaDetail>()
        quotas.forEach { listModel.addElement(it) }

        val list = JBList(listModel).apply {
            cellRenderer = object : ListCellRenderer<QuotaDetail> {
                override fun getListCellRendererComponent(
                    list: JList<out QuotaDetail>,
                    value: QuotaDetail,
                    index: Int,
                    isSelected: Boolean,
                    cellHasFocus: Boolean
                ): Component {
                    val p = JPanel(BorderLayout(8, 4)).apply {
                        border = JBUI.Borders.empty(6, 8)
                        background = if (isSelected) list.selectionBackground else list.background
                    }
                    
                    val header = JPanel(BorderLayout()).apply { isOpaque = false }
                    header.add(JBLabel(value.adapterName, loadAdapterIcon(value.adapterId), SwingConstants.LEFT).apply {
                        font = font.deriveFont(java.awt.Font.BOLD)
                    }, BorderLayout.WEST)
                    header.add(JBLabel("${value.mainPercentage}%").apply {
                        foreground = when {
                            value.mainPercentage > 80 -> JBColor.RED
                            value.mainPercentage > 50 -> JBColor.ORANGE
                            else -> JBColor.GREEN
                        }
                    }, BorderLayout.EAST)
                    
                    p.add(header, BorderLayout.NORTH)
                    
                    if (value.details.isNotEmpty()) {
                        val detailsPanel = JPanel(FlowLayout(FlowLayout.LEFT, 4, 0)).apply { isOpaque = false }
                        value.details.forEach { 
                            detailsPanel.add(JBLabel(it).apply { 
                                font = font.deriveFont(font.size * 0.9f)
                                foreground = JBColor.GRAY
                            })
                        }
                        p.add(detailsPanel, BorderLayout.CENTER)
                    }
                    
                    return p
                }
            }
        }

        JBPopupFactory.getInstance().createListPopupBuilder(list)
            .setTitle("Agent Quotas")
            .setMovable(false)
            .setResizable(false)
            .createPopup()
            .show(RelativePoint(e.component, e.point))
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
