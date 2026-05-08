export function parseAdminSet(env) {
  const raw = env.ADMIN_NAMES || "";
  return new Set(
    raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
  );
}

export function enrichCommentRow(r, adminSet) {
  const displayName = r.name && String(r.name).trim() ? String(r.name).trim() : "Anonymous";
  return {
    ...r,
    display_name: displayName,
    is_admin: adminSet.has(displayName),
  };
}

export function enrichComments(results, env) {
  const adminSet = parseAdminSet(env);
  return (results || []).map((r) => enrichCommentRow(r, adminSet));
}
