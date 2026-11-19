-- Fallback luu media nho (<= 1.4MB) vao D1 khi R2 chua duoc bat tren Dashboard.
-- Khi R2 duoc bat (binding MEDIA), tat ca file moi tu dong chuyen sang R2.

CREATE TABLE IF NOT EXISTS media_blobs (
    key TEXT PRIMARY KEY,
    content_type TEXT NOT NULL DEFAULT 'application/octet-stream',
    size INTEGER NOT NULL DEFAULT 0,
    data_b64 TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
