import { createMCPClient, type MCPClient } from "@ai-sdk/mcp";
import { Experimental_StdioMCPTransport } from "@ai-sdk/mcp/mcp-stdio";

function stringEnvironment(): Record<string, string> {
  return Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  );
}

function clickHouseStdioEnvironment(): Record<string, string> {
  if (!process.env.CLICKHOUSE_URL) {
    throw new Error("CLICKHOUSE_URL is required for the ClickHouse MCP server");
  }

  const endpoint = new URL(process.env.CLICKHOUSE_URL);

  return {
    ...stringEnvironment(),
    CLICKHOUSE_HOST: endpoint.hostname,
    CLICKHOUSE_PORT:
      endpoint.port || (endpoint.protocol === "https:" ? "8443" : "8123"),
    CLICKHOUSE_SECURE: String(endpoint.protocol === "https:"),
    CLICKHOUSE_USER: process.env.CLICKHOUSE_USER ?? "default",
    CLICKHOUSE_PASSWORD: process.env.CLICKHOUSE_PASSWORD ?? "",
    CLICKHOUSE_DATABASE: process.env.CLICKHOUSE_DATABASE ?? "default",
    CLICKHOUSE_ALLOW_WRITE_ACCESS: "false",
    CLICKHOUSE_ALLOW_DROP: "false",
  };
}

/**
 * Connects the AI SDK to ClickHouse's official MCP server.
 *
 * CLICKHOUSE_MCP_URL selects a managed/hosted HTTP server. Without it, local
 * development starts the official mcp-clickhouse package over stdio via uvx.
 */
export async function createClickHouseMcpClient(): Promise<MCPClient> {
  const remoteUrl = process.env.CLICKHOUSE_MCP_URL;

  if (remoteUrl) {
    const token = process.env.CLICKHOUSE_MCP_AUTH_TOKEN;
    return createMCPClient({
      clientName: "trinetra-investigator",
      maxRetries: 2,
      transport: {
        type: "http",
        url: remoteUrl,
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      },
    });
  }

  return createMCPClient({
    clientName: "trinetra-investigator",
    maxRetries: 1,
    transport: new Experimental_StdioMCPTransport({
      command: process.env.CLICKHOUSE_MCP_COMMAND ?? "uvx",
      args: ["--python", "3.13", "mcp-clickhouse"],
      env: clickHouseStdioEnvironment(),
      stderr: "pipe",
    }),
  });
}

/**
 * Connects the AI SDK to the ClickStack (HyperDX) MCP server — the second tool
 * surface in the architecture. Where the ClickHouse MCP exposes raw SQL for the
 * long tail, ClickStack exposes higher-level investigation primitives built for
 * logs, metrics, and traces (search, sessions, chart/metric lookups).
 *
 * Optional and additive: returns null unless CLICKSTACK_MCP_URL (hosted HTTP)
 * or CLICKSTACK_MCP_COMMAND (local stdio) is configured, so the raw-SQL path
 * keeps working unchanged when ClickStack is not deployed.
 */
export async function createClickStackMcpClient(): Promise<MCPClient | null> {
  const remoteUrl = process.env.CLICKSTACK_MCP_URL;

  if (remoteUrl) {
    const token = process.env.CLICKSTACK_MCP_AUTH_TOKEN;
    return createMCPClient({
      clientName: "trinetra-clickstack",
      maxRetries: 2,
      transport: {
        type: "http",
        url: remoteUrl,
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      },
    });
  }

  const command = process.env.CLICKSTACK_MCP_COMMAND;
  if (!command) return null;

  return createMCPClient({
    clientName: "trinetra-clickstack",
    maxRetries: 1,
    transport: new Experimental_StdioMCPTransport({
      command,
      args: process.env.CLICKSTACK_MCP_ARGS?.split(" ").filter(Boolean) ?? [],
      env: stringEnvironment(),
      stderr: "pipe",
    }),
  });
}
