import config from "./_internal/config.js";
import account from "./_internal/account.js";
import projects from "./_internal/projects.js";
import publicSite from "./_internal/public-site.js";
import publishSite from "./_internal/publish-site.js";
import checkout from "./_internal/create-checkout-session.js";
import portal from "./_internal/create-portal-session.js";
import exportWebsite from "./_internal/export-website.js";
import domain from "./_internal/domain.js";

const routes = { config, account, "account-status": account, projects, "public-site": publicSite,
  "publish-site": publishSite, "create-checkout-session": checkout,
  "create-portal-session": portal, "export-website": exportWebsite, domain };

export default async function handler(req, res) {
  const action = String(req.query?.action || "").trim().toLowerCase();
  const selected = routes[action];
  if (!selected) return res.status(404).json({ error: "Unknown API action." });
  if (action === "projects" && req.query?.operation) {
    req.body = { ...(req.body || {}), action: req.query.operation };
  }
  return selected(req, res);
}
