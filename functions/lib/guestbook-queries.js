/** @typedef {import("@cloudflare/workers-types").D1Database} D1Database */

export const PAGE_LIMIT_DEFAULT = 25;
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
  return {
    id: r.id,
    name: r.name,
    message: r.message,
    created_at: r.created_at,
    subject: r.subject != null && r.subject !== undefined ? r.subject : null,
    reply_to_id: r.reply_to_id != null && r.reply_to_id !== undefined ? r.reply_to_id : null,
    poster_id: r.poster_id != null && r.poster_id !== undefined ? r.poster_id : `legacy-${r.id}`,
  };
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

  let parent = null;
  const replyToId = focus.reply_to_id != null ? Number(focus.reply_to_id) : NaN;
  if (Number.isInteger(replyToId) && replyToId > 0 && replyToId !== id) {
    parent = await rowById(db, replyToId);
  }

  let replies = [];
  try {
    const q = await db
      .prepare(
        "SELECT * FROM comments WHERE reply_to_id = ? ORDER BY created_at ASC LIMIT 100"
      )
      .bind(id)
      .all();
    replies = (q.results || []).map((r) => normalizeCommentRow(r));
  } catch {
    replies = [];
  }

  return { focus, parent, replies };
}
