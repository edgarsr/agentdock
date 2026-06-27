export type McpTransport = 'stdio' | 'http' | 'sse';

export interface McpEnvVar {
  name: string;
  value: string;
}

export interface McpHeader {
  name: string;
  value: string;
}

export interface McpServerConfig {
  id: string;
  name: string;
  enabled: boolean;
  transport: McpTransport;
  // stdio
  command?: string;
  args?: string[];
  env?: McpEnvVar[];
  // http / sse
  url?: string;
  headers?: McpHeader[];
}

/**
 * Runtime status of an MCP server. Mirrors the backend `McpStatus` enum
 * (src/main/kotlin/agentdock/mcp/McpStatus.kt). Transient - not persisted, reflects the
 * latest reachability/health probe pushed from McpBridge.
 */
export type McpStatus = 'unknown' | 'loading' | 'connected' | 'error' | 'disabled';

export interface McpStatusUpdate {
  id: string;
  status: McpStatus;
  message?: string;
}
