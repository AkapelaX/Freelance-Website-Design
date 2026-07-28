"use strict";

import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

const JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0"
};

function cleanText(value) {
  return typeof value === "string"
    ? value.trim()
    : "";
}

function env(name, required = true) {
  const value = cleanText(process.env[name]);

  if (required && !value) {
    const error = new Error(
      `Missing required environment variable: ${name}`
    );

    error.status = 500;
    throw error;
  }

  return value;
}

function firstEnvironmentValue(names, required = true) {
  for (const name of names) {
    const value = cleanText(process.env[name]);

    if (value) {
      return value;
    }
  }

  if (required) {
    const error = new Error(
      `Missing required environment variable: ${names.join(" or ")}`
    );

    error.status = 500;
    throw error;
  }

  return "";
}

const supabaseUrl = firstEnvironmentValue(
  ["SUPABASE_URL"],
  false
).replace(/\/+$/, "");

const supabaseAnonKey = firstEnvironmentValue(
  [
    "SUPABASE_ANON_KEY",
    "SUPABASE_ANON_PUBLIC_KEY",
    "NEXT_PUBLIC_SUPABASE_ANON_KEY"
  ],
  false
);

const supabaseServiceRoleKey = firstEnvironmentValue(
  [
    "SUPABASE_SERVICE_ROLE_KEY",
    "SUPABASE_SECRET_KEY"
  ],
  false
);

export const admin =
  supabaseUrl && supabaseServiceRoleKey
    ? createClient(
        supabaseUrl,
        supabaseServiceRoleKey,
        {
          auth: {
            autoRefreshToken: false,
            persistSession: false,
            detectSessionInUrl: false
          },
          global: {
            headers: {
              "X-Client-Info": "bluvixa-server"
            }
          }
        }
      )
    : null;

const stripeSecretKey = firstEnvironmentValue(
  ["STRIPE_SECRET_KEY"],
  false
);

export const stripe = stripeSecretKey
  ? new Stripe(stripeSecretKey)
  : null;

export function assertServerConfig(
  {
    needsSupabase = true,
    needsStripe = false,
    needsVercel = false
  } = {}
) {
  if (needsSupabase) {
    if (!supabaseUrl) {
      env("SUPABASE_URL");
    }

    if (!supabaseAnonKey) {
      firstEnvironmentValue([
        "SUPABASE_ANON_KEY",
        "SUPABASE_ANON_PUBLIC_KEY",
        "NEXT_PUBLIC_SUPABASE_ANON_KEY"
      ]);
    }

    if (!supabaseServiceRoleKey || !admin) {
      firstEnvironmentValue([
        "SUPABASE_SERVICE_ROLE_KEY",
        "SUPABASE_SECRET_KEY"
      ]);
    }
  }

  if (needsStripe && (!stripeSecretKey || !stripe)) {
    env("STRIPE_SECRET_KEY");
  }

  if (needsVercel) {
    env("VERCEL_TOKEN");
    env("VERCEL_PROJECT_ID");
  }

  return true;
}

export function send(
  res,
  status,
  body
) {
  res.status(status);

  Object.entries(JSON_HEADERS).forEach(
    ([key, value]) => {
      res.setHeader(key, value);
    }
  );

  return res.end(
    JSON.stringify(body)
  );
}

export function sendError(
  res,
  error,
  fallbackMessage =
    "Unexpected server error."
) {
  console.error(
    "Bluvixa API error:",
    error
  );

  const status =
    Number.isInteger(error?.status) &&
    error.status >= 400 &&
    error.status <= 599
      ? error.status
      : 500;

  return send(
    res,
    status,
    {
      ok: false,
      error:
        cleanText(error?.message) ||
        fallbackMessage
    }
  );
}

export function normalizeDomain(value) {
  return cleanText(value)
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/.*$/, "")
    .replace(/\.$/, "");
}

export function validDomain(domain) {
  return /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i.test(
    normalizeDomain(domain)
  );
}

export function cleanSlug(value) {
  return (
    cleanText(value || "website")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) ||
    "website"
  );
}

function bearerToken(req) {
  const authorization =
    cleanText(req?.headers?.authorization);

  if (
    !authorization
      .toLowerCase()
      .startsWith("bearer ")
  ) {
    return "";
  }

  return authorization
    .slice(7)
    .trim();
}

export async function requireUser(req) {
  assertServerConfig({
    needsSupabase: true
  });

  const token =
    bearerToken(req);

  if (!token) {
    const error = new Error(
      "Authentication required."
    );

    error.status = 401;
    throw error;
  }

  const response = await fetch(
    `${supabaseUrl}/auth/v1/user`,
    {
      method: "GET",
      headers: {
        apikey:
          supabaseAnonKey,
        Authorization:
          `Bearer ${token}`,
        Accept:
          "application/json"
      }
    }
  );

  const user = await response
    .json()
    .catch(() => null);

  if (
    !response.ok ||
    !user ||
    !user.id
  ) {
    const error = new Error(
      "Your session is invalid or expired."
    );

    error.status = 401;
    throw error;
  }

  return user;
}

export const authenticatedUser =
  requireUser;

