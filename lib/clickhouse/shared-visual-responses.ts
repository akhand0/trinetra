import { createHash, randomBytes } from "node:crypto";
import { clickhouse, hasClickHouseConfig } from "@/lib/clickhouse/client";
import {
  visualResponseSchema,
  type VisualResponseData,
} from "@/lib/telemetry/visual-response";

const SHARE_TABLE = "shared_visual_responses";
const SHARE_TOKEN_BYTES = 32;
const SHARE_TTL_DAYS = 7;
const MAX_SHARE_BYTES = 512 * 1024;

export const SHARE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

let ensureShareTablePromise: Promise<void> | null = null;

export class SharedVisualResponseInputError extends Error {}

function clickHouseDate(date: Date) {
  return date.toISOString().slice(0, 19).replace("T", " ");
}

function storedDate(value: string) {
  const normalized = value.includes("T")
    ? value
    : `${value.replace(" ", "T")}Z`;
  const date = new Date(normalized);
  return Number.isNaN(date.valueOf()) ? null : date.toISOString();
}

async function ensureShareTable() {
  if (!hasClickHouseConfig()) {
    throw new Error("ClickHouse is not configured");
  }
  if (!ensureShareTablePromise) {
    ensureShareTablePromise = clickhouse()
      .command({
        query: `
          CREATE TABLE IF NOT EXISTS ${SHARE_TABLE}
          (
            token_hash FixedString(64),
            schema_version UInt8 DEFAULT 1,
            response_id String,
            response_json String CODEC(ZSTD(3)),
            created_at DateTime64(3, 'UTC') DEFAULT now64(3),
            expires_at DateTime('UTC')
          )
          ENGINE = MergeTree
          PARTITION BY toDate(expires_at)
          ORDER BY token_hash
          TTL expires_at DELETE
        `,
      })
      .then(() => undefined)
      .catch((error) => {
        ensureShareTablePromise = null;
        throw error;
      });
  }
  await ensureShareTablePromise;
}

export function createShareToken() {
  return randomBytes(SHARE_TOKEN_BYTES).toString("base64url");
}

export function hashShareToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function prepareSharedVisualResponse(input: unknown) {
  const parsed = visualResponseSchema.safeParse(input);
  if (
    !parsed.success ||
    parsed.data.status !== "complete" ||
    parsed.data.panels.length === 0
  ) {
    throw new SharedVisualResponseInputError(
      "Only completed visual investigations can be shared.",
    );
  }

  const json = JSON.stringify(parsed.data);
  if (Buffer.byteLength(json, "utf8") > MAX_SHARE_BYTES) {
    throw new SharedVisualResponseInputError(
      "This investigation is too large to share.",
    );
  }

  return { response: parsed.data, json };
}

export async function persistSharedVisualResponse(input: unknown) {
  const { response, json } = prepareSharedVisualResponse(input);
  await ensureShareTable();

  const token = createShareToken();
  const tokenHash = hashShareToken(token);
  const expiresAt = new Date(
    Date.now() + SHARE_TTL_DAYS * 24 * 60 * 60 * 1_000,
  );

  await clickhouse().insert({
    table: SHARE_TABLE,
    format: "JSONEachRow",
    values: [
      {
        token_hash: tokenHash,
        schema_version: 1,
        response_id: response.id,
        response_json: json,
        expires_at: clickHouseDate(expiresAt),
      },
    ],
  });

  return { token, expiresAt: expiresAt.toISOString() };
}

export type SharedVisualResponse = {
  response: VisualResponseData;
  createdAt: string;
  expiresAt: string;
};

export async function readSharedVisualResponse(
  token: string,
): Promise<SharedVisualResponse | null> {
  if (!SHARE_TOKEN_PATTERN.test(token)) return null;
  await ensureShareTable();

  const result = await clickhouse().query({
    query: `
      SELECT
        response_json,
        created_at,
        expires_at
      FROM ${SHARE_TABLE}
      PREWHERE token_hash = toFixedString({tokenHash:String}, 64)
      WHERE expires_at > now()
      ORDER BY created_at DESC
      LIMIT 1
    `,
    query_params: { tokenHash: hashShareToken(token) },
    format: "JSONEachRow",
  });
  const [row] = await result.json<{
    response_json: string;
    created_at: string;
    expires_at: string;
  }>();
  if (!row) return null;

  try {
    const parsed = visualResponseSchema.safeParse(JSON.parse(row.response_json));
    const createdAt = storedDate(row.created_at);
    const expiresAt = storedDate(row.expires_at);
    if (
      !parsed.success ||
      parsed.data.status !== "complete" ||
      !createdAt ||
      !expiresAt
    ) {
      return null;
    }
    return { response: parsed.data, createdAt, expiresAt };
  } catch {
    return null;
  }
}
