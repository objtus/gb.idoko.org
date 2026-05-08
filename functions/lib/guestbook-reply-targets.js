/** 単一行がトリム後に ^>>(正の整数)$ に一致するときのみ返信先番号として採用（インライン >> は無視） */
const LINE_HEAD_REF_RE = /^>>(\d+)$/;

export const MAX_REPLY_TARGETS = 15;

/**
 * メッセージ本文から「行頭」形式の参照 ID を順に収集し、重複を除く。
 * @param {string} message トリム後の本文
 * @returns {number[]}
 */
export function parseLineLeadingReplyTargetIds(message) {
  const out = [];
  const seen = new Set();
  for (const raw of String(message).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const m = LINE_HEAD_REF_RE.exec(line);
    if (!m) continue;
    const n = parseInt(m[1], 10);
    if (!Number.isInteger(n) || n < 1) continue;
    if (seen.has(n)) continue;
    seen.add(n);
    out.push(n);
  }
  return out;
}

/**
 * フォームの reply_to_id（↩ で先頭）と本文パース結果を一意化マージした配列。
 * @param {number|null} explicitReplyId 検証済みの整数または null
 * @param {string} messageTrim
 * @returns {number[]}
 */
export function mergeExplicitAndParsedReplyTargets(explicitReplyId, messageTrim) {
  const fromBody = parseLineLeadingReplyTargetIds(messageTrim);
  const merged = [];
  const seen = new Set();
  if (explicitReplyId != null && Number.isInteger(explicitReplyId) && explicitReplyId > 0) {
    seen.add(explicitReplyId);
    merged.push(explicitReplyId);
  }
  for (const n of fromBody) {
    if (!seen.has(n)) {
      seen.add(n);
      merged.push(n);
    }
  }
  return merged;
}

/**
 * DB 上にすべて存在することを確認する。欠けがあると null。
 * @param {import("@cloudflare/workers-types").D1Database} db
 * @param {number[]} ids
 * @returns {Promise<boolean>}
 */
export async function allReplyTargetsExist(db, ids) {
  if (!ids.length) return true;
  const placeholders = ids.map(() => "?").join(",");
  const q = await db
    .prepare(`SELECT id FROM comments WHERE id IN (${placeholders})`)
    .bind(...ids)
    .all();
  const got = new Set((q.results || []).map((r) => Number(r.id)));
  for (const id of ids) {
    if (!got.has(id)) return false;
  }
  return true;
}
