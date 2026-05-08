import { enrichCommentRow, parseAdminSet } from "../lib/guestbook-enrich.js";
import { fetchCommentChainRows } from "../lib/guestbook-queries.js";
import { escHtml, renderGuestbookArticle } from "../lib/guestbook-render-html.js";

function enrichMaybe(row, adminSet) {
  if (!row) return null;
  return enrichCommentRow(row, adminSet);
}

export async function onRequestGet({ request, env, params }) {
  const rawId = params && params.id != null ? String(params.id) : "";
  const id = parseInt(rawId, 10);
  if (!Number.isInteger(id) || id < 1) {
    return new Response("Not found", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } });
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
    return new Response("Not found", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  }

  const adminSet = parseAdminSet(env);
  const focus = enrichMaybe(chain.focus, adminSet);
  const parents = (chain.parents || []).map((p) => enrichMaybe(p, adminSet));
  const replies = (chain.replies || []).map((r) => enrichCommentRow(r, adminSet));

  const url = new URL(request.url);
  const origin = url.origin;
  const num = String(id).padStart(3, "0");

  const section = (title, inner) =>
    `<section class="guestbook-context-block"><h2 class="guestbook-context-h2">${escHtml(title)}</h2>${inner}</section>`;

  let blocks = "";
  blocks += section("この投稿", renderGuestbookArticle(focus, maxId));
  if (parents.length) {
    blocks += section(
      "返信元",
      `<div class="guestbook-replies">${parents.map((p) => renderGuestbookArticle(p, maxId)).join("\n")}</div>`
    );
  }
  if (replies.length) {
    blocks += section(
      "この投稿への返信",
      `<div class="guestbook-replies">${replies.map((r) => renderGuestbookArticle(r, maxId)).join("\n")}</div>`
    );
  } else {
    blocks += section("この投稿への返信", "<p class=\"guestbook-context-empty\">まだ返信はありません。</p>");
  }

  const html = `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>#${escHtml(num)} | guestbook | idoko.org</title>
  <link rel="stylesheet" href="/styles.css">
</head>
<body>
  <div id="wrapper">
    <header id="header">
      <div id="header-flex">
        <nav id="address" aria-label="パンくずナビゲーション">
          <ol class="breadcrumb">
            <li><a class="addressbar" href="https://idoko.org/">idoko.org</a></li>
            <li><a class="addressbar" href="${escHtml(origin)}/">guestbook</a></li>
            <li aria-current="page"><span class="addressbar">#${escHtml(num)}</span></li>
          </ol>
        </nav>
      </div>
    </header>
    <main id="main">
      <h1 class="title">guestbook · #${escHtml(num)}</h1>
      <p class="guestbook-context-nav"><a href="/">← 一覧へ</a></p>
      ${blocks}
    </main>
    <footer id="main-footer">
      <p>
        <a href="https://idoko.org/">← idoko.org</a>
        <a class="feed-link" href="${escHtml(origin)}/api/guestbook-rss">RSS</a>
      </p>
    </footer>
  </div>
</body>
</html>`;

  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "public, max-age=60",
    },
  });
}
