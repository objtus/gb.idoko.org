/** @typedef {{ id:number, display_name?:string, name?:string, is_admin?:boolean, subject?:string|null, message?:string, created_at:string, reply_to_id?:number|null, poster_id?:string }} Enriched */

export function escHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function escAttr(str) {
  return escHtml(str).replace(/'/g, "&#39;");
}

export function permPath(id) {
  return `/guestbook/${String(id).padStart(3, "0")}`;
}

function displaySubjectRow(c) {
  return c.subject && String(c.subject).trim() ? String(c.subject).trim() : "(no subject)";
}

function formatLocalHuman(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleString("ja-JP", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function isoDatetimeAttr(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString();
}

function utf8Bytes(s) {
  return new TextEncoder().encode(s).length;
}

function charCountUnicode(s) {
  return [...String(s)].length;
}

function linkifyUrlsInEscaped(escaped) {
  const re = /https?:\/\/[^\s<]+/gi;
  return escaped.replace(re, (rawMatch) => {
    let u = rawMatch;
    let suffix = "";
    while (u.length && /[.,;:!?。、]+$/.test(u)) {
      suffix = u.slice(-1) + suffix;
      u = u.slice(0, -1);
    }
    const href = u.replace(/&amp;/g, "&");
    let parsed;
    try {
      parsed = new URL(href);
    } catch {
      return rawMatch;
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return rawMatch;
    const safeHref = escAttr(href);
    return `<a class="body-link" href="${safeHref}" rel="noopener noreferrer" target="_blank">${u}</a>${suffix}`;
  });
}

/** @param {string} escapedBody HTML-escaped plain text */
export function linkifyRefsAfterEscapeGuestbook(escapedBody, maxId) {
  return escapedBody.replace(/&gt;&gt;(\d+)/g, (_, digits) => {
    const n = parseInt(digits, 10);
    const stale = n > maxId;
    const cls = stale ? "ref-link ref-link--stale" : "ref-link";
    const href = escAttr(permPath(n));
    return `<a class="${cls}" href="${href}">&gt;&gt;${digits}</a>`;
  });
}

/**
 * @param {Enriched} c
 */
export function renderGuestbookArticle(c, maxId) {
  const id = c.id;
  const subj = displaySubjectRow(c);
  const subjAttr = c.subject && String(c.subject).trim() ? String(c.subject).trim() : "(no subject)";
  const author = escHtml(c.display_name || (c.name && String(c.name).trim() ? c.name : "Anonymous"));
  const star = c.is_admin ? " ★" : "";
  const whenHuman = formatLocalHuman(c.created_at);
  const whenIso = isoDatetimeAttr(c.created_at);
  const pid = String(c.poster_id || "");
  const posterLink = pid
    ? `<a rel="tag" href="/?poster=${encodeURIComponent(pid)}">${escHtml(pid)}</a>`
    : "—";
  const bodyRaw = String(c.message || "");
  const bodyHtml = linkifyRefsAfterEscapeGuestbook(
    linkifyUrlsInEscaped(escHtml(bodyRaw)),
    maxId
  );
  const replyTo = c.reply_to_id
    ? `<a class="u-in-reply-to" href="${escAttr(permPath(c.reply_to_id))}"></a>`
    : "";
  const perm = permPath(id);
  const idDisp = "#" + String(id).padStart(3, "0");

  return `<article class="h-entry guestbook-entry" id="comment-${id}">
  <a class="u-uid" href="${escAttr(perm)}"></a>
  ${replyTo}
  <header>
    <div class="guestbook-head">
      <div class="guestbook-head-line">
        <a class="guestbook-head-id guestbook-head-permalink" href="${escAttr(perm)}" aria-label="${escAttr(`${idDisp} の個別ページ`)}">${escHtml(idDisp)}</a>
        <div class="guestbook-stats">
          <span class="guestbook-stats-meta">${charCountUnicode(bodyRaw)} chars / ${utf8Bytes(bodyRaw)} bytes</span>
          <span class="guestbook-stats-id">ID: ${posterLink}</span>
        </div>
      </div>
      <div class="guestbook-head-meta">
        <span class="guestbook-meta-k">From :</span><span class="guestbook-meta-v"><span class="p-author">${author}</span>${escHtml(star)}</span>
        <span class="guestbook-meta-k">Date :</span><span class="guestbook-meta-v"><time class="dt-published" datetime="${escAttr(whenIso)}">${escHtml(whenHuman)}</time></span>
        <span class="guestbook-meta-k">Subject :</span><span class="guestbook-meta-v">${escHtml(subj)}</span>
      </div>
    </div>
    <data class="p-name" value="${escAttr(subjAttr)}"></data>
  </header>
  <div class="e-content guestbook-body">${bodyHtml}</div>
</article>`;
}
