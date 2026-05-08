export function corsJson(body, init = {}) {
  const h = new Headers(init.headers);
  h.set("Access-Control-Allow-Origin", "*");
  return new Response(typeof body === "string" ? body : JSON.stringify(body), {
    ...init,
    headers: h,
  });
}
