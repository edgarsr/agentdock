# Agent Dock for JetBrains

Agent Dock for JetBrains brings widely used AI coding agents into a unified GUI that follows the active JetBrains IDE theme.

The project's goal is to deliver a rich GUI experience for AI agents within JetBrains IDEs, including features absent from other JetBrains AI plugins, such as live token usage updates directly in the chat interface and switching between AI agents within the same chat while preserving session context.

Currently supported AI agents:

- Claude Code
- Codex
- Cursor
- Gemini CLI
- GitHub Copilot
- Kilo
- OpenCode
- Qoder

## Features

- Installation, update, and uninstall flows for supported AI agents inside the plugin.
- Communication with supported AI agents through ACP (Agent Client Protocol) in a GUI.
- Structured display of agent output, including tool use, thinking blocks, terminal commands, plans, file edits, and diffs.
- Review of files changed by an agent, with options to accept selected changes or revert them from the IDE.
- Audio notifications for important chat and agent events.
- Slash commands and `@` mentions backed by JetBrains project file search.
- Code selections and file references can be added to chat from the editor and project view.
- Images can be pasted into chat and previewed inline.
- Live token quota and context usage are shown directly in the chat input while prompting, for agents that support it.
  For Claude Code and Codex, quota data is fetched using the OAuth credentials.
- Voice input for prompts (Windows only).
- Chats can be continued in the IDE terminal when CLI mode is a better fit.
- Chat history supports opening, renaming, deleting, and bulk deletion.
- AI agents can be switched within the same chat while preserving the session context.
- MCP server configuration for additional agent tools and external resources.
- Reusable prompts can be saved in the prompt library and inserted into chat when needed.
- System instructions can be managed and applied to agent sessions.
- Git commit messages can be generated from the current changes.

## Requirements

- JetBrains IDE based on IntelliJ Platform 2025.1 or newer.
- Node.js and npm available on PATH (version must be compatible with the selected AI agents).
- On macOS and Linux, installing some agents requires `curl` and `tar`.
- Some agents use JetBrains IDE terminal for authentication.

## Technology

- **Backend:** Kotlin
- **Frontend:** React, Tailwind
- **Agent communication:** ACP (Agent Client Protocol)

## Screenshot

![Agent Dock for JetBrains chat interface](docs/images/agent-dock-chat.png)
