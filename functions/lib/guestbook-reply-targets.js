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
 * mergedTargets の並び順を保ち、comments に実在する id だけ返す（FK に載せる用）。
 * @param {import("@cloudflare/workers-types").D1Database} db
 * @param {number[]} ids
 * @returns {Promise<number[]>}
 */
export async function filterExistingReplyTargetIdsInOrder(db, ids) {
  if (!ids.length) return [];
  const placeholders = ids.map(() => "?").join(",");
  const q = await db
    .prepare(`SELECT id FROM comments WHERE id IN (${placeholders})`)
    .bind(...ids)
    .all();
  const got = new Set((q.results || []).map((r) => Number(r.id)));
  return ids.filter((id) => got.has(id));
}

/**
 * DB に保存できた返信先（junction / reply_to_id）に、本文行頭の >>n を足す（重複は後勝ちで付け足さない）。
 * @param {number[]} storedOrdered
 * @param {string} [message]
 * @returns {number[]}
 */
export function mergeStoredAndLineReplyTargets(storedOrdered, message) {
  const base = Array.isArray(storedOrdered) ? storedOrdered : [];
  const fromLines = parseLineLeadingReplyTargetIds(message || "");
  const seen = new Set(base);
  const out = [...base];
  for (const n of fromLines) {
    if (seen.has(n)) continue;
    seen.add(n);
    out.push(n);
  }
  return out;
}

/**
 * 次の行に付く id が max(id)+1 のとき、存在しない番号への参照がそれだけなら、その投稿自身がその id になる循環参照になる。
 * @param {number[]} mergedTargets
 * @param {number} anticipatedNextId max(id)+1（空なら 1）
 * @param {number[]} existingInOrder DB に存在するターゲット
 */
export function isPhantomOnlySelfCycle(mergedTargets, anticipatedNextId, existingInOrder) {
  if (existingInOrder.length > 0) return false;
  return (
    mergedTargets.length === 1 &&
    mergedTargets[0] === anticipatedNextId &&
    Number.isInteger(anticipatedNextId) &&
    anticipatedNextId > 0
  );
}
