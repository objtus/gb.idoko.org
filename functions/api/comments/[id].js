import { corsJson } from "../../lib/cors-json.js";
import { enrichCommentRow, parseAdminSet } from "../../lib/guestbook-enrich.js";
import { fetchCommentChainRows } from "../../lib/guestbook-queries.js";

function enrichMaybe(row, adminSet) {
  if (!row) return null;
  return enrichCommentRow(row, adminSet);
}

export async function onRequestGet({ env, params }) {
  const rawId = params && params.id != null ? String(params.id) : "";
  const id = parseInt(rawId, 10);
  if (!Number.isInteger(id) || id < 1) {
    return corsJson({ error: "Not found" }, { status: 404 });
  }

  let maxId = 0;
  try {
    const maxRow = await env.idoko_guestbook.prepare("SELECT MAX(id) AS m FROM comments").first();
    maxId = maxRow && maxRow.m != null ? Number(maxRow.m) : 0;
  } catch {
    maxId = 0;
  }

  const chain = await fetchCommentChainRows(env.idoko_guestbook, id);
  if (!chain || !chain.focus) {
    return corsJson({ error: "Not found" }, { status: 404 });
  }

  const adminSet = parseAdminSet(env);
  return corsJson({
    focus: enrichMaybe(chain.focus, adminSet),
    parent: enrichMaybe(chain.parent, adminSet),
    replies: (chain.replies || []).map((r) => enrichCommentRow(r, adminSet)),
    max_id: maxId,
  });
}
