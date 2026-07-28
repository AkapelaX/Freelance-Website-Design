const {
  send,
  removeDomainFromVercel,
  authenticatedUser,
  getOwnedProject,
  updateProject,
  errorResponse
} = require("./_lib/domain-utils");

module.exports = async function handler(req, res) {
  if (req.method !== "POST" && req.method !== "DELETE") {
    res.setHeader("Allow", "POST, DELETE");
    return send(res, 405, { error: "Method not allowed." });
  }

  try {
    const user = await authenticatedUser(req);
    const projectId = String(req.body?.project_id || req.query?.project_id || "").trim();
    if (!projectId) return send(res, 400, { error: "project_id is required." });

    const project = await getOwnedProject(projectId, user.id);
    if (project.custom_domain) {
      try {
        await removeDomainFromVercel(project.custom_domain);
      } catch (error) {
        if (error.status !== 404) throw error;
      }
    }

    const saved = await updateProject(projectId, user.id, {
      custom_domain: null,
      domain_status: "not_connected",
      ssl_status: "waiting",
      dns_verified: false,
      verified_at: null,
      domain_last_checked_at: new Date().toISOString(),
      domain_error: null,
      dns_records: [],
      verification_record: null
    });

    return send(res, 200, { ok: true, domain: saved });
  } catch (error) {
    return errorResponse(res, error);
  }
};
