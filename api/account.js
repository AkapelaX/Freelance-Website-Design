"use strict";

/*
  BLUVIXA ACCOUNT ENDPOINT — STANDALONE STABILITY VERSION

  This route intentionally has no imports and creates no SDK clients while the
  module is loading. That prevents Vercel's FUNCTION_INVOCATION_FAILED error
  from hiding the real account response.
*/

function sendJson(res, status, payload) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store, max-age=0");
  return res.status(status).end(JSON.stringify(payload));
}

function bearerToken(req) {
  const header = String(req.headers.authorization || "");
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : "";
}

function activeStatus(status) {
  return ["active", "trialing"].includes(
    String(status || "").toLowerCase()
  );
}

async function readResponse(response) {
  const text = await response.text();

  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch (_error) {
    return text;
  }
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");

    return sendJson(res, 405, {
      error: "Method not allowed."
    });
  }

  try {
    const supabaseUrl = String(
      process.env.SUPABASE_URL ||
      process.env.NEXT_PUBLIC_SUPABASE_URL ||
      process.env.VITE_SUPABASE_URL ||
      ""
    ).replace(/\/+$/, "");

    const anonKey =
      process.env.SUPABASE_ANON_KEY ||
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
      process.env.VITE_SUPABASE_ANON_KEY ||
      "";

    const serviceRoleKey =
      process.env.SUPABASE_SERVICE_ROLE_KEY ||
      "";

    if (!supabaseUrl || !anonKey || !serviceRoleKey) {
      return sendJson(res, 500, {
        signedIn: false,
        error:
          "The Supabase server variables are incomplete in Vercel Production."
      });
    }

    const accessToken = bearerToken(req);

    if (!accessToken) {
      return sendJson(res, 401, {
        signedIn: false,
        error: "You must be signed in."
      });
    }

    const userResponse = await fetch(
      `${supabaseUrl}/auth/v1/user`,
      {
        method: "GET",
        headers: {
          apikey: anonKey,
          Authorization: `Bearer ${accessToken}`
        }
      }
    );

    const userBody = await readResponse(
      userResponse
    );

    if (
      !userResponse.ok ||
      !userBody ||
      typeof userBody !== "object" ||
      !userBody.id
    ) {
      return sendJson(res, 401, {
        signedIn: false,
        error:
          (userBody &&
            typeof userBody === "object" &&
            (userBody.msg ||
              userBody.message ||
              userBody.error_description)) ||
          "Your sign-in session is invalid or expired."
      });
    }

    const profileUrl =
      `${supabaseUrl}/rest/v1/profiles` +
      `?id=eq.${encodeURIComponent(userBody.id)}` +
      "&select=*" +
      "&limit=1";

    const profileResponse = await fetch(
      profileUrl,
      {
        method: "GET",
        headers: {
          apikey: serviceRoleKey,
          Authorization:
            `Bearer ${serviceRoleKey}`,
          Accept: "application/json"
        }
      }
    );

    const profileBody = await readResponse(
      profileResponse
    );

    if (!profileResponse.ok) {
      const detail =
        typeof profileBody === "string"
          ? profileBody
          : profileBody &&
              typeof profileBody === "object"
            ? profileBody.message ||
              profileBody.details ||
              profileBody.hint ||
              profileBody.code
            : "";

      console.error(
        "Account profile query failed:",
        profileResponse.status,
        profileBody
      );

      return sendJson(res, 500, {
        signedIn: true,
        error:
          detail ||
          "The profile record could not be loaded."
      });
    }

    const profile =
      Array.isArray(profileBody) &&
      profileBody.length
        ? profileBody[0]
        : {};

    const plan =
      profile.plan ||
      userBody.user_metadata?.plan ||
      null;

    const subscriptionStatus =
      profile.subscription_status ||
      profile.subscriptionStatus ||
      userBody.user_metadata
        ?.subscription_status ||
      "inactive";

    const subscribed = activeStatus(
      subscriptionStatus
    );

    const websiteBoughtOut = Boolean(
      profile.website_bought_out ||
      profile.websiteBoughtOut
    );

    return sendJson(res, 200, {
      signedIn: true,
      signed_in: true,

      user: {
        id: userBody.id,
        email: userBody.email || null
      },

      plan,

      subscriptionStatus,
      subscription_status:
        subscriptionStatus,

      subscribed,
      activeSubscription: subscribed,
      active_subscription: subscribed,
      hasActivePlan: subscribed,
      has_active_plan: subscribed,

      stripeCustomerId:
        profile.stripe_customer_id ||
        null,
      stripe_customer_id:
        profile.stripe_customer_id ||
        null,

      websiteBoughtOut,
      website_bought_out:
        websiteBoughtOut,

      buyoutPlan:
        profile.buyout_plan || null,
      buyout_plan:
        profile.buyout_plan || null,

      buyoutCompletedAt:
        profile.buyout_completed_at ||
        null,
      buyout_completed_at:
        profile.buyout_completed_at ||
        null
    });
  } catch (error) {
    console.error(
      "Standalone account endpoint failed:",
      error
    );

    return sendJson(res, 500, {
      signedIn: false,
      error:
        error && error.message
          ? error.message
          : "Unable to load account information."
    });
  }
}
