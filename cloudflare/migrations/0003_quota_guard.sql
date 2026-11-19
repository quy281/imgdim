-- Bang theo doi dung luong & luot ghi/doc R2 hang thang de khong che khong phat sinh phi vuot goi Free Tier.

CREATE TABLE IF NOT EXISTS r2_ledger (
    r2_key TEXT PRIMARY KEY,
    size INTEGER NOT NULL DEFAULT 0,
    updated_ms INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS quota_monthly (
    month TEXT PRIMARY KEY,
    class_a INTEGER NOT NULL DEFAULT 0,
    class_b INTEGER NOT NULL DEFAULT 0
);
