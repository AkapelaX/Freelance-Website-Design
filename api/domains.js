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

function requireVercelConfig() {
  if (!process.env.VERCEL_TOKEN) {
    const error = new Error("VERCEL_TOKEN is not configured");
    error.status = 500;
    throw error;
  }

  if (!process.env.VERCEL_PROJECT_ID) {
    const error = new Error("VERCEL_PROJECT_ID is not configured");
    error.status = 500;
    throw error;
  }
}

function withTeam(path) {
  if (!process.env.VERCEL_TEAM_ID) return path;
  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}teamId=${encodeURIComponent(process.env.VERCEL_TEAM_ID)}`;
}

async function vercelRequest(path, options = {}, allowedStatuses = []) {
  requireVercelConfig();

  const response = await fetch(`https://api.vercel.com${withTeam(path)}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${process.env.VERCEL_TOKEN}`,
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });

  const payload = await response.json().catch(() => ({}));

  if (!response.ok && !allowedStatuses.includes(response.status)) {
    const error = new Error(
      payload.error?.message ||
      payload.message ||
      "Vercel domain request failed"
    );
    error.status = response.status;
    error.payload = payload;
    throw error;
  }

  return payload;
}

async function addProjectDomain(domain) {
  return vercelRequest(
    `/v10/projects/${encodeURIComponent(process.env.VERCEL_PROJECT_ID)}/domains`,
    {
      method: "POST",
      body: JSON.stringify({ name: domain })
    },
    [409]
  );
}

async function removeProjectDomain(domain) {
  return vercelRequest(
    `/v9/projects/${encodeURIComponent(process.env.VERCEL_PROJECT_ID)}/domains/${encodeURIComponent(domain)}`,
    { method: "DELETE" },
    [404]
  );
}

function firstDnsValue(value) {
  if (typeof value === "string" && value.trim()) return value.trim().replace(/\.$/, "");
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = firstDnsValue(item);
      if (found) return found;
    }
  }
  if (value && typeof value === "object") {
    for (const key of ["value", "recommendedValue", "recommended", "target"]) {
      const found = firstDnsValue(value[key]);
      if (found) return found;
    }
  }
  return "";
}

function findConfigValue(payload, preferredKeys = []) {
  if (!payload || typeof payload !== "object") return "";

  for (const key of preferredKeys) {
    const found = firstDnsValue(payload[key]);
    if (found) return found;
  }

  for (const [key, value] of Object.entries(payload)) {
    const normalizedKey = key.toLowerCase();
    if (
      preferredKeys.some((preferred) =>
        normalizedKey.includes(preferred.toLowerCase())
      )
    ) {
      const found = firstDnsValue(value);
      if (found) return found;
    }
  }

  for (const value of Object.values(payload)) {
    if (value && typeof value === "object") {
      const found = findConfigValue(value, preferredKeys);
      if (found) return found;
    }
  }

  return "";
}

function verificationRecordFrom(...payloads) {
  for (const payload of payloads) {
    const records = Array.isArray(payload?.verification)
      ? payload.verification
      : payload?.verification
        ? [payload.verification]
        : [];

    for (const record of records) {
      const type = String(record?.type || "").toUpperCase();
      const domain = String(record?.domain || record?.name || "").trim();
      const value = String(record?.value || "").trim();

      if (type === "TXT" && domain && value) {
        return {
          type: "TXT",
          host: domain,
          value
        };
      }
    }
  }

  return null;
}

