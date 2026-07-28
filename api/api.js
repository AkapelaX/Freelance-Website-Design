"use strict";

import fs from "fs";
import path from "path";
import { randomUUID } from "node:crypto";
import {
  admin,
  stripe,
  text,
  isObject,
  httpError,
  assertServerConfig,
  authenticatedUser,
  sendJson,
  sendError
} from "../lib/server.js";

const PROJECT_FIELDS = [
  "id",
  "user_id",
  "name",
  "slug",
  "plan",
  "project_data",
  "published",
  "published_url",
  "custom_domain",
  "domain_status",
  "ssl_status",
  "verified_at",
  "dns_verified",
  "domain_last_checked_at",
  "domain_error",
  "dns_records",
  "verification_record",
  "website_bought_out",
  "buyout_plan",
  "buyout_completed_at",
  "created_at",
  "updated_at"
].join(",");

const VALID_PLANS = new Set(["starter", "professional", "advanced"]);
const DOMAIN_STATES = new Set(["not_connected", "verifying", "connected", "failed", "removing"]);
const SSL_STATES = new Set(["waiting", "provisioning", "active", "failed"]);
const PRICE_ENVIRONMENTS = {
  starter: {
    annual: "STRIPE_PRICE_STARTER_ANNUAL",
    buyout: "STRIPE_PRICE_STARTER_BUYOUT"
  },
  professional: {
    annual: "STRIPE_PRICE_PROFESSIONAL_ANNUAL",
    buyout: "STRIPE_PRICE_PROFESSIONAL_BUYOUT"
  },
  advanced: {
    annual: "STRIPE_PRICE_ADVANCED_ANNUAL",
    buyout: "STRIPE_PRICE_ADVANCED_BUYOUT"
  }
};

function requestAction(req) {
  return text(req.query?.action || req.body?.action || "health").toLowerCase();
}

function projectIdFrom(req) {
  return text(
    req.query?.project_id ||
    req.query?.projectId ||
    req.query?.websiteId ||
    req.body?.project_id ||
    req.body?.projectId ||
    req.body?.websiteId
  );
}

function cleanSlug(value) {
  return (
    text(value)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || ""
  );
}

function normalizeDomain(value) {
  return text(value)
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "")
    .replace(/:\d+$/, "")
    .replace(/^www\./, "")
    .replace(/\.$/, "");
}

function validDomain(domain) {
  return /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i.test(domain || "");
}

function normalizedPlan(value, fallback = "starter") {
  const plan = text(value || fallback).toLowerCase();
  return VALID_PLANS.has(plan) ? plan : fallback;
}

function cloneJson(value, fallback = {}) {
  if (!isObject(value)) return fallback;
  return JSON.parse(JSON.stringify(value));
}

function requestOrigin(req) {
  const proto = text(req.headers["x-forwarded-proto"]).split(",")[0] ||
    (process.env.NODE_ENV === "development" ? "http" : "https");
  const host = text(req.headers["x-forwarded-host"]).split(",")[0] || text(req.headers.host) || "bluvixa.com";
  return `${proto}://${host}`;
}

function safeReturnUrl(value, origin, fallbackPath) {
  try {
    const url = new URL(text(value) || fallbackPath, origin);
    return url.origin === origin ? url.toString() : `${origin}${fallbackPath}`;
  } catch {
    return `${origin}${fallbackPath}`;
  }
}

