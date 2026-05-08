import { corsJson } from "../lib/cors-json.js";
import { enrichComments } from "../lib/guestbook-enrich.js";
import {
  attachReplyTargetIds,
  fetchCommentsPage,
  fetchReplyTargetsBatch,
  parseListQuery,
} from "../lib/guestbook-queries.js";
import {
  MAX_REPLY_TARGETS,
  filterExistingReplyTargetIdsInOrder,
  isPhantomOnlySelfCycle,
  mergeExplicitAndParsedReplyTargets,
} from "../lib/guestbook-reply-targets.js";

const NAME_MAX = 50;
const SUBJECT_MAX = 120;
const MESSAGE_MAX = 1000;
const RATE_LIMIT_SEC = 45;
const POSTER_HASH_BYTES = 8;

async function verifyTurnstile(token, ip, secret) {
  const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ secret, response: token, remoteip: ip }),
  });
  const data = await res.json();
  return data.success;
}

async function hashPosterId(ip, env) {
  const salt = env.POSTER_ID_SALT || env.TURNSTILE_SECRET || "guestbook-poster-salt";
  const data = new TextEncoder().encode(`${salt}:${ip || "unknown"}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return hex.slice(0, POSTER_HASH_BYTES * 2);
}

function parseBearerToken(request) {
  const h = request.headers.get("Authorization") || "";
  const m = /^Bearer\s+(\S+)$/i.exec(h.trim());
  return m ? m[1] : null;
}

/** Dashboard / .dev.vars の値を正規化（型の揺らぎに弱くする） */
function normalizedAdminDeleteSecret(env) {
  const v = env.ADMIN_DELETE_SECRET;
  if (v == null) return "";
  if (typeof v === "string") return v.trim();
  return String(v).trim();
}

async function rateLimitWaitSec(db, ip) {
  if (!ip) return null;
  const row = await db.prepare("SELECT last_post_unix FROM gb_rate_limit WHERE ip = ?").bind(ip).first();
  const now = Math.floor(Date.now() / 1000);
  if (row && now - row.last_post_unix < RATE_LIMIT_SEC) {
    return Math.max(1, RATE_LIMIT_SEC - (now - row.last_post_unix));
  }
  return null;
}

async function touchRateLimit(db, ip) {
  if (!ip) return;
  const now = Math.floor(Date.now() / 1000);
  await db
    .prepare(
      "INSERT INTO gb_rate_limit (ip, last_post_unix) VALUES (?, ?) ON CONFLICT(ip) DO UPDATE SET last_post_unix = excluded.last_post_unix"
    )
    .bind(ip, now)
    .run();
}

export async function onRequestGet({ request, env }) {
  try {
    const db = env.idoko_guestbook;
    const url = new URL(request.url);
    const { page: requestedPage, limit, posterFilter } = parseListQuery(url);
    const { results, totalCount, page } = await fetchCommentsPage(db, requestedPage, limit, posterFilter);
    const targetMap = await fetchReplyTargetsBatch(
      db,
      results.map((r) => r.id)
    );
    const withTargets = attachReplyTargetIds(results, targetMap);
    const enriched = enrichComments(withTargets, env);

    let maxId = 0;
    try {
      const maxRow = await db.prepare("SELECT MAX(id) AS m FROM comments").first();
      maxId = maxRow && maxRow.m != null ? Number(maxRow.m) : 0;
    } catch {
      maxId = enriched.length ? Math.max(...enriched.map((r) => r.id)) : 0;
    }

    const totalPages = Math.max(1, Math.ceil(totalCount / limit));
    return corsJson({
      comments: enriched,
      max_id: maxId,
      page,
      page_size: limit,
      total_count: totalCount,
      total_pages: totalPages,
      has_prev: page > 1,
      has_next: page < totalPages,
    });
  } catch (e) {
    console.error("comments_get", e);
    return corsJson({ error: "Database error" }, { status: 500 });
  }
}

export async function onRequestPost({ request, env }) {
  const ip = request.headers.get("CF-Connecting-IP") || "";
  let body;
  try {
    body = await request.json();
  } catch {
    return corsJson({ error: "Invalid JSON" }, { status: 400 });
  }

  const {
    name: rawName,
    subject: rawSubject,
    message,
    turnstileToken,
    reply_to_id: rawReplyId,
    website: honeypot,
  } = body;

  if (honeypot != null && String(honeypot).trim() !== "") {
    return corsJson({ error: "Bad request" }, { status: 400 });
  }
  if (!message || typeof message !== "string" || !turnstileToken) {
    return corsJson({ error: "Missing fields" }, { status: 400 });
  }

  const nameTrim = typeof rawName === "string" ? rawName.trim() : "";
  const storedName = nameTrim.length ? nameTrim.slice(0, NAME_MAX) : "Anonymous";

  let subject = null;
  if (rawSubject != null && String(rawSubject).trim() !== "") {
    subject = String(rawSubject).trim().slice(0, SUBJECT_MAX);
  }

  const msgTrim = message.trim();
  if (!msgTrim.length) {
    return corsJson({ error: "Message required" }, { status: 400 });
  }
  if (msgTrim.length > MESSAGE_MAX) {
    return corsJson({ error: "Too long" }, { status: 400 });
  }

  let explicitReplyOptional = null;
  if (rawReplyId != null && rawReplyId !== "") {
    const n = Number(rawReplyId);
    if (!Number.isInteger(n) || n < 1) {
      return corsJson({ error: "Invalid reply" }, { status: 400 });
    }
    explicitReplyOptional = n;
  }

  const mergedTargets = mergeExplicitAndParsedReplyTargets(explicitReplyOptional, msgTrim);
  if (mergedTargets.length > MAX_REPLY_TARGETS) {
    return corsJson(
      { error: `Too many reply targets (max ${MAX_REPLY_TARGETS})` },
      { status: 400 }
    );
  }

  let maxIdForReply = 0;
  try {
    const maxRow = await env.idoko_guestbook.prepare("SELECT MAX(id) AS m FROM comments").first();
    maxIdForReply = maxRow && maxRow.m != null ? Number(maxRow.m) : 0;
  } catch {
    maxIdForReply = 0;
  }
  const anticipatedNextId = maxIdForReply + 1;
  const existingTargetsInOrder =
    mergedTargets.length > 0
      ? await filterExistingReplyTargetIdsInOrder(env.idoko_guestbook, mergedTargets)
      : [];

  if (isPhantomOnlySelfCycle(mergedTargets, anticipatedNextId, existingTargetsInOrder)) {
    return corsJson({ error: "Invalid reply target" }, { status: 400 });
  }

  const primaryReply = existingTargetsInOrder.length ? existingTargetsInOrder[0] : null;

  const valid = await verifyTurnstile(turnstileToken, ip, env.TURNSTILE_SECRET);
  if (!valid) {
    return corsJson({ error: "Turnstile failed" }, { status: 403 });
  }

  try {
    const waitSec = await rateLimitWaitSec(env.idoko_guestbook, ip);
    if (waitSec !== null) {
      return corsJson({ error: `Rate limited; try again in ${waitSec}s` }, { status: 429 });
    }
  } catch (e) {
    console.error("rate_limit", e);
  }

  const posterId = await hashPosterId(ip, env);
  const db = env.idoko_guestbook;

  try {
    await db
      .prepare(
        "INSERT INTO comments (name, subject, message, reply_to_id, poster_id) VALUES (?, ?, ?, ?, ?)"
      )
      .bind(storedName, subject, msgTrim, primaryReply, posterId)
      .run();
    const idRow = await db.prepare("SELECT last_insert_rowid() AS id").first();
    const newId = idRow && idRow.id != null ? Number(idRow.id) : NaN;

    if (Number.isInteger(newId) && newId > 0 && existingTargetsInOrder.length > 0) {
      try {
        for (let pos = 0; pos < existingTargetsInOrder.length; pos++) {
          await db
            .prepare(
              "INSERT INTO comment_reply_targets (comment_id, target_id, position) VALUES (?, ?, ?)"
            )
            .bind(newId, existingTargetsInOrder[pos], pos)
            .run();
        }
      } catch (je) {
        console.error("comment_reply_targets_insert", je);
      }
    }
  } catch (e) {
    if (e && String(e.message || "").includes("no such column")) {
      await env.idoko_guestbook
        .prepare("INSERT INTO comments (name, message) VALUES (?, ?)")
        .bind(storedName, msgTrim)
        .run();
    } else {
      console.error("insert", e);
      return corsJson({ error: "Database error" }, { status: 500 });
    }
  }

  try {
    await touchRateLimit(env.idoko_guestbook, ip);
  } catch (e) {
    console.error("touch_rate_limit", e);
  }

  return corsJson({ ok: true });
}

export async function onRequestDelete({ request, env }) {
  const expected = normalizedAdminDeleteSecret(env);
  if (!expected) {
    return corsJson({ error: "Admin delete not configured" }, { status: 503 });
  }
  const token = parseBearerToken(request);
  if (!token || token !== expected) {
    return corsJson({ error: "Unauthorized" }, { status: 401 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return corsJson({ error: "Invalid JSON" }, { status: 400 });
  }

  const n = Number(body && body.id);
  if (!Number.isInteger(n) || n < 1) {
    return corsJson({ error: "Invalid id" }, { status: 400 });
  }

  try {
    await env.idoko_guestbook
      .prepare("DELETE FROM comment_reply_targets WHERE comment_id = ? OR target_id = ?")
      .bind(n, n)
      .run();
  } catch {
    /* 未マイグレーション環境 */
  }

  try {
    const result = await env.idoko_guestbook.prepare("DELETE FROM comments WHERE id = ?").bind(n).run();
    const affected = Number(result.meta?.rows_written ?? result.meta?.changes ?? 0);
    if (!result.success || affected < 1) {
      return corsJson({ error: "Not found" }, { status: 404 });
    }
  } catch (e) {
    console.error("delete_comment", e);
    return corsJson({ error: "Database error" }, { status: 500 });
  }

  return corsJson({ ok: true });
}

export async function onRequestOptions() {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    },
  });
}
