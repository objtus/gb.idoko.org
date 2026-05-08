-- 開発／メンテ用: ゲストブック関連データをまとめて消す（スキーマは残す）。
-- replies → parents の順になるようリーフから comments を削る。
-- 使い方: wrangler d1 execute idoko-guestbook [--local|--remote] --file=migrations/dev_reset_d1_data.sql
-- [--remote] は本番 DB。慎重に実行すること。

DELETE FROM comment_reply_targets;
DELETE FROM comments WHERE id NOT IN (SELECT reply_to_id FROM comments WHERE reply_to_id IS NOT NULL);
DELETE FROM comments WHERE id NOT IN (SELECT reply_to_id FROM comments WHERE reply_to_id IS NOT NULL);
DELETE FROM comments WHERE id NOT IN (SELECT reply_to_id FROM comments WHERE reply_to_id IS NOT NULL);
DELETE FROM comments WHERE id NOT IN (SELECT reply_to_id FROM comments WHERE reply_to_id IS NOT NULL);
DELETE FROM comments WHERE id NOT IN (SELECT reply_to_id FROM comments WHERE reply_to_id IS NOT NULL);
DELETE FROM comments WHERE id NOT IN (SELECT reply_to_id FROM comments WHERE reply_to_id IS NOT NULL);
DELETE FROM comments WHERE id NOT IN (SELECT reply_to_id FROM comments WHERE reply_to_id IS NOT NULL);
DELETE FROM comments WHERE id NOT IN (SELECT reply_to_id FROM comments WHERE reply_to_id IS NOT NULL);
DELETE FROM comments WHERE id NOT IN (SELECT reply_to_id FROM comments WHERE reply_to_id IS NOT NULL);
DELETE FROM comments WHERE id NOT IN (SELECT reply_to_id FROM comments WHERE reply_to_id IS NOT NULL);
DELETE FROM comments WHERE id NOT IN (SELECT reply_to_id FROM comments WHERE reply_to_id IS NOT NULL);
DELETE FROM comments WHERE id NOT IN (SELECT reply_to_id FROM comments WHERE reply_to_id IS NOT NULL);
DELETE FROM comments WHERE id NOT IN (SELECT reply_to_id FROM comments WHERE reply_to_id IS NOT NULL);
DELETE FROM comments WHERE id NOT IN (SELECT reply_to_id FROM comments WHERE reply_to_id IS NOT NULL);
DELETE FROM comments WHERE id NOT IN (SELECT reply_to_id FROM comments WHERE reply_to_id IS NOT NULL);
DELETE FROM comments WHERE id NOT IN (SELECT reply_to_id FROM comments WHERE reply_to_id IS NOT NULL);
DELETE FROM comments WHERE id NOT IN (SELECT reply_to_id FROM comments WHERE reply_to_id IS NOT NULL);
DELETE FROM comments WHERE id NOT IN (SELECT reply_to_id FROM comments WHERE reply_to_id IS NOT NULL);
DELETE FROM comments WHERE id NOT IN (SELECT reply_to_id FROM comments WHERE reply_to_id IS NOT NULL);
DELETE FROM comments WHERE id NOT IN (SELECT reply_to_id FROM comments WHERE reply_to_id IS NOT NULL);
DELETE FROM gb_rate_limit;
DELETE FROM sqlite_sequence WHERE name = 'comments';
