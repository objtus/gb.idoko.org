-- 複数返信先（親投稿への N:N）
-- 適用後: INSERT INTO comments / comment_reply_targets をコードから利用する
-- 適用例: wrangler d1 execute idoko-guestbook --local --file=migrations/0002_comment_reply_targets.sql
-- 本番例: wrangler d1 execute idoko-guestbook --remote --file=migrations/0002_comment_reply_targets.sql

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS comment_reply_targets (
  comment_id INTEGER NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
  target_id  INTEGER NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
  position   INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (comment_id, target_id)
);

CREATE INDEX IF NOT EXISTS idx_reply_targets_target
  ON comment_reply_targets(target_id);

-- 既存の reply_to_id を代表行として複製（position 0）
INSERT OR IGNORE INTO comment_reply_targets (comment_id, target_id, position)
SELECT id, reply_to_id, 0
FROM comments
WHERE reply_to_id IS NOT NULL;
