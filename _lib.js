import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = String(process.env.SUPABASE_URL || "").trim();
const serviceRoleKey = String(
  process.env.SUPABASE_SERVICE_ROLE_KEY || ""
).trim();

const stripeSecretKey = String(
  process.env.STRIPE_SECRET_KEY || ""
).trim();

/**
 * Stripe server client.
 *
 * assertServerConfig({ needsStripe: true }) must be called before
 * performing Stripe operations.
 */
export const stripe = new Stripe(
  stripeSecretKey || "sk_test_missing",
  {
    apiVersion: "2024-12-18.acacia"
  }
);

/**
 * Server-only Supabase client.
 *
 * Never expose SUPABASE_SERVICE_ROLE_KEY to browser code.
 */
export const admin =
  supabaseUrl && serviceRoleKey
    ? createClient(supabaseUrl, serviceRoleKey, {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
          detectSessionInUrl: false
        }
      })
    : null;

/**
 * Confirms that the environment variables required by an API route exist.
 */
export function assertServerConfig({ needsStripe = false } = {}) {
  if (!supabaseUrl || !serviceRoleKey || !admin) {
    const error = new Error(
      "Supabase server environment variables are not configured."
    );

    error.status = 500;
    throw error;
  }

  if (needsStripe && !stripeSecretKey) {
    const error = new Error(
      "STRIPE_SECRET_KEY is not configured."
    );

    error.status = 500;
    throw error;
  }
}

/**
 * Reads a Bearer token from the request Authorization header.
 */
export function bearerToken(req) {
  const authorization = String(
    req?.headers?.authorization || ""
  );

  const match = authorization.match(/^Bearer\s+(.+)$/i);

  return match ? match[1].trim() : "";
}

/**
 * Verifies the requesting user's Supabase access token.
 */
export async function authenticatedUser(req) {
  assertServerConfig();

  const token = bearerToken(req);

  if (!token) {
    const error = new Error("You must be signed in.");

    error.status = 401;
    throw error;
  }

  const { data, error } = await admin.auth.getUser(token);

  if (error || !data?.user) {
    const authError = new Error(
      "Your sign-in session is invalid or expired."
    );

    authError.status = 401;
    throw authError;
  }

  return data.user;
}

/**
 * Sends a non-cacheable JSON API response.
 */
export function sendJson(res, status, body) {
  res.setHeader(
    "Cache-Control",
    "no-store, no-cache, must-revalidate, max-age=0"
  );

  return res.status(status).json(body);
}

/**
 * Resolves a Bluvixa plan from either an annual subscription
 * price ID or a website-buyout price ID.
 */
export function planFromPriceId(priceId) {
  const normalizedPriceId = String(priceId || "").trim();

  if (!normalizedPriceId) {
    return null;
  }

  const prices = [
    {
      plan: "starter",
      annual: process.env.STRIPE_PRICE_STARTER_ANNUAL,
      buyout: process.env.STRIPE_PRICE_STARTER_BUYOUT
    },
    {
      plan: "professional",
      annual: process.env.STRIPE_PRICE_PROFESSIONAL_ANNUAL,
      buyout: process.env.STRIPE_PRICE_PROFESSIONAL_BUYOUT
    },
    {
      plan: "advanced",
      annual: process.env.STRIPE_PRICE_ADVANCED_ANNUAL,
      buyout: process.env.STRIPE_PRICE_ADVANCED_BUYOUT
    }
  ];

  const match = prices.find(({ annual, buyout }) => {
    return normalizedPriceId === String(annual || "").trim() ||
      normalizedPriceId === String(buyout || "").trim();
  });

  return match?.plan || null;
}