"use strict";

const Stripe = require("stripe");
const { createClient } = require("@supabase/supabase-js");

const ALLOWED_PLANS = new Set(["starter", "professional", "advanced"]);
const ALLOWED_PURCHASE_TYPES = new Set(["annual", "buyout"]);

function sendJson(res, status, payload) {
  res.status(status).setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  return res.end(JSON.stringify(payload));
}

function readBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") {
    try {
      return JSON.parse(req.body);
    } catch (_) {
      return {};
    }
  }
  return {};
}

function bearerToken(req) {
  const header = String(req.headers.authorization || "");
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : "";
}

function cleanUrl(value, fallback) {
  try {
    const parsed = new URL(String(value || fallback));
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return fallback;
    return parsed.toString();
  } catch (_) {
    return fallback;
  }
}

function priceIdFor(plan, purchaseType) {
  const key = `STRIPE_PRICE_${plan.toUpperCase()}_${purchaseType === "buyout" ? "BUYOUT" : "ANNUAL"}`;
  return process.env[key] || "";
}

async function findOrCreateCustomer(stripe, user) {
  // Reuse a Stripe customer previously linked to this Supabase user.
  const search = await stripe.customers.search({
    query: `metadata['supabase_user_id']:'${String(user.id).replace(/'/g, "\\'")}'`,
    limit: 1,
  });

  if (search.data && search.data[0]) return search.data[0];

  return stripe.customers.create({
    email: user.email || undefined,
    name:
      (user.user_metadata &&
        (user.user_metadata.full_name || user.user_metadata.name)) ||
      undefined,
    metadata: {
      supabase_user_id: user.id,
      bluvixa_account_email: user.email || "",
    },
  });
}

module.exports = async function handler(req, res) {
  if (req.method === "OPTIONS") {
    res.setHeader("Allow", "POST, OPTIONS");
    return res.status(204).end();
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST, OPTIONS");
    return sendJson(res, 405, { error: "Method not allowed." });
  }

  try {
    const required = [
      "STRIPE_SECRET_KEY",
      "SUPABASE_URL",
      "SUPABASE_SERVICE_ROLE_KEY",
    ];
    const missing = required.filter((name) => !process.env[name]);
    if (missing.length) {
      return sendJson(res, 500, {
        error: `Missing server environment variable${missing.length > 1 ? "s" : ""}: ${missing.join(", ")}`,
      });
    }

    const token = bearerToken(req);
    if (!token) return sendJson(res, 401, { error: "Sign in before starting checkout." });

    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
      { auth: { persistSession: false, autoRefreshToken: false } }
    );

    const { data: userData, error: userError } = await supabase.auth.getUser(token);
    const user = userData && userData.user;
    if (userError || !user) {
      return sendJson(res, 401, { error: "Your sign-in session is invalid or expired." });
    }

    const body = readBody(req);
    const plan = String(body.plan || "starter").toLowerCase();
    const purchaseType = String(body.purchaseType || "annual").toLowerCase();
    const websiteId = body.websiteId ? String(body.websiteId) : "";

    if (!ALLOWED_PLANS.has(plan)) {
      return sendJson(res, 400, { error: "Invalid Bluvixa plan." });
    }
    if (!ALLOWED_PURCHASE_TYPES.has(purchaseType)) {
      return sendJson(res, 400, { error: "Invalid purchase type." });
    }
    if (purchaseType === "buyout" && !websiteId) {
      return sendJson(res, 400, { error: "Choose a website before purchasing a buyout." });
    }

    // Prevent a user from buying out a website they do not own.
    if (purchaseType === "buyout") {
      const { data: project, error: projectError } = await supabase
        .from("website_projects")
        .select("id, owner_id, name, website_bought_out")
        .eq("id", websiteId)
        .eq("owner_id", user.id)
        .maybeSingle();

      if (projectError) throw projectError;
      if (!project) return sendJson(res, 404, { error: "Website not found." });
      if (project.website_bought_out) {
        return sendJson(res, 409, { error: "This website has already been purchased." });
      }
    }

    const priceId = priceIdFor(plan, purchaseType);
    if (!priceId) {
      return sendJson(res, 500, {
        error: `Stripe price is not configured for the ${plan} ${purchaseType} option.`,
      });
    }

    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
    const customer = await findOrCreateCustomer(stripe, user);

    const origin = `${req.headers["x-forwarded-proto"] || "https"}://${req.headers["x-forwarded-host"] || req.headers.host}`;
    const successUrl = cleanUrl(body.successUrl, `${origin}/#projects`);
    const cancelUrl = cleanUrl(body.cancelUrl, `${origin}/#pricing`);

    const metadata = {
      supabase_user_id: user.id,
      user_id: user.id,
      plan,
      purchase_type: purchaseType,
      website_id: websiteId,
    };

    const sessionOptions = {
      customer: customer.id,
      mode: purchaseType === "buyout" ? "payment" : "subscription",
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: successUrl,
      cancel_url: cancelUrl,
      allow_promotion_codes: true,
      billing_address_collection: "auto",
      metadata,
      client_reference_id: user.id,
    };

    if (purchaseType === "buyout") {
      sessionOptions.payment_intent_data = { metadata };
      sessionOptions.invoice_creation = { enabled: true };
    } else {
      sessionOptions.subscription_data = { metadata };
    }

    const session = await stripe.checkout.sessions.create(sessionOptions);
    return sendJson(res, 200, { url: session.url, sessionId: session.id });
  } catch (error) {
    console.error("Bluvixa checkout creation failed:", error);
    return sendJson(res, 500, {
      error: error && error.message ? error.message : "Checkout could not be created.",
    });
  }
};