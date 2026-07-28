import handler from "./_internal/projects.js";
export default function projects(req, res) {
  const operation = String(req.query?.operation || "").trim();
  if (operation) req.body = { ...(req.body || {}), action: operation };
  return handler(req, res);
}
