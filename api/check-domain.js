const {
  send,
  getVercelProjectDomain,
  verifyVercelProjectDomain,
  dnsRecordsFor,
  statusFromVercel,
  authenticatedUser,
  getOwnedProject,
  updateProject,
  errorResponse
} = require("./_lib/domain-utils");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return send(res, 405, { error: "Method not allowed." });
  }

  try {
    const user = await authenticatedUser(req);
    const projectId = String(req.body?.project_id || "").trim();
    if (!projectId) return send(res, 400, { error: "project_id is required." });

    const project = await getOwnedProject(projectId, user.id);
    if (!project.custom_domain) {
      return send(res, 400, { error: "This website has no custom domain." });
    }

    let vercelDomain;
    try {
      vercelDomain = await verifyVercelProjectDomain(project.custom_domain);
    } catch (_) {
      vercelDomain = await getVercelProjectDomain(project.custom_domain);
    }

    const state = statusFromVercel(vercelDomain);
    const dns = dnsRecordsFor(project.custom_domain, vercelDomain);
    const now = new Date().toISOString();

    const saved = await updateProject(projectId, user.id, {
      ...state,
      verified_at: state.domain_status === "connected" ? (project.verified_at || now) : null,
      domain_last_checked_at: now,
      domain_error: state.domain_status === "connected"
        ? null
        : "DNS is not verified yet. Confirm the displayed records and retry.",
      dns_records: dns.records,
      verification_record: dns.verification_record
    });

    return send(res, 200, {
      ok: true,
      message: state.domain_status === "connected"
        ? "Domain verified. HTTPS is active or being finalized by Vercel."
        : "The domain is still waiting for valid DNS records.",
      domain: saved
    });
  } catch (error) {
    return errorResponse(res, error);
  }
};