async function getOwnedProject(projectId, userId) {
  if (!projectId) throw httpError("project_id is required.", 400);
  const { data, error } = await admin
    .from("projects")
    .select(PROJECT_FIELDS)
    .eq("id", projectId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw httpError("Website project not found.", 404);
  return data;
}

async function listOwnedProjects(userId) {
  const { data, error } = await admin
    .from("projects")
    .select(PROJECT_FIELDS)
    .eq("user_id", userId)
    .order("updated_at", { ascending: false });
  if (error) throw error;
  return (Array.isArray(data) ? data : []).filter(project => {
    return project?.project_data?.__bluvixa_record_type !== "snapshot";
  });
}

async function slugTaken(slug, excludeId = "") {
  if (!slug) return false;
  let query = admin.from("projects").select("id").ilike("slug", slug).limit(1);
  if (excludeId) query = query.neq("id", excludeId);
  const { data, error } = await query;
  if (error) throw error;
  return Array.isArray(data) && data.length > 0;
}

async function domainTaken(domain, excludeId = "") {
  if (!domain) return false;
  let query = admin.from("projects").select("id").ilike("custom_domain", domain).limit(1);
  if (excludeId) query = query.neq("id", excludeId);
  const { data, error } = await query;
  if (error) throw error;
  return Array.isArray(data) && data.length > 0;
}

async function uniqueSlug(base, projectId) {
  const cleanBase = cleanSlug(base) || "website";
  if (!await slugTaken(cleanBase, projectId)) return cleanBase;
  const suffix = String(projectId || randomUUID()).replace(/-/g, "").slice(-8);
  const candidate = `${cleanBase.slice(0, Math.max(1, 39 - suffix.length))}-${suffix}`;
  if (!await slugTaken(candidate, projectId)) return candidate;
  throw httpError("A unique website address could not be created.", 409);
}

function protectedProjectData(incoming, existing, userId, projectId, now) {
  const next = cloneJson(incoming, {});
  const existingData = cloneJson(existing?.project_data, {});
  const existingBackend = cloneJson(existingData.backend, {});
  const nextBackend = cloneJson(next.backend, {});
  const existingProject = cloneJson(existingData.project, {});
  const nextProject = cloneJson(next.project, {});

  next.project = {
    ...nextProject,
    slug: existing?.slug || nextProject.slug || "",
    customDomain: existing?.custom_domain || existingProject.customDomain || "",
    domainStatus: existing?.domain_status || existingProject.domainStatus || "not_connected",
    sslStatus: existing?.ssl_status || existingProject.sslStatus || "waiting",
    dnsVerified: existing?.dns_verified === true,
    dnsRecords: Array.isArray(existing?.dns_records) ? existing.dns_records : [],
    verificationRecord: existing?.verification_record || null
  };

  next.backend = {
    ...nextBackend,
    userId,
    websiteId: projectId,
    published: existing?.published === true,
    publishedUrl: existing?.published_url || null,
    websiteBoughtOut: existing?.website_bought_out === true,
    buyoutPlan: existing?.buyout_plan || null,
    buyoutCompletedAt: existing?.buyout_completed_at || null,
    createdAt: existingBackend.createdAt || existing?.created_at || now,
    updatedAt: now
  };

  return next;
}

async function updateOwnedProject(projectId, userId, patch) {
  const { data, error } = await admin
    .from("projects")
    .update(patch)
    .eq("id", projectId)
    .eq("user_id", userId)
    .select(PROJECT_FIELDS)
    .single();
  if (error) throw error;
  return data;
}

async function handleConfig(req, res) {
  if (req.method !== "GET") return sendJson(res, 405, { error: "Method not allowed." });
  return sendJson(res, 200, {
    supabaseUrl: process.env.SUPABASE_URL || "",
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY || ""
  });
}

async function handleAccount(req, res) {
  if (req.method !== "GET") return sendJson(res, 405, { error: "Method not allowed." });
  const user = await authenticatedUser(req);
  const { data: profile, error } = await admin
    .from("profiles")
    .select("plan,subscription_status,stripe_customer_id,website_bought_out,buyout_plan,buyout_completed_at,created_at,updated_at")
    .eq("id", user.id)
    .maybeSingle();
  if (error) throw error;
  const subscriptionStatus = text(profile?.subscription_status || "inactive").toLowerCase();
  return sendJson(res, 200, {
    signedIn: true,
    user: { id: user.id, email: user.email || null },
    plan: profile?.plan || null,
    subscriptionStatus,
    subscribed: subscriptionStatus === "active" || subscriptionStatus === "trialing",
    stripeCustomerId: profile?.stripe_customer_id || null,
    websiteBoughtOut: profile?.website_bought_out === true,
    buyoutPlan: profile?.buyout_plan || null,
    buyoutCompletedAt: profile?.buyout_completed_at || null,
    createdAt: profile?.created_at || null,
    updatedAt: profile?.updated_at || null
  });
}

async function handleProjects(req, res) {
  const user = await authenticatedUser(req);
  const projectId = projectIdFrom(req);

  if (req.method === "GET") {
    if (projectId) return sendJson(res, 200, { ok: true, project: await getOwnedProject(projectId, user.id) });
    return sendJson(res, 200, { ok: true, projects: await listOwnedProjects(user.id) });
  }

  if (req.method !== "POST" && req.method !== "PUT" && req.method !== "PATCH") {
    return sendJson(res, 405, { error: "Method not allowed." });
  }

  const incoming = cloneJson(req.body?.projectData || req.body?.project_data || req.body?.project || {}, {});
  const name = text(req.body?.name || incoming?.business?.name || "Untitled Website") || "Untitled Website";
  const plan = normalizedPlan(req.body?.plan || incoming.plan || "starter");
  const requestedSlug = cleanSlug(req.body?.slug || incoming?.project?.slug || name);
  const now = new Date().toISOString();

  if (projectId) {
    const existing = await getOwnedProject(projectId, user.id);
    const slug = existing.slug || await uniqueSlug(requestedSlug, projectId);
    const projectData = protectedProjectData(incoming, existing, user.id, projectId, now);
    const project = await updateOwnedProject(projectId, user.id, {
      name,
      plan,
      slug,
      project_data: projectData,
      updated_at: now
    });
    return sendJson(res, 200, { ok: true, project });
  }

  const provisionalId = randomUUID();
  const slug = await uniqueSlug(requestedSlug, provisionalId);
  const projectData = protectedProjectData(incoming, null, user.id, provisionalId, now);
  const { data, error } = await admin
    .from("projects")
    .insert({
      id: provisionalId,
      user_id: user.id,
      name,
      slug,
      plan,
      project_data: projectData,
      published: false,
      published_url: null,
      custom_domain: null,
      domain_status: "not_connected",
      ssl_status: "waiting",
      dns_verified: false,
      dns_records: [],
      created_at: now,
      updated_at: now
    })
    .select(PROJECT_FIELDS)
    .single();
  if (error) throw error;
  return sendJson(res, 201, { ok: true, project: data });
}

async function handleDeleteProject(req, res) {
  if (req.method !== "POST" && req.method !== "DELETE") return sendJson(res, 405, { error: "Method not allowed." });
  const user = await authenticatedUser(req);
  const projectId = projectIdFrom(req);
  await getOwnedProject(projectId, user.id);
  const { error } = await admin.from("projects").delete().eq("id", projectId).eq("user_id", user.id);
  if (error) throw error;
  return sendJson(res, 200, { ok: true, deleted: true, projectId });
}

function parsePublish(value) {
  if ([true, 1, "1", "true", "publish", "published"].includes(value)) return true;
  if ([false, 0, "0", "false", "unpublish", "draft"].includes(value)) return false;
  return null;
}

async function handlePublish(req, res) {
  if (req.method !== "POST") return sendJson(res, 405, { error: "Method not allowed." });
  const user = await authenticatedUser(req);
  const projectId = projectIdFrom(req);
  const project = await getOwnedProject(projectId, user.id);
  const shouldPublish = parsePublish(req.body?.publish ?? req.body?.published);
  if (shouldPublish === null) throw httpError("A publish or unpublish value is required.", 400);

  const now = new Date().toISOString();
  const origin = requestOrigin(req);
  const slug = await uniqueSlug(req.body?.requestedSlug || req.body?.requested_slug || project.slug || project.name, project.id);
  const publishedUrl = shouldPublish ? `${origin}/site/${encodeURIComponent(slug)}` : null;
  const source = cloneJson(project.project_data, {});
  source.backend = {
    ...cloneJson(source.backend, {}),
    userId: user.id,
    websiteId: project.id,
    published: shouldPublish,
    publishedUrl,
    updatedAt: now
  };
  source.project = {
    ...cloneJson(source.project, {}),
    slug,
    customDomain: project.custom_domain || "",
    domainStatus: project.domain_status || "not_connected",
    sslStatus: project.ssl_status || "waiting",
    dnsVerified: project.dns_verified === true
  };

  const saved = await updateOwnedProject(project.id, user.id, {
    slug,
    project_data: source,
    published: shouldPublish,
    published_url: publishedUrl,
    updated_at: now
  });

  return sendJson(res, 200, {
    ok: true,
    published: saved.published === true,
    slug: saved.slug,
    url: saved.custom_domain && saved.domain_status === "connected"
      ? `https://${saved.custom_domain}`
      : saved.published_url,
    project: saved
  });
}

function firstImage(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
    if (isObject(value)) {
      const candidate = text(value.url || value.src || value.publicUrl || value.public_url || value.imageUrl || value.image_url);
      if (candidate) return candidate;
    }
  }
  return "";
}

