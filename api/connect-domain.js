const {
  send,
  normalizeDomain,
  validDomain,
  addDomainToVercel,
  dnsRecordsFor,
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
    const domain = normalizeDomain(req.body?.domain);

    if (!projectId) return send(res, 400, { error: "project_id is required." });
    if (!validDomain(domain)) return send(res, 400, { error: "Enter a valid custom domain." });

    const project = await getOwnedProject(projectId, user.id);
    if (project.custom_domain && project.custom_domain !== domain) {
      return send(res, 409, {
        error: "Remove the current custom domain before connecting a different one."
      });
    }

    const vercelDomain = await addDomainToVercel(domain);
    const dns = dnsRecordsFor(domain, vercelDomain);

    const saved = await updateProject(projectId, user.id, {
      custom_domain: domain,
      domain_status: "verifying",
      ssl_status: "provisioning",
      dns_verified: false,
      verified_at: null,
      domain_last_checked_at: new Date().toISOString(),
      domain_error: null,
      dns_records: dns.records,
      verification_record: dns.verification_record
    });

    return send(res, 200, {
      ok: true,
      message: "Domain added. Configure the DNS records, then verify the connection.",
      domain: saved
    });
  } catch (error) {
    return errorResponse(res, error);
  }
};
