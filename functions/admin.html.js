/**
 * SPA フォールバックで静的 admin.html が index と同一になる場合があるため、/admin.html は Functions で応答する。
 */
import adminMarkup from "./admin-markup.js";

export function onRequestGet() {
  return new Response(adminMarkup, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "private, max-age=0, must-revalidate",
    },
  });
}
