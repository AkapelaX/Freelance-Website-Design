"use strict";

import {
  admin,
  authenticatedUser,
  sendJson
} from "./_server.js";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return sendJson(res, 405, {
      signedIn: false,
      error: "Method not allowed."
    });
  }

  try {
    const user = await authenticatedUser(req);

    const { data: profile, error: profileError } = await admin
      .from("profiles")
      .select(`
        plan,
        subscription_status,
        stripe_customer_id,
        website_bought_out,
        buyout_plan,
        buyout_completed_at
      `)
      .eq("id", user.id)
      .maybeSingle();

    if (profileError) {
      console.error("Failed to load profile:", profileError);

      return sendJson(res, 500, {
        signedIn: true,
        error: "Unable to load your account information."
      });
    }

    const subscriptionStatus =
      String(profile?.subscription_status || "inactive")
        .trim()
        .toLowerCase();

    const subscribed =
      subscriptionStatus === "active" ||
      subscriptionStatus === "trialing";

    return sendJson(res, 200, {
      signedIn: true,

      user: {
        id: user.id,
        email: user.email || null
      },

      plan: profile?.plan || null,

      subscriptionStatus,

      subscribed,

      stripeCustomerId:
        profile?.stripe_customer_id || null,

      websiteBoughtOut:
        profile?.website_bought_out === true,

      buyoutPlan:
        profile?.buyout_plan || null,

      buyoutCompletedAt:
        profile?.buyout_completed_at || null
    });
  } catch (error) {
    console.error("Account status API error:", error);

    const status =
      Number.isInteger(error?.status)
        ? error.status
        : 500;

    return sendJson(res, status, {
      signedIn: false,
      error:
        status === 500
          ? "Unable to load your account status."
          : error.message
    });
  }
}