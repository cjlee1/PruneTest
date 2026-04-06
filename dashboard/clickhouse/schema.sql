-- ClickHouse DDL for the runs table.
-- Run this via the migration script or ClickHouse Cloud console.

CREATE TABLE IF NOT EXISTS runs
(
    id                 String,
    repo_id            String,
    pr_number          UInt32,
    sha                String,
    predicted_skip     Array(String),
    actual_failures    Array(String),
    all_tests          Array(String),
    mode               LowCardinality(String),
    time_saved_minutes Float32,
    created_at         DateTime64(3)
)
ENGINE = ReplacingMergeTree
PARTITION BY (repo_id, toYYYYMM(created_at))
ORDER BY (repo_id, created_at, id);
