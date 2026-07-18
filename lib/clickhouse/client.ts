import { createClient, type ClickHouseClient } from "@clickhouse/client";

let singleton: ClickHouseClient | null = null;

export function hasClickHouseConfig(): boolean {
  return Boolean(process.env.CLICKHOUSE_URL);
}

export function clickhouse(): ClickHouseClient {
  if (singleton) return singleton;
  if (!process.env.CLICKHOUSE_URL) {
    throw new Error("CLICKHOUSE_URL is not configured");
  }

  singleton = createClient({
    url: process.env.CLICKHOUSE_URL,
    username: process.env.CLICKHOUSE_USER ?? "default",
    password: process.env.CLICKHOUSE_PASSWORD ?? "",
    database: process.env.CLICKHOUSE_DATABASE ?? "default",
    clickhouse_settings: {
      async_insert: 1,
      wait_for_async_insert: 1,
    },
  });

  return singleton;
}