async function getExactDnsInstructions(domain, addApexResult = null, addWwwResult = null) {
  let apexConfig = {};
  let wwwConfig = {};

  try {
    apexConfig = await vercelRequest(
      `/v6/domains/${encodeURIComponent(domain)}/config`,
      { method: "GET" }
    );
  } catch {}

  try {
    wwwConfig = await vercelRequest(
      `/v6/domains/${encodeURIComponent(`www.${domain}`)}/config`,
      { method: "GET" }
    );
  } catch {}

  const exactA =
    findConfigValue(apexConfig, [
      "recommendedIPv4",
      "recommendedIp",
      "recommendedA",
      "recommendedValue"
    ]) || EXPECTED_A;

  const exactCname =
    findConfigValue(wwwConfig, [
      "recommendedCNAME",
      "recommendedCname",
      "recommendedValue"
    ]) ||
    findConfigValue(apexConfig, [
      "recommendedCNAME",
      "recommendedCname"
    ]) ||
    EXPECTED_CNAME;

  return {
    apex: {
      type: "A",
      host: "@",
      value: exactA
    },
    www: {
      type: "CNAME",
      host: "www",
      value: exactCname
    },
    verification: verificationRecordFrom(
      addApexResult,
      addWwwResult,
      apexConfig,
      wwwConfig
    ),
    vercel: {
      apex_misconfigured:
        typeof apexConfig?.misconfigured === "boolean"
          ? apexConfig.misconfigured
          : null,
      www_misconfigured:
        typeof wwwConfig?.misconfigured === "boolean"
          ? wwwConfig.misconfigured
          : null
    }
  };
}

async function nextAvailableSlug(supabase, requestedSlug, excludeProjectId = "") {
  const baseSlug = slugify(requestedSlug) || "my-website";
  let candidate = baseSlug;
  let number = 2;

  while (true) {
    let query = supabase
      .from("projects")
      .select("id")
      .eq("slug", candidate)
      .limit(1);

    if (excludeProjectId) {
      query = query.neq("id", excludeProjectId);
    }

    const { data, error } = await query;
    if (error) throw error;

    if (!data || data.length === 0) {
      return candidate;
    }

    const suffix = `-${number}`;
    candidate = `${baseSlug.slice(0, 63 - suffix.length)}${suffix}`;
    number += 1;
  }
}

