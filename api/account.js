"use strict";

function sendJson(res, status, payload) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.status(status).json(payload);
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return sendJson(res, 405, {
      error: "Method not allowed"
    });
  }

  try {
    const supabaseUrl =
      process.env.SUPABASE_URL ||
      process.env.NEXT_PUBLIC_SUPABASE_URL;

    const anonKey =
      process.env.SUPABASE_ANON_KEY ||
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    const serviceRole =
      process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !anonKey || !serviceRole) {
      return sendJson(res, 500, {
        signedIn: false,
        error: "Supabase environment variables are missing."
      });
    }

    const auth =
      req.headers.authorization || "";

    const token = auth.replace(
      "Bearer ",
      ""
    );

    if (!token) {
      return sendJson(res, 401, {
        signedIn: false,
        error: "Missing access token."
      });
    }

    const userRes = await fetch(
      `${supabaseUrl}/auth/v1/user`,
      {
        headers: {
          apikey: anonKey,
          Authorization: `Bearer ${token}`
        }
      }
    );

    const user = await userRes.json();

    if (!userRes.ok || !user.id) {
      return sendJson(res, 401, {
        signedIn: false,
        error: "Invalid session."
      });
    }

    const profileRes = await fetch(
      `${supabaseUrl}/rest/v1/profiles?id=eq.${user.id}&select=*`,
      {
        headers: {
          apikey: serviceRole,
          Authorization: `Bearer ${serviceRole}`
        }
      }
    );

    const profiles =
      await profileRes.json();

    if (!profileRes.ok) {
      return sendJson(res, 500, {
        signedIn: true,
        error: profiles
      });
    }

    const profile =
      profiles[0] || {};

    const status =
      profile.subscription_status ||
      "inactive";

    const active =
      status === "active" ||
      status === "trialing";

    return sendJson(res, 200, {
      signedIn: true,
      user: {
        id: user.id,
        email: user.email
      },
      plan: profile.plan || null,
      subscriptionStatus: status,
      subscribed: active,
      stripeCustomerId:
        profile.stripe_customer_id ||
        null,
      websiteBoughtOut:
        profile.website_bought_out ||
        false
    });
  } catch (err) {
    console.error(err);

    return sendJson(res, 500, {
      signedIn: false,
      error: err.message
    });
  }
}