export const PROJECT_SELECT = [
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

function requireAdmin() {
  assertServerConfig({
    needsSupabase: true
  });

  if (!admin) {
    const error = new Error(
      "Supabase admin client is not configured."
    );

    error.status = 500;
    throw error;
  }

  return admin;
}

export async function getOwnedProject(
  projectId,
  userId,
  select = PROJECT_SELECT
) {
  const id =
    cleanText(projectId);

  const owner =
    cleanText(userId);

  if (!id || !owner) {
    const error = new Error(
      "A website project and user are required."
    );

    error.status = 400;
    throw error;
  }

  const {
    data,
    error
  } = await requireAdmin()
    .from("projects")
    .select(select)
    .eq("id", id)
    .eq("user_id", owner)
    .maybeSingle();

  if (error) {
    throw error;
  }

  if (!data) {
    const notFound = new Error(
      "Website project not found."
    );

    notFound.status = 404;
    throw notFound;
  }

  return data;
}

export async function listOwnedProjects(
  userId,
  select = PROJECT_SELECT
) {
  const owner =
    cleanText(userId);

  if (!owner) {
    const error = new Error(
      "A user is required."
    );

    error.status = 400;
    throw error;
  }

  const {
    data,
    error
  } = await requireAdmin()
    .from("projects")
    .select(select)
    .eq("user_id", owner)
    .order(
      "updated_at",
      {
        ascending: false
      }
    );

  if (error) {
    throw error;
  }

  return Array.isArray(data)
    ? data
    : [];
}

const SERVER_CONTROLLED_PROJECT_FIELDS =
  new Set([
    "id",
    "user_id",
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
    "created_at"
  ]);

export function safeProjectPatch(
  patch,
  {
    allowServerFields = false
  } = {}
) {
  if (
    !patch ||
    typeof patch !== "object" ||
    Array.isArray(patch)
  ) {
    return {};
  }

  const output = {};

  for (
    const [key, value]
    of Object.entries(patch)
  ) {
    if (
      !allowServerFields &&
      SERVER_CONTROLLED_PROJECT_FIELDS.has(
        key
      )
    ) {
      continue;
    }

    output[key] = value;
  }

  return output;
}

export async function updateProject(
  projectId,
  userId,
  patch,
  {
    allowServerFields = true,
    select = PROJECT_SELECT
  } = {}
) {
  const id =
    cleanText(projectId);

  const owner =
    cleanText(userId);

  if (!id || !owner) {
    const error = new Error(
      "A website project and user are required."
    );

    error.status = 400;
    throw error;
  }

  const safePatch =
    safeProjectPatch(
      patch,
      {
        allowServerFields
      }
    );

  safePatch.updated_at =
    new Date().toISOString();

  const {
    data,
    error
  } = await requireAdmin()
    .from("projects")
    .update(safePatch)
    .eq("id", id)
    .eq("user_id", owner)
    .select(select)
    .maybeSingle();

  if (error) {
    throw error;
  }

  if (!data) {
    const notFound = new Error(
      "Website project not found."
    );

    notFound.status = 404;
    throw notFound;
  }

  return data;
}

export async function slugTaken(
  slugValue,
  excludeProjectId = ""
) {
  const slug =
    cleanSlug(slugValue);

  let query =
    requireAdmin()
      .from("projects")
      .select("id")
      .eq("slug", slug)
      .limit(1);

  const excludedId =
    cleanText(excludeProjectId);

  if (excludedId) {
    query =
      query.neq(
        "id",
        excludedId
      );
  }

  const {
    data,
    error
  } = await query;

  if (error) {
    throw error;
  }

  return (
    Array.isArray(data) &&
    data.length > 0
  );
}

export async function uniqueSlug(
  slugValue,
  projectId = ""
) {
  const base =
    cleanSlug(slugValue);

  if (
    !await slugTaken(
      base,
      projectId
    )
  ) {
    return base;
  }

  const suffixSource =
    cleanText(projectId)
      .replace(/-/g, "")
      .slice(-8) ||
    Date.now()
      .toString(36)
      .slice(-8);

  const prefix =
    base
      .slice(
        0,
        Math.max(
          1,
          48 -
          suffixSource.length -
          1
        )
      )
      .replace(/-+$/g, "");

  const candidate =
    `${prefix}-${suffixSource}`;

  if (
    !await slugTaken(
      candidate,
      projectId
    )
  ) {
    return candidate;
  }

  const error = new Error(
    "A unique website address could not be created."
  );

  error.status = 409;
  throw error;
}

function teamQuery() {
  const teamId =
    env(
      "VERCEL_TEAM_ID",
      false
    );

  return teamId
    ? `?teamId=${encodeURIComponent(teamId)}`
    : "";
}

async function vercelRequest(
  path,
  options = {}
) {
  assertServerConfig({
    needsSupabase: false,
    needsVercel: true
  });

  const response =
    await fetch(
      `https://api.vercel.com${path}`,
      {
        ...options,
        headers: {
          Authorization:
            `Bearer ${env("VERCEL_TOKEN")}`,
          "Content-Type":
            "application/json",
          ...(
            options.headers ||
            {}
          )
        }
      }
    );

  const payload =
    await response
      .json()
      .catch(() => ({}));

  if (!response.ok) {
    const error = new Error(
      cleanText(
        payload?.error?.message
      ) ||
      cleanText(
        payload?.message
      ) ||
      `Vercel request failed (${response.status}).`
    );

    error.status =
      response.status;

    error.payload =
      payload;

    throw error;
  }

  return payload;
}

function domainsPath(
  domain = ""
) {
  const projectId =
    encodeURIComponent(
      env(
        "VERCEL_PROJECT_ID"
      )
    );

  const domainPath =
    domain
      ? `/${encodeURIComponent(domain)}`
      : "";

  return (
    `/v10/projects/${projectId}/domains` +
    domainPath +
    teamQuery()
  );
}

export async function addDomainToVercel(
  domainValue
) {
  const domain =
    normalizeDomain(
      domainValue
    );

  if (!validDomain(domain)) {
    const error = new Error(
      "Enter a valid domain name."
    );

    error.status = 400;
    throw error;
  }

  try {
    return await vercelRequest(
      domainsPath(),
      {
        method: "POST",
        body: JSON.stringify({
          name: domain
        })
      }
    );
  } catch (error) {
    if (error.status === 409) {
      return getVercelProjectDomain(
        domain
      );
    }

    throw error;
  }
}

export async function getVercelProjectDomain(
  domainValue
) {
  const domain =
    normalizeDomain(
      domainValue
    );

  return vercelRequest(
    domainsPath(domain),
    {
      method: "GET"
    }
  );
}

export async function verifyVercelProjectDomain(
  domainValue
) {
  const domain =
    normalizeDomain(
      domainValue
    );

  const projectId =
    encodeURIComponent(
      env(
        "VERCEL_PROJECT_ID"
      )
    );

  return vercelRequest(
    `/v9/projects/${projectId}/domains/${encodeURIComponent(domain)}/verify${teamQuery()}`,
    {
      method: "POST",
      body: "{}"
    }
  );
}

export async function removeDomainFromVercel(
  domainValue
) {
  const domain =
    normalizeDomain(
      domainValue
    );

  return vercelRequest(
    domainsPath(domain),
    {
      method: "DELETE"
    }
  );
}

export function dnsRecordsFor(
  domainValue,
  data = {}
) {
  const domain =
    normalizeDomain(
      domainValue
    );

  const labels =
    domain
      .split(".")
      .filter(Boolean);

  const isApex =
    labels.length === 2;

  const records =
    isApex
      ? [
          {
            type: "A",
            name: "@",
            value:
              "76.76.21.21"
          },
          {
            type: "CNAME",
            name: "www",
            value:
              "cname.vercel-dns.com"
          }
        ]
      : [
          {
            type: "CNAME",
            name:
              labels[0] ||
              "@",
            value:
              "cname.vercel-dns.com"
          }
        ];

  const verification =
    Array.isArray(
      data.verification
    ) &&
    data.verification.length
      ? data.verification[0]
      : null;

  return {
    records,
    verification_record:
      verification
        ? {
            type:
              verification.type ||
              "TXT",
            name:
              verification.domain ||
              verification.name ||
              `_vercel.${domain}`,
            value:
              verification.value ||
              ""
          }
        : null
  };
}

export function statusFromVercel(
  data = {}
) {
  const verificationComplete =
    data.verified === true ||
    (
      Array.isArray(
        data.verification
      ) &&
      data.verification.length === 0
    );

  const configurationComplete =
    data.misconfigured === false;

  const connected =
    verificationComplete &&
    data.misconfigured !== true &&
    (
      configurationComplete ||
      typeof data.misconfigured !==
        "boolean"
    );

  return {
    domain_status:
      connected
        ? "connected"
        : "verifying",
    dns_verified:
      connected,
    ssl_status:
      connected
        ? "active"
        : "provisioning"
  };
}

export function planFromPriceId(
  priceIdValue
) {
  const priceId =
    cleanText(priceIdValue);

  if (!priceId) {
    return null;
  }

  const map = new Map([
    [
      cleanText(
        process.env
          .STRIPE_STARTER_PRICE_ID
      ),
      "starter"
    ],
    [
      cleanText(
        process.env
          .STRIPE_PROFESSIONAL_PRICE_ID
      ),
      "professional"
    ],
    [
      cleanText(
        process.env
          .STRIPE_ADVANCED_PRICE_ID
      ),
      "advanced"
    ],
    [
      cleanText(
        process.env
          .STRIPE_STARTER_ANNUAL_PRICE_ID
      ),
      "starter"
    ],
    [
      cleanText(
        process.env
          .STRIPE_PROFESSIONAL_ANNUAL_PRICE_ID
      ),
      "professional"
    ],
    [
      cleanText(
        process.env
          .STRIPE_ADVANCED_ANNUAL_PRICE_ID
      ),
      "advanced"
    ]
  ]);

  map.delete("");

  return map.get(priceId) || null;
}

export function errorResponse(
  res,
  error
) {
  return sendError(
    res,
    error,
    "Unexpected domain service error."
  );
}