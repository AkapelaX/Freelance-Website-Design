import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL;
const anonKey = process.env.SUPABASE_ANON_KEY;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || "sk_test_missing", {
  apiVersion: "2024-12-18.acacia"
});

export const admin = supabaseUrl && serviceRoleKey
  ? createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } })
  : null;

export function assertServerConfig({ needsStripe = false } = {}) {
  if (!supabaseUrl || !anonKey || !serviceRoleKey || !admin) {
    const error = new Error("Supabase server environment variables are not configured.");
    error.status = 500;
    throw error;
  }
  if (needsStripe && !process.env.STRIPE_SECRET_KEY) {
    const error = new Error("STRIPE_SECRET_KEY is not configured.");
    error.status = 500;
    throw error;
  }
}

export function bearerToken(req) {
  const match = String(req.headers.authorization || "").match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : "";
}

export async function authenticatedUser(req) {
  assertServerConfig();
  const token = bearerToken(req);
  if (!token) {
    const error = new Error("You must be signed in."); error.status = 401; throw error;
  }
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data?.user) {
    const authError = new Error("Your sign-in session is invalid or expired."); authError.status = 401; throw authError;
  }
  return data.user;
}

export function sendJson(res, status, body) {
  res.setHeader("Cache-Control", "no-store");
  return res.status(status).json(body);
}

export function planFromPriceId(priceId) {
  const entries = [
    ["starter", process.env.STRIPE_PRICE_STARTER_ANNUAL, process.env.STRIPE_PRICE_STARTER_BUYOUT],
    ["professional", process.env.STRIPE_PRICE_PROFESSIONAL_ANNUAL, process.env.STRIPE_PRICE_PROFESSIONAL_BUYOUT],
    ["advanced", process.env.STRIPE_PRICE_ADVANCED_ANNUAL, process.env.STRIPE_PRICE_ADVANCED_BUYOUT]
  ];
  return (entries.find(([, annual, buyout]) => priceId === annual || priceId === buyout) || [null])[0];
}