function normalizeProjectState(projectData) {
  const source = cloneJson(projectData, {});
  const business = cloneJson(source.business, {});
  const header = cloneJson(source.header, {});
  const design = cloneJson(source.design, {});
  const sections = cloneJson(source.sections, {});
  const about = cloneJson(sections.about, {});
  const featured = cloneJson(sections.featured, {});
  const gallery = cloneJson(sections.gallery, {});
  const map = cloneJson(sections.map, {});
  const contact = cloneJson(sections.contact, {});

  header.image = firstImage(
    header.image, header.cover, header.coverImage, header.cover_image, header.background,
    source.headerImage, source.header_image, source.heroImage, source.hero_image,
    design.headerImage, design.header_image, design.heroImage, design.hero_image
  );
  design.logo = firstImage(design.logo, design.logoImage, design.logo_image, source.logo, business.logo);
  design.aboutCover = firstImage(design.aboutCover, design.aboutCoverImage, source.aboutCover, about.cover, about.background);
  design.featuredCover = firstImage(design.featuredCover, design.featuredCoverImage, source.featuredCover, featured.cover, featured.background);
  design.galleryCover = firstImage(design.galleryCover, design.galleryCoverImage, source.galleryCover, gallery.cover, gallery.background);
  design.mapCover = firstImage(design.mapCover, design.mapCoverImage, source.mapCover, map.cover, map.background, contact.cover, contact.background);

  return {
    ...source,
    business,
    header,
    design,
    mapUrl: text(source.mapUrl || source.map_url || design.mapUrl || design.map_url || map.url || map.mapUrl || contact.mapUrl),
    photos: Array.isArray(source.photos) ? source.photos : Array.isArray(featured.items) ? featured.items : Array.isArray(featured.photos) ? featured.photos : [],
    gallery: Array.isArray(source.gallery) ? source.gallery : Array.isArray(gallery.items) ? gallery.items : Array.isArray(gallery.photos) ? gallery.photos : []
  };
}