async function readDns(domain) {
  let aRecords = [];
  let cnameRecords = [];

  try {
    aRecords = await dns.resolve4(domain);
  } catch {}

  try {
    cnameRecords = await dns.resolveCname(`www.${domain}`);
  } catch {}

  const apexConfigured = aRecords.includes(EXPECTED_A);
  const wwwConfigured = cnameRecords.some((value) => {
    const normalized = String(value || "").toLowerCase().replace(/\.$/, "");
    return (
      normalized === EXPECTED_CNAME.toLowerCase().replace(/\.$/, "") ||
      normalized.endsWith(".vercel-dns.com")
    );
  });

  return {
    aRecords,
    cnameRecords,
    apexConfigured,
    wwwConfigured
  };
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
      const availableSlug = await nextAvailableSlug(supabase, slug, projectId);

      return ok(res, {
        slug,
        available: availableSlug === slug,
        suggested_slug: availableSlug
      });
    }

    const user = await requireUser(req);

    if (name === "connect") {
      method(req, ["POST"]);

      const projectId = text(body.project_id, 80);
      const domain = normalizeDomain(body.domain);

      if (!projectId) return fail(res, 400, "Project ID required");
      if (!domain || !domain.includes(".")) {
        return fail(res, 400, "Valid domain required");
      }

      const project = await requireProjectOwner(projectId, user.id);
      const previousDomain = normalizeDomain(project.custom_domain);

      /*
       * The UI treats the entered value as the apex domain and displays both:
       *   example.com
       *   www.example.com
       * Both aliases must be attached to the Vercel project.
       */
      const addedApex = await addProjectDomain(domain);
      const addedWww = await addProjectDomain(`www.${domain}`);
      const dnsInstructions = await getExactDnsInstructions(
        domain,
        addedApex,
        addedWww
      );

      /*
       * When replacing a domain, remove the old aliases only after the new
       * aliases were accepted by Vercel.
       */
      if (previousDomain && previousDomain !== domain) {
        await removeProjectDomain(previousDomain);
        await removeProjectDomain(`www.${previousDomain}`);
      }

      const checkedAt = new Date().toISOString();

      const { data, error } = await supabase
        .from("projects")
        .update({
          custom_domain: domain,
          domain_status: "pending",
          ssl_status: "waiting",
          domain_checked_at: checkedAt,
          domain_verified_at: null
        })
        .eq("id", projectId)
        .eq("user_id", user.id)
        .select("*")
        .single();

      if (error) throw error;

      return ok(res, {
        project: data,
        dns: dnsInstructions
      });
    }

    if (name === "instructions") {
      method(req, ["GET"]);

      const projectId = text(req.query.project_id, 80);
      if (!projectId) return fail(res, 400, "Project ID required");

      const project = await requireProjectOwner(projectId, user.id);
      const domain = normalizeDomain(project.custom_domain);
      if (!domain) return fail(res, 400, "No domain connected");

      const dnsInstructions = await getExactDnsInstructions(domain);

      return ok(res, {
        project_id: projectId,
        domain,
        dns: dnsInstructions
      });
    }

    if (name === "verify") {
      method(req, ["POST"]);

      const projectId = text(body.project_id, 80);
      if (!projectId) return fail(res, 400, "Project ID required");

      const project = await requireProjectOwner(projectId, user.id);
      const domain = normalizeDomain(project.custom_domain);

      if (!domain) return fail(res, 400, "No domain connected");

      const dnsResult = await readDns(domain);

      /*
       * Ask Vercel to verify any ownership challenge, then inspect Vercel's
       * domain configuration. DNS remains a fallback so temporary Vercel API
       * delays do not prevent the user from seeing successful propagation.
       */
      let vercelVerified = false;
      let vercelMisconfigured = null;
      let verification = null;

      try {
        verification = await vercelRequest(
          `/v9/projects/${encodeURIComponent(process.env.VERCEL_PROJECT_ID)}/domains/${encodeURIComponent(domain)}/verify`,
          { method: "POST" },
          [400]
        );
        vercelVerified = verification?.verified === true;
      } catch {}

      try {
        const config = await vercelRequest(
          `/v6/domains/${encodeURIComponent(domain)}/config`,
          { method: "GET" }
        );
        vercelMisconfigured = config?.misconfigured === true;
        if (config?.misconfigured === false) vercelVerified = true;
      } catch {}

      const verified =
        vercelVerified ||
        (
          vercelMisconfigured !== true &&
          (dnsResult.apexConfigured || dnsResult.wwwConfigured)
        );

      const checkedAt = new Date().toISOString();

      const { data, error } = await supabase
        .from("projects")
        .update({
          domain_status: verified ? "verified" : "pending",
          ssl_status: verified ? "provisioning" : "waiting",
          domain_checked_at: checkedAt,
          domain_verified_at: verified
            ? (project.domain_verified_at || checkedAt)
            : null
        })
        .eq("id", projectId)
        .eq("user_id", user.id)
        .select("*")
        .single();

      if (error) throw error;

      return ok(res, {
        project: data,
        verified,
        vercel_verified: vercelVerified,
        vercel_misconfigured: vercelMisconfigured,
        verification,
        a_records: dnsResult.aRecords,
        cname_records: dnsResult.cnameRecords
      });
    }

    if (name === "remove") {
      method(req, ["POST"]);

      const projectId = text(body.project_id, 80);
      if (!projectId) return fail(res, 400, "Project ID required");

      const project = await requireProjectOwner(projectId, user.id);
      const domain = normalizeDomain(project.custom_domain);

      if (domain) {
        await removeProjectDomain(domain);
        await removeProjectDomain(`www.${domain}`);
      }

      const { data, error } = await supabase
        .from("projects")
        .update({
          custom_domain: null,
          domain_status: "not_connected",
          ssl_status: "waiting",
          domain_checked_at: new Date().toISOString(),
          domain_verified_at: null
        })
        .eq("id", projectId)
        .eq("user_id", user.id)
        .select("*")
        .single();

      if (error) throw error;

      return ok(res, {
        removed: true,
        project: data
      });
    }

    return fail(res, 404, "Unknown domains action");
  } catch (error) {
    return handleError(res, error);
  }
};