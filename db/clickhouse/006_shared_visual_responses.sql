CREATE TABLE IF NOT EXISTS shared_visual_responses
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
TTL expires_at DELETE;