async function handlePublicSite(req, res) {
  if (req.method !== "GET") return sendJson(res, 405, { error: "Method not allowed." });
  assertServerConfig();
  const slug = cleanSlug(req.query?.slug);
  const host = normalizeDomain(req.query?.host);
  if (!slug && !host) throw httpError("A website slug or domain is required.", 400);

  let query = admin.from("projects").select(PROJECT_FIELDS).eq("published", true).limit(1);
  query = host ? query.ilike("custom_domain", host) : query.ilike("slug", slug);
  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  if (!data) throw httpError("This website is not published.", 404);

  const state = normalizeProjectState(data.project_data);
  state.plan = data.plan || state.plan || "starter";
  state.project = {
    ...cloneJson(state.project, {}),
    slug: data.slug || "",
    customDomain: data.custom_domain || "",
    domainStatus: data.domain_status || "not_connected",
    sslStatus: data.ssl_status || "waiting",
    dnsVerified: data.dns_verified === true
  };
  state.backend = {
    ...cloneJson(state.backend, {}),
    userId: data.user_id,
    websiteId: data.id,
    published: true,
    publishedUrl: data.published_url || null,
    updatedAt: data.updated_at || null
  };

  return sendJson(res, 200, {
    website: {
      id: data.id,
      name: data.name || "Untitled Website",
      slug: data.slug || "",
      plan: data.plan || "starter",
      published: true,
      publishedUrl: data.published_url || null,
      customDomain: data.custom_domain || null,
      domainStatus: data.domain_status || "not_connected",
      sslStatus: data.ssl_status || "waiting",
      dnsVerified: data.dns_verified === true,
      updatedAt: data.updated_at || null,
      state
    }
  }, "public, max-age=30, s-maxage=60, stale-while-revalidate=300");
}

