"use strict";

const dns = require("node:dns").promises;
const { getAdmin } = require("./_supabase");
const { requireUser, requireProjectOwner } = require("./_auth");
const {
  ok,
  fail,
  method,
  action,
  parseJsonBody,
  text,
  slugify,
  normalizeDomain,
  handleError
} = require("./_utils");

const EXPECTED_A = process.env.DOMAIN_A_RECORD || "76.76.21.21";
const EXPECTED_CNAME = process.env.DOMAIN_CNAME_RECORD || "cname.vercel-dns.com";

async function vercelRequest(path, options = {}) {
  if (!process.env.VERCEL_TOKEN || !process.env.VERCEL_PROJECT_ID) return null;
  const team = process.env.VERCEL_TEAM_ID
    ? `?teamId=${encodeURIComponent(process.env.VERCEL_TEAM_ID)}`
    : "";
  const response = await fetch(`https://api.vercel.com${path}${team}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${process.env.VERCEL_TOKEN}`,
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok && response.status !== 409) {
    const error = new Error(payload.error?.message || "Vercel domain request failed");
    error.status = response.status;
    throw error;
  }
  return payload;
}

module.exports = async function handler(req, res) {
  try {
    const name = action(req, "check-slug");
    const body = parseJsonBody(req);
    const supabase = getAdmin();

    if (name === "check-slug") {
      method(req, ["GET"]);
      const slug = slugify(req.query.slug);
      const projectId = text(req.query.project_id, 80);

      let query = supabase
        .from("projects")
        .select("id", { count: "exact", head: true })
        .eq("slug", slug);

      if (projectId) {
        query = query.neq("id", projectId);
      }

      const { count, error } = await query;
      if (error) throw error;

      return ok(res, {
        slug,
        available: Number(count || 0) === 0
      });
    }

    const user = await requireUser(req);

    if (name === "connect") {
      method(req, ["POST"]);
      const projectId = text(body.project_id, 80);
      const domain = normalizeDomain(body.domain);
      if (!domain.includes(".")) return fail(res, 400, "Valid domain required");
      await requireProjectOwner(projectId, user.id);

      await vercelRequest(`/v10/projects/${encodeURIComponent(process.env.VERCEL_PROJECT_ID)}/domains`, {
        method: "POST",
        body: JSON.stringify({ name: domain })
      });

      const { data, error } = await supabase
        .from("projects")
        .update({
          custom_domain: domain,
          domain_status: "pending",
          ssl_status: "waiting",
          domain_checked_at: new Date().toISOString()
        })
        .eq("id", projectId)
        .eq("user_id", user.id)
        .select("*")
        .single();
      if (error) throw error;

      return ok(res, {
        project: data,
        dns: {
          apex: { type: "A", host: "@", value: EXPECTED_A },
          www: { type: "CNAME", host: "www", value: EXPECTED_CNAME }
        }
      });
    }

    if (name === "verify") {
      method(req, ["POST"]);
      const projectId = text(body.project_id, 80);
      const project = await requireProjectOwner(projectId, user.id);
      if (!project.custom_domain) return fail(res, 400, "No domain connected");

      const domain = project.custom_domain;
      let verified = false;
      let aRecords = [];
      let cnameRecords = [];

      try { aRecords = await dns.resolve4(domain); } catch {}
      try { cnameRecords = await dns.resolveCname(`www.${domain}`); } catch {}

      verified =
        aRecords.includes(EXPECTED_A) ||
        cnameRecords.some((value) =>
          value === EXPECTED_CNAME ||
          value.endsWith(".vercel-dns.com")
        );

      const update = {
        domain_status: verified ? "verified" : "pending",
        ssl_status: verified ? "provisioning" : "waiting",
        domain_checked_at: new Date().toISOString(),
        domain_verified_at: verified ? new Date().toISOString() : null
      };

      const { data, error } = await supabase
        .from("projects")
        .update(update)
        .eq("id", projectId)
        .eq("user_id", user.id)
        .select("*")
        .single();
      if (error) throw error;

      return ok(res, { project: data, verified, a_records: aRecords, cname_records: cnameRecords });
    }

    if (name === "remove") {
      method(req, ["POST"]);
      const projectId = text(body.project_id, 80);
      const project = await requireProjectOwner(projectId, user.id);

      if (project.custom_domain && process.env.VERCEL_TOKEN && process.env.VERCEL_PROJECT_ID) {
        await vercelRequest(
          `/v9/projects/${encodeURIComponent(process.env.VERCEL_PROJECT_ID)}/domains/${encodeURIComponent(project.custom_domain)}`,
          { method: "DELETE" }
        );
      }

      const { error } = await supabase
        .from("projects")
        .update({
          custom_domain: null,
          domain_status: "not_connected",
          ssl_status: "waiting",
          domain_verified_at: null
        })
        .eq("id", projectId)
        .eq("user_id", user.id);
      if (error) throw error;
      return ok(res, { removed: true });
    }

    return fail(res, 404, "Unknown domains action");
  } catch (error) {
    return handleError(res, error);
  }
};