import { createMCPClient, type MCPClient } from "@ai-sdk/mcp";
import { Experimental_StdioMCPTransport } from "@ai-sdk/mcp/mcp-stdio";
import { tool, type ToolSet } from "ai";
import { z } from "zod";
import { clickhouse } from "@/lib/clickhouse/client";

interface ToolClient {
  tools(): Promise<ToolSet>;
  close(): Promise<void>;
}

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
 * Cloud workers do not include the `uvx` executable used by the local
 * stdio transport. Keep the same two investigation primitives available by
 * exposing a small, explicitly read-only ClickHouse tool surface directly.
 */
function createNativeClickHouseClient(): ToolClient {
  const readOnlyQuery = async (query: string) => {
    const normalized = query.trim().replace(/;\s*$/, "");
    if (!/^(select|with|show|describe|desc|explain)\b/i.test(normalized)) {
      throw new Error("Only read-only SELECT/WITH/SHOW/DESCRIBE queries are allowed");
    }
    const result = await clickhouse().query({
      query: normalized,
      format: "JSONEachRow",
    });
    return result.json<Record<string, unknown>>();
  };

  const tools: ToolSet = {
    list_tables: tool({
      description:
        "List the tables and views in the configured ClickHouse database.",
      inputSchema: z.object({}),
      execute: async () =>
        readOnlyQuery(
          "SELECT name, engine FROM system.tables WHERE database = currentDatabase() ORDER BY name",
        ),
    }),
    run_query: tool({
      description:
        "Run one read-only ClickHouse query. Use SELECT, WITH, SHOW, or DESCRIBE only.",
      inputSchema: z.object({
        query: z.string().min(1).max(20_000),
      }),
      execute: async ({ query }) => {
        const rows = await readOnlyQuery(query);
        return rows.slice(0, 200);
      },
    }),
  };

  return {
    async tools() {
      return tools;
    },
    async close() {},
  };
}

/**
 * Connects the AI SDK to ClickHouse's official MCP server.
 *
 * CLICKHOUSE_MCP_URL selects a managed/hosted HTTP server. Without it, local
 * development starts the official mcp-clickhouse package over stdio via uvx.
 */
export async function createClickHouseMcpClient(): Promise<ToolClient> {
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

  // An explicit command opts into stdio (the local .env.example uses `uvx`).
  // With no command, use the native adapter so Trigger cloud workers do not
  // depend on an executable that is absent from the deployment image.
  if (!process.env.CLICKHOUSE_MCP_COMMAND) {
    return createNativeClickHouseClient();
  }

  return createMCPClient({
    clientName: "trinetra-investigator",
    maxRetries: 1,
    transport: new Experimental_StdioMCPTransport({
      command: process.env.CLICKHOUSE_MCP_COMMAND,
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