function teamQuery() {
  const teamId = text(process.env.VERCEL_TEAM_ID);
  return teamId ? `?teamId=${encodeURIComponent(teamId)}` : "";
}

function vercelProjectId() {
  const value = text(process.env.VERCEL_PROJECT_ID);
  if (!value) throw httpError("VERCEL_PROJECT_ID is not configured.", 500);
  return value;
}

async function vercelRequest(urlPath, options = {}) {
  const token = text(process.env.VERCEL_TOKEN);
  if (!token) throw httpError("VERCEL_TOKEN is not configured.", 500);
  const response = await fetch(`https://api.vercel.com${urlPath}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw httpError(payload?.error?.message || payload?.message || `Vercel request failed (${response.status}).`, response.status, payload);
  return payload;
}

function domainsPath(domain = "") {
  return `/v10/projects/${encodeURIComponent(vercelProjectId())}/domains${domain ? `/${encodeURIComponent(domain)}` : ""}${teamQuery()}`;
}

async function addDomainToVercel(domain) {
  try {
    return await vercelRequest(domainsPath(), { method: "POST", body: JSON.stringify({ name: domain }) });
  } catch (error) {
    if (error.status === 409) return vercelRequest(domainsPath(domain), { method: "GET" });
    throw error;
  }
}

async function removeDomainFromVercel(domain) {
  return vercelRequest(domainsPath(domain), { method: "DELETE" });
}

async function verifyVercelDomain(domain) {
  return vercelRequest(`/v9/projects/${encodeURIComponent(vercelProjectId())}/domains/${encodeURIComponent(domain)}/verify${teamQuery()}`, { method: "POST", body: "{}" });
}

function dnsRecordsFor(domain, data = {}) {
  const apex = domain.split(".").length === 2;
  const records = apex
    ? [
        { type: "A", name: "@", value: "76.76.21.21" },
        { type: "CNAME", name: "www", value: "cname.vercel-dns.com" }
      ]
    : [{ type: "CNAME", name: domain.split(".")[0], value: "cname.vercel-dns.com" }];
  const verification = Array.isArray(data.verification) ? data.verification[0] : null;
  return {
    records,
    verification_record: verification
      ? { type: verification.type || "TXT", name: verification.domain || verification.name || `_vercel.${domain}`, value: verification.value || "" }
      : null
  };
}

function statusFromVercel(data = {}) {
  const verified = data.verified === true || (Array.isArray(data.verification) && data.verification.length === 0) || data.misconfigured === false;
  const connected = verified && data.misconfigured !== true;
  return {
    domain_status: connected ? "connected" : "verifying",
    dns_verified: connected,
    ssl_status: connected ? "active" : "provisioning"
  };
}

async function handleDomain(req, res) {
  const user = await authenticatedUser(req);
  const domainAction = text(req.query?.domain_action || req.body?.domain_action || req.body?.domainAction || "status").toLowerCase();
  const projectId = projectIdFrom(req);

  if (domainAction === "status" && req.method === "GET") {
    if (projectId) return sendJson(res, 200, { ok: true, domain: await getOwnedProject(projectId, user.id) });
    return sendJson(res, 200, { ok: true, projects: await listOwnedProjects(user.id) });
  }

  if (domainAction === "check-slug" && req.method === "POST") {
    const project = await getOwnedProject(projectId, user.id);
    const slug = cleanSlug(req.body?.slug);
    if (slug.length < 3) throw httpError("Use at least 3 letters or numbers.", 400);
    const taken = await slugTaken(slug, project.id);
    return sendJson(res, 200, { ok: true, available: !taken, slug, url: `${requestOrigin(req)}/site/${slug}` });
  }

  if (domainAction === "reserve-slug" && req.method === "POST") {
    const project = await getOwnedProject(projectId, user.id);
    const slug = cleanSlug(req.body?.slug);
    if (slug.length < 3) throw httpError("Use at least 3 letters or numbers.", 400);
    if (await slugTaken(slug, project.id)) throw httpError("That Bluvixa address is already reserved.", 409);
    const saved = await updateOwnedProject(project.id, user.id, { slug, updated_at: new Date().toISOString() });
    return sendJson(res, 200, { ok: true, message: "Bluvixa address reserved.", domain: saved, url: `${requestOrigin(req)}/site/${slug}` });
  }

  if (domainAction === "connect" && req.method === "POST") {
    const project = await getOwnedProject(projectId, user.id);
    const domain = normalizeDomain(req.body?.domain);
    if (!validDomain(domain)) throw httpError("Enter a valid domain.", 400);
    if (project.custom_domain && normalizeDomain(project.custom_domain) !== domain) throw httpError("Remove the current custom domain first.", 409);
    if (await domainTaken(domain, project.id)) throw httpError("That domain is already connected to another website.", 409);
    const vercelDomain = await addDomainToVercel(domain);
    const dns = dnsRecordsFor(domain, vercelDomain);
    const now = new Date().toISOString();
    const saved = await updateOwnedProject(project.id, user.id, {
      custom_domain: domain,
      domain_status: "verifying",
      ssl_status: "provisioning",
      dns_verified: false,
      verified_at: null,
      domain_last_checked_at: now,
      domain_error: null,
      dns_records: dns.records,
      verification_record: dns.verification_record,
      updated_at: now
    });
    return sendJson(res, 200, { ok: true, message: "Domain added. Configure DNS, then verify.", verified: false, domain: saved });
  }

  if ((domainAction === "check" || domainAction === "verify") && req.method === "POST") {
    const project = await getOwnedProject(projectId, user.id);
    if (!project.custom_domain) throw httpError("This website has no custom domain.", 400);
    let vercelDomain;
    try {
      vercelDomain = await verifyVercelDomain(project.custom_domain);
    } catch {
      vercelDomain = await vercelRequest(domainsPath(project.custom_domain), { method: "GET" });
    }
    const state = statusFromVercel(vercelDomain);
    const dns = dnsRecordsFor(project.custom_domain, vercelDomain);
    const now = new Date().toISOString();
    const saved = await updateOwnedProject(project.id, user.id, {
      ...state,
      verified_at: state.domain_status === "connected" ? (project.verified_at || now) : null,
      domain_last_checked_at: now,
      domain_error: state.domain_status === "connected" ? null : "DNS is not verified yet.",
      dns_records: dns.records,
      verification_record: dns.verification_record,
      updated_at: now
    });
    return sendJson(res, 200, {
      ok: true,
      verified: saved.dns_verified === true,
      message: saved.domain_status === "connected" ? "Domain verified and HTTPS is active." : "Still waiting for valid DNS records.",
      domain: saved
    });
  }

  if (domainAction === "remove" && (req.method === "POST" || req.method === "DELETE")) {
    const project = await getOwnedProject(projectId, user.id);
    if (project.custom_domain) {
      try { await removeDomainFromVercel(project.custom_domain); }
      catch (error) { if (error.status !== 404) throw error; }
    }
    const now = new Date().toISOString();
    const saved = await updateOwnedProject(project.id, user.id, {
      custom_domain: null,
      domain_status: "not_connected",
      ssl_status: "waiting",
      dns_verified: false,
      verified_at: null,
      domain_last_checked_at: now,
      domain_error: null,
      dns_records: [],
      verification_record: null,
      updated_at: now
    });
    return sendJson(res, 200, { ok: true, domain: saved });
  }

  return sendJson(res, 405, { error: "Method or domain action not allowed." });
}

async function handleDomainSearch(req, res) {
  if (req.method !== "POST") return sendJson(res, 405, { error: "Method not allowed." });
  const term = cleanSlug(req.body?.query || "website").replace(/-/g, "");
  const extension = /^\.[a-z]{2,15}$/i.test(text(req.body?.extension)) ? text(req.body.extension).toLowerCase() : ".com";
  const year = new Date().getFullYear();
  const results = [
    `${term}${extension}`,
    `${term}online${extension}`,
    `get${term}${extension}`,
    `${term}${year}${extension}`,
    `${term}hq${extension}`,
    `my${term}${extension}`
  ].filter((value, index, array) => value && array.indexOf(value) === index)
    .map(domain => ({ domain, available: null, price: null }));
  return sendJson(res, 200, { ok: true, results, live: false });
}

async function getOrCreateStripeCustomer(user) {
  const { data: profile, error } = await admin
    .from("profiles")
    .select("id,email,stripe_customer_id")
    .eq("id", user.id)
    .maybeSingle();
  if (error) throw error;
  if (profile?.stripe_customer_id) return profile.stripe_customer_id;

  const customer = await stripe.customers.create({
    email: user.email || profile?.email || undefined,
    metadata: { user_id: user.id }
  });
  const { error: saveError } = await admin.from("profiles").upsert({
    id: user.id,
    email: user.email || profile?.email || null,
    stripe_customer_id: customer.id
  }, { onConflict: "id" });
  if (saveError) throw saveError;
  return customer.id;
}

async function handleCheckout(req, res) {
  if (req.method !== "POST") return sendJson(res, 405, { error: "Method not allowed." });
  assertServerConfig({ needsStripe: true });
  const user = await authenticatedUser(req);
  const plan = normalizedPlan(req.body?.plan || "starter");
  const purchaseType = text(req.body?.purchaseType || "annual").toLowerCase();
  if (!PRICE_ENVIRONMENTS[plan] || !["annual", "buyout"].includes(purchaseType)) throw httpError("Invalid plan or purchase type.", 400);
  const priceId = text(process.env[PRICE_ENVIRONMENTS[plan][purchaseType]]);
  if (!priceId) throw httpError(`Stripe price is not configured for the ${plan} ${purchaseType} option.`, 500);

  let project = null;
  if (purchaseType === "buyout") project = await getOwnedProject(projectIdFrom(req), user.id);
  const customer = await getOrCreateStripeCustomer(user);
  const origin = requestOrigin(req);
  const successUrl = safeReturnUrl(req.body?.successUrl, origin, "/#projects?checkout=success");
  const cancelUrl = safeReturnUrl(req.body?.cancelUrl, origin, "/#billing?checkout=cancelled");
  const metadata = {
    user_id: user.id,
    plan,
    purchase_type: purchaseType,
    ...(project ? { project_id: project.id, website_id: project.id } : {})
  };

  const session = await stripe.checkout.sessions.create({
    customer,
    mode: purchaseType === "buyout" ? "payment" : "subscription",
    line_items: [{ price: priceId, quantity: 1 }],
    metadata,
    client_reference_id: user.id,
    success_url: successUrl,
    cancel_url: cancelUrl,
    allow_promotion_codes: purchaseType === "annual",
    subscription_data: purchaseType === "annual"
      ? { metadata, trial_period_days: 7 }
      : undefined,
    payment_intent_data: purchaseType === "buyout" ? { metadata } : undefined
  });

  if (!session.url) throw httpError("Stripe did not return a checkout URL.", 500);
  return sendJson(res, 200, { url: session.url, sessionId: session.id });
}

async function handlePortal(req, res) {
  if (req.method !== "POST") return sendJson(res, 405, { error: "Method not allowed." });
  assertServerConfig({ needsStripe: true });
  const user = await authenticatedUser(req);
  const { data, error } = await admin.from("profiles").select("stripe_customer_id").eq("id", user.id).maybeSingle();
  if (error) throw error;
  if (!data?.stripe_customer_id) throw httpError("No Stripe billing account is connected yet.", 400);
  const origin = requestOrigin(req);
  const session = await stripe.billingPortal.sessions.create({
    customer: data.stripe_customer_id,
    return_url: safeReturnUrl(req.body?.returnUrl, origin, "/#billing")
  });
  return sendJson(res, 200, { url: session.url });
}

function safeFileName(value) {
  return text(value || "bluvixa-website")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "bluvixa-website";
}

function readPublicSiteHtml() {
  const candidates = [
    path.join(process.cwd(), "public-site.html"),
    path.join(process.cwd(), "public", "public-site.html")
  ];
  for (const candidate of candidates) {
    try { return fs.readFileSync(candidate, "utf8"); } catch {}
  }
  throw httpError("public-site.html could not be found for export.", 500);
}

function prepareStaticHtml(sourceHtml) {
  let html = String(sourceHtml || "");
  const dataScript = '<script src="site-data.js"></script>';
  if (!html.includes(dataScript)) html = /<\/head>/i.test(html) ? html.replace(/<\/head>/i, `  ${dataScript}\n</head>`) : `${dataScript}\n${html}`;
  const startMarker = /async function start\(\)\s*\{\s*showLoading\(\);/;
  if (!startMarker.test(html)) throw httpError("The public-site renderer could not be prepared for static export.", 500);
  return html.replace(startMarker, `async function start(){\n    showLoading();\n    if (window.__BLUVIXA_SITE__) {\n      applyWebsite(window.__BLUVIXA_SITE__);\n      return;\n    }`);
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(date = new Date()) {
  const year = Math.max(1980, date.getFullYear());
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    day: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()
  };
}

function buildZip(files) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  const stamp = dosDateTime();

  for (const file of files) {
    const name = Buffer.from(file.name.replace(/\\/g, "/"), "utf8");
    const data = Buffer.isBuffer(file.data) ? file.data : Buffer.from(String(file.data), "utf8");
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(stamp.time, 10);
    local.writeUInt16LE(stamp.day, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    localParts.push(local, name, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(stamp.time, 12);
    central.writeUInt16LE(stamp.day, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, name);
    offset += local.length + name.length + data.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...localParts, centralDirectory, end]);
}

async function handleExport(req, res) {
  if (req.method !== "GET") return sendJson(res, 405, { error: "Method not allowed." });
  const user = await authenticatedUser(req);
  const project = await getOwnedProject(projectIdFrom(req), user.id);
  if (!project.website_bought_out) throw httpError("Website export unlocks after this website's buyout is completed.", 403);

  const state = normalizeProjectState(project.project_data);
  const website = {
    id: project.id,
    name: project.name,
    slug: project.slug,
    plan: project.plan,
    published: project.published,
    publishedUrl: project.published_url,
    customDomain: project.custom_domain,
    domainStatus: project.domain_status,
    state
  };
  const html = prepareStaticHtml(readPublicSiteHtml());
  const dataJs = `window.__BLUVIXA_SITE__ = ${JSON.stringify(website, null, 2)};\n`;
  const readme = [
    "BLUVIXA WEBSITE EXPORT",
    "",
    `Website: ${project.name || "Untitled Website"}`,
    `Exported: ${new Date().toISOString()}`,
    "",
    "Upload every file in this ZIP to the same directory on any static web host.",
    "Open index.html locally to preview the exported website.",
    "The website no longer requires the Bluvixa API."
  ].join("\n");
  const zip = buildZip([
    { name: "index.html", data: html },
    { name: "site-data.js", data: dataJs },
    { name: "site-data.json", data: JSON.stringify(website, null, 2) },
    { name: "README.txt", data: readme }
  ]);

  res.status(200);
  res.setHeader("Content-Type", "application/zip");
  res.setHeader("Content-Disposition", `attachment; filename="${safeFileName(project.name)}.zip"`);
  res.setHeader("Content-Length", String(zip.length));
  res.setHeader("Cache-Control", "private, no-store");
  return res.end(zip);
}

export default async function handler(req, res) {
  try {
    const action = requestAction(req);
    if (action === "health") return sendJson(res, 200, { ok: true, service: "bluvixa-master-api" });
    if (action === "config") return await handleConfig(req, res);
    if (action === "account" || action === "account-status") return await handleAccount(req, res);
    if (action === "projects" || action === "project") return await handleProjects(req, res);
    if (action === "delete-project") return await handleDeleteProject(req, res);
    if (action === "publish" || action === "publish-site") return await handlePublish(req, res);
    if (action === "public-site") return await handlePublicSite(req, res);
    if (action === "domain") return await handleDomain(req, res);
    if (action === "domain-search") return await handleDomainSearch(req, res);
    if (action === "checkout" || action === "create-checkout-session") return await handleCheckout(req, res);
    if (action === "portal" || action === "create-portal-session") return await handlePortal(req, res);
    if (action === "export" || action === "export-website") return await handleExport(req, res);
    return sendJson(res, 404, { error: "Unknown API action." });
  } catch (error) {
    return sendError(res, error);
  }
}
