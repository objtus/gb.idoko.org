/** @typedef {import("@cloudflare/workers-types").D1Database} D1Database */

import { mergeStoredAndLineReplyTargets } from "./guestbook-reply-targets.js";

export const PAGE_LIMIT_DEFAULT = 20;
export const PAGE_LIMIT_MAX = 100;

export function parseListQuery(url) {
  let page = parseInt(url.searchParams.get("page") || "1", 10);
  if (!Number.isInteger(page) || page < 1) page = 1;
  let limit = parseInt(url.searchParams.get("limit") || String(PAGE_LIMIT_DEFAULT), 10);
  if (!Number.isInteger(limit) || limit < 1) limit = PAGE_LIMIT_DEFAULT;
  limit = Math.min(limit, PAGE_LIMIT_MAX);
  const posterRaw = url.searchParams.get("poster");
  const posterFilter = posterRaw && posterRaw.trim() ? posterRaw.trim() : null;
  return { page, limit, posterFilter };
}

/** @param {Record<string, unknown>} r */
export function normalizeCommentRow(r) {
  if (!r) return null;
  const row = {
    id: r.id,
    name: r.name,
    message: r.message,
    created_at: r.created_at,
    subject: r.subject != null && r.subject !== undefined ? r.subject : null,
    reply_to_id: r.reply_to_id != null && r.reply_to_id !== undefined ? r.reply_to_id : null,
    poster_id: r.poster_id != null && r.poster_id !== undefined ? r.poster_id : `legacy-${r.id}`,
  };
  if (Array.isArray(r.reply_target_ids)) {
    row.reply_target_ids = r.reply_target_ids;
  }
  return row;
}

/**
 * junction + レガシー reply_to_id から親 ID 列（重複除去・順序維持）
 * @param {D1Database} db
 */
export async function fetchParentTargetIdsForComment(db, commentId, legacyReplyToId) {
  /** @type {number[]} */
  let ordered = [];
  try {
    const q = await db
      .prepare(
        "SELECT target_id FROM comment_reply_targets WHERE comment_id = ? ORDER BY position ASC"
      )
      .bind(commentId)
      .all();
    ordered = (q.results || []).map((r) => Number(r.target_id)).filter((n) => Number.isInteger(n) && n > 0);
  } catch {
    ordered = [];
  }
  const leg = legacyReplyToId != null ? Number(legacyReplyToId) : NaN;
  if (Number.isInteger(leg) && leg > 0 && !ordered.includes(leg)) {
    ordered = [leg, ...ordered];
  }
  return ordered;
}

/**
 * @param {D1Database} db
 */
export async function fetchReplyTargetsBatch(db, commentIds) {
  if (!commentIds.length) return new Map();
  const placeholders = commentIds.map(() => "?").join(",");
  try {
    const q = await db
      .prepare(
        `SELECT comment_id, target_id FROM comment_reply_targets WHERE comment_id IN (${placeholders}) ORDER BY comment_id, position ASC`
      )
      .bind(...commentIds)
      .all();
    /** @type {Map<number, number[]>} */
    const map = new Map();
    for (const row of q.results || []) {
      const cid = Number(row.comment_id);
      const tid = Number(row.target_id);
      if (!Number.isInteger(cid) || cid < 1) continue;
      if (!Number.isInteger(tid) || tid < 1) continue;
      if (!map.has(cid)) map.set(cid, []);
      map.get(cid).push(tid);
    }
    return map;
  } catch {
    return new Map();
  }
}

/**
 * @template T
 * @param {Array<T & { id: number; reply_to_id?: unknown }>} rows
 * @param {Map<number, number[]>} batchMap
 */
export function attachReplyTargetIds(rows, batchMap) {
  return rows.map((row) => {
    /** @type {number[]} */
    let ids = [];
    const fromJunction = batchMap.get(row.id);
    if (fromJunction && fromJunction.length > 0) {
      ids = [...fromJunction];
    } else if (row.reply_to_id != null && row.reply_to_id !== "") {
      const rid = Number(row.reply_to_id);
      if (Number.isInteger(rid) && rid > 0) {
        ids = [rid];
      }
    }
    const msg = typeof row.message === "string" ? row.message : "";
    return { ...row, reply_target_ids: mergeStoredAndLineReplyTargets(ids, msg) };
  });
}

