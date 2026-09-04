CREATE TABLE IF NOT EXISTS otel.audit_events
(
    id               String,
    created_at       DateTime     DEFAULT now(),
    actor_username   String,
    action           String,
    resource_type    String,
    resource_id      String,
    ai_system_id     String       DEFAULT '',
    ai_system_name   String       DEFAULT '',
    changes          String       DEFAULT '{}',
    source           String       DEFAULT 'ui'
) ENGINE = MergeTree()
PARTITION BY toYYYYMM(created_at)
ORDER BY (created_at, ai_system_id, action)
TTL created_at + INTERVAL 7 DAY TO DISK 'minio'
SETTINGS storage_policy = 'tiered';
