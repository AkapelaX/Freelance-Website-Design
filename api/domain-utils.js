const JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0"
};

function send(res, status, body) {
  res.status(status);
  Object.entries(JSON_HEADERS).forEach(([key, value]) => res.setHeader(key, value));
  return res.json(body);
}

function cleanText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeDomain(value) {
  return cleanText(value)
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "")
    .replace(/\.$/, "");
}

function validDomain(domain) {
  if (!domain || domain.length > 253 || domain.includes("..")) return false;
  if (domain === "localhost" || domain.endsWith(".localhost")) return false;
  return /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i.test(domain);
}

function env(name, required = true) {
  const value = cleanText(process.env[name]);
  if (required && !value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function teamQuery() {
  const teamId = env("VERCEL_TEAM_ID", false);
  return teamId ? `?teamId=${encodeURIComponent(teamId)}` : "";
}

async function vercelRequest(path, options = {}) {
  const token = env("VERCEL_TOKEN");
  const response = await fetch(`https://api.vercel.com${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(
      payload.error?.message ||
      payload.message ||
      `Vercel request failed with status ${response.status}.`
    );
    error.status = response.status;
    error.payload = payload;
    throw error;
  }
  return payload;
}

function projectDomainsPath(domain = "") {
  const projectId = encodeURIComponent(env("VERCEL_PROJECT_ID"));
  const suffix = domain ? `/${encodeURIComponent(domain)}` : "";
  return `/v10/projects/${projectId}/domains${suffix}${teamQuery()}`;
}

async function addDomainToVercel(domain) {
  try {
    return await vercelRequest(projectDomainsPath(), {
      method: "POST",
      body: JSON.stringify({ name: domain })
    });
  } catch (error) {
    const code = error.payload?.error?.code || error.payload?.code;
    if (
      error.status === 409 ||
      code === "domain_already_in_use" ||
      code === "domain_already_exists"
    ) {
      return getVercelProjectDomain(domain);
    }
    throw error;
  }
}

async function getVercelProjectDomain(domain) {
  return vercelRequest(projectDomainsPath(domain), { method: "GET" });
}

async function verifyVercelProjectDomain(domain) {
  const projectId = encodeURIComponent(env("VERCEL_PROJECT_ID"));
  return vercelRequest(
    `/v9/projects/${projectId}/domains/${encodeURIComponent(domain)}/verify${teamQuery()}`,
    { method: "POST", body: "{}" }
  );
}

async function removeDomainFromVercel(domain) {
  return vercelRequest(projectDomainsPath(domain), { method: "DELETE" });
}

function dnsRecordsFor(domain, vercelData = {}) {
  const apex = domain.split(".").length === 2;
  const records = apex
    ? [
        { type: "A", name: "@", value: "76.76.21.21" },
        { type: "CNAME", name: "www", value: "cname.vercel-dns.com" }
      ]
    : [
        {
          type: "CNAME",
          name: domain.split(".")[0],
          value: "cname.vercel-dns.com"
        }
      ];

  const verification = Array.isArray(vercelData.verification)
    ? vercelData.verification[0]
    : null;

  return {
    records,
    verification_record: verification
      ? {
          type: verification.type || "TXT",
          name: verification.domain || verification.name || `_vercel.${domain}`,
          value: verification.value || ""
        }
      : null
  };
}

function statusFromVercel(data = {}) {
  const verified =
    data.verified === true ||
    data.verification?.length === 0 ||
    data.misconfigured === false;

  const misconfigured = data.misconfigured === true;
  const domainStatus = verified && !misconfigured ? "connected" : "verifying";
  const sslStatus = domainStatus === "connected" ? "active" : "provisioning";

  return {
    domain_status: domainStatus,
    dns_verified: domainStatus === "connected",
    ssl_status: sslStatus
  };
}

async function supabaseRequest(path, options = {}) {
  const url = env("SUPABASE_URL").replace(/\/$/, "");
  const key = env("SUPABASE_SERVICE_ROLE_KEY");
  const response = await fetch(`${url}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Prefer: options.prefer || "return=representation",
      ...(options.headers || {})
    }
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(payload?.message || payload?.hint || `Database request failed (${response.status}).`);
    error.status = response.status;
    error.payload = payload;
    throw error;
  }
  return payload;
}

async function authenticatedUser(req) {
  const authorization = cleanText(req.headers.authorization);
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  if (!token) {
    const error = new Error("Authentication required.");
    error.status = 401;
    throw error;
  }

  const url = env("SUPABASE_URL").replace(/\/$/, "");
  const anonKey = env("SUPABASE_ANON_KEY");
  const response = await fetch(`${url}/auth/v1/user`, {
    headers: { apikey: anonKey, Authorization: `Bearer ${token}` }
  });
  const user = await response.json().catch(() => ({}));
  if (!response.ok || !user?.id) {
    const error = new Error("Your session is invalid or expired.");
    error.status = 401;
    throw error;
  }
  return user;
}

async function getOwnedProject(projectId, userId) {
  const query =
    `website_projects?id=eq.${encodeURIComponent(projectId)}` +
    `&user_id=eq.${encodeURIComponent(userId)}` +
    `&select=id,user_id,name,title,slug,published_url,public_url,custom_domain,domain_status,ssl_status,verified_at,dns_verified,domain_last_checked_at,domain_error,dns_records,verification_record`;
  const rows = await supabaseRequest(query, { method: "GET" });
  const project = Array.isArray(rows) ? rows[0] : null;
  if (!project) {
    const error = new Error("Website project not found.");
    error.status = 404;
    throw error;
  }
  return project;
}

async function listOwnedProjects(userId) {
  const query =
    `website_projects?user_id=eq.${encodeURIComponent(userId)}` +
    `&select=id,name,title,slug,published_url,public_url,custom_domain,domain_status,ssl_status,verified_at,dns_verified,domain_last_checked_at,domain_error,dns_records,verification_record` +
    `&order=updated_at.desc`;
  return supabaseRequest(query, { method: "GET" });
}

async function updateProject(projectId, userId, patch) {
  const query =
    `website_projects?id=eq.${encodeURIComponent(projectId)}` +
    `&user_id=eq.${encodeURIComponent(userId)}`;
  const rows = await supabaseRequest(query, {
    method: "PATCH",
    body: JSON.stringify(patch),
    prefer: "return=representation"
  });
  return Array.isArray(rows) ? rows[0] : rows;
}

function errorResponse(res, error) {
  console.error("Bluvixa domain API error:", error);
  return send(res, error.status || 500, {
    error: error.message || "Unexpected domain service error."
  });
}

module.exports = {
  send,
  cleanText,
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
};