/**
 * @param {D1Database} db
 */
export async function rowById(db, id) {
  try {
    const r = await db.prepare("SELECT * FROM comments WHERE id = ?").bind(id).first();
    return r ? normalizeCommentRow(r) : null;
  } catch {
    return null;
  }
}

/**
 * @param {D1Database} db
 */
export async function fetchCommentsPage(db, pageIn, limit, posterFilter) {
  if (posterFilter) {
    try {
      const countRow = await db
        .prepare("SELECT COUNT(*) AS c FROM comments WHERE poster_id = ?")
        .bind(posterFilter)
        .first();
      const totalCount = countRow ? Number(countRow.c) : 0;
      const totalPages = Math.max(1, Math.ceil(totalCount / limit));
      const page = Math.min(pageIn, totalPages);
      const offset = (page - 1) * limit;
      const q = await db
        .prepare(
          "SELECT * FROM comments WHERE poster_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?"
        )
        .bind(posterFilter, limit, offset)
        .all();
      return {
        results: (q.results || []).map((r) => normalizeCommentRow(r)),
        totalCount,
        page,
      };
    } catch {
      return { results: [], totalCount: 0, page: 1 };
    }
  }

  const countRow = await db.prepare("SELECT COUNT(*) AS c FROM comments").first();
  const totalCount = countRow ? Number(countRow.c) : 0;
  const totalPages = Math.max(1, Math.ceil(totalCount / limit));
  const page = Math.min(pageIn, totalPages);
  const offset = (page - 1) * limit;
  const q = await db
    .prepare("SELECT * FROM comments ORDER BY created_at DESC LIMIT ? OFFSET ?")
    .bind(limit, offset)
    .all();
  return {
    results: (q.results || []).map((r) => normalizeCommentRow(r)),
    totalCount,
    page,
  };
}

/**
 * @param {D1Database} db
 */
export async function fetchCommentChainRows(db, id) {
  const focus = await rowById(db, id);
  if (!focus) return null;

  const parentIds = await fetchParentTargetIdsForComment(db, focus.id, focus.reply_to_id);
  const parentIdsMerged = mergeStoredAndLineReplyTargets(
    parentIds,
    typeof focus.message === "string" ? focus.message : ""
  );
  /** @type {number[]} */
  const parentIdList = [];
  const seenP = new Set();
  for (const pid of parentIdsMerged) {
    if (pid === id || seenP.has(pid)) continue;
    seenP.add(pid);
    parentIdList.push(pid);
  }

  const focusOut = { ...focus, reply_target_ids: parentIdList };

  const parents = [];
  for (const pid of parentIdList) {
    const p = await rowById(db, pid);
    if (p) parents.push(p);
  }

  let replies = [];
  try {
    const q = await db
      .prepare(
        `SELECT c.* FROM comments c
         WHERE c.reply_to_id = ?
            OR EXISTS (SELECT 1 FROM comment_reply_targets t WHERE t.comment_id = c.id AND t.target_id = ?)
         ORDER BY c.created_at ASC
         LIMIT 100`
      )
      .bind(id, id)
      .all();
    replies = (q.results || []).map((r) => normalizeCommentRow(r));
  } catch {
    try {
      const q = await db
        .prepare("SELECT * FROM comments WHERE reply_to_id = ? ORDER BY created_at ASC LIMIT 100")
        .bind(id)
        .all();
      replies = (q.results || []).map((r) => normalizeCommentRow(r));
    } catch {
      replies = [];
    }
  }

  const chainIds = [
    ...parents.map((p) => p.id),
    ...replies.map((r) => r.id),
  ];
  const rtMapChain = await fetchReplyTargetsBatch(db, chainIds);
  const parentsEnriched = attachReplyTargetIds(parents, rtMapChain);
  const repliesEnriched = attachReplyTargetIds(replies, rtMapChain);

  return { focus: focusOut, parents: parentsEnriched, replies: repliesEnriched };
}
