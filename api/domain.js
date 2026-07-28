const {
  send,
  normalizeDomain,
  validDomain,
  addDomainToVercel,
  getVercelProjectDomain,
  verifyVercelProjectDomain,
  removeDomainFromVercel,
  dnsRecordsFor,
  statusFromVercel,
  authenticatedUser,
  getOwnedProject,
  listOwnedProjects,
  updateProject,
  errorResponse
} = require("../lib/domain-utils");

async function connect(req, res, user) {
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
}

async function check(req, res, user) {
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
}

async function remove(req, res, user) {
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
}

async function status(req, res, user) {
  const projectId = String(req.query?.project_id || "").trim();
  if (projectId) {
    const project = await getOwnedProject(projectId, user.id);
    return send(res, 200, { ok: true, domain: project });
  }

  const projects = await listOwnedProjects(user.id);
  return send(res, 200, { ok: true, projects });
}

module.exports = async function handler(req, res) {
  try {
    const user = await authenticatedUser(req);
    const action = String(req.query?.action || req.body?.action || "status").trim().toLowerCase();

    if (action === "status") {
      if (req.method !== "GET") {
        res.setHeader("Allow", "GET");
        return send(res, 405, { error: "Method not allowed." });
      }
      return status(req, res, user);
    }

    if (action === "connect") {
      if (req.method !== "POST") {
        res.setHeader("Allow", "POST");
        return send(res, 405, { error: "Method not allowed." });
      }
      return connect(req, res, user);
    }

    if (action === "check") {
      if (req.method !== "POST") {
        res.setHeader("Allow", "POST");
        return send(res, 405, { error: "Method not allowed." });
      }
      return check(req, res, user);
    }

    if (action === "remove") {
      if (req.method !== "POST" && req.method !== "DELETE") {
        res.setHeader("Allow", "POST, DELETE");
        return send(res, 405, { error: "Method not allowed." });
      }
      return remove(req, res, user);
    }

    return send(res, 400, { error: "Unknown domain action." });
  } catch (error) {
    return errorResponse(res, error);
  }
};
