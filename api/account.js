import {
  admin
} from "./_lib.js";

function getBearerToken(req) {
  const authorization =
    req.headers.authorization || "";

  if (
    typeof authorization !== "string" ||
    !authorization.toLowerCase().startsWith("bearer ")
  ) {
    return null;
  }

  return authorization.slice(7).trim();
}

function isActiveStatus(status) {
  return ["active", "trialing"].includes(
    String(status || "").toLowerCase()
  );
}

export default async function handler(req, res) {
  res.setHeader(
    "Cache-Control",
    "no-store, max-age=0"
  );

  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");

    return res.status(405).json({
      error: "Method not allowed."
    });
  }

  try {
    const accessToken = getBearerToken(req);

    if (!accessToken) {
      return res.status(401).json({
        signedIn: false,
        error: "You must be signed in."
      });
    }

    const {
      data: userData,
      error: userError
    } = await admin.auth.getUser(accessToken);

    if (userError || !userData?.user) {
      return res.status(401).json({
        signedIn: false,
        error:
          "Your sign-in session is invalid or expired."
      });
    }

    const user = userData.user;

    const {
      data: profile,
      error: profileError
    } = await admin
      .from("profiles")
      .select(
        "id,plan,subscription_status,stripe_customer_id,website_bought_out,buyout_plan,buyout_completed_at"
      )
      .eq("id", user.id)
      .maybeSingle();

    if (profileError) {
      throw profileError;
    }

    const plan = profile?.plan || null;

    const subscriptionStatus =
      profile?.subscription_status ||
      "inactive";

    const subscribed =
      isActiveStatus(subscriptionStatus);

    const websiteBoughtOut =
      Boolean(profile?.website_bought_out);

    return res.status(200).json({
      signedIn: true,
      signed_in: true,

      user: {
        id: user.id,
        email: user.email || null
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

      websiteBoughtOut,
      website_bought_out:
        websiteBoughtOut,

      buyoutPlan:
        profile?.buyout_plan || null,
      buyout_plan:
        profile?.buyout_plan || null,

      buyoutCompletedAt:
        profile?.buyout_completed_at ||
        null,
      buyout_completed_at:
        profile?.buyout_completed_at ||
        null,

      account: {
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
          profile?.stripe_customer_id ||
          null,
        stripe_customer_id:
          profile?.stripe_customer_id ||
          null,
        websiteBoughtOut,
        website_bought_out:
          websiteBoughtOut,
        buyoutPlan:
          profile?.buyout_plan || null,
        buyout_plan:
          profile?.buyout_plan || null,
        buyoutCompletedAt:
          profile?.buyout_completed_at ||
          null,
        buyout_completed_at:
          profile?.buyout_completed_at ||
          null
      }
    });
  } catch (error) {
    console.error("Account API error:", error);

    return res.status(500).json({
      signedIn: false,
      error:
        error.message ||
        "Unable to load account information."
    });
  }
}