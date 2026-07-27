import {
  admin
} from "./_lib.js";

function createHttpError(message, status = 500) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function getBearerToken(req) {
  const authorization =
    req.headers.authorization ||
    req.headers.Authorization ||
    "";

  if (
    typeof authorization !== "string" ||
    !authorization.toLowerCase().startsWith("bearer ")
  ) {
    return null;
  }

  return authorization.slice(7).trim();
}

function normalizePlan(plan) {
  if (!plan) {
    return null;
  }

  return String(plan)
    .trim()
    .toLowerCase();
}

function isActiveSubscription(status) {
  return [
    "active",
    "trialing"
  ].includes(
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
      throw createHttpError(
        "You must be signed in.",
        401
      );
    }

    const {
      data: userData,
      error: userError
    } = await admin.auth.getUser(
      accessToken
    );

    if (userError || !userData?.user) {
      throw createHttpError(
        "Your sign-in session is invalid or expired.",
        401
      );
    }

    const user = userData.user;

    const {
      data: profile,
      error: profileError
    } = await admin
      .from("profiles")
      .select(
        [
          "id",
          "email",
          "full_name",
          "plan",
          "subscription_status",
          "stripe_customer_id",
          "website_bought_out",
          "buyout_plan",
          "buyout_completed_at",
          "created_at",
          "updated_at"
        ].join(",")
      )
      .eq("id", user.id)
      .maybeSingle();

    if (profileError) {
      throw profileError;
    }

    const plan = normalizePlan(
      profile?.plan
    );

    const subscriptionStatus =
      profile?.subscription_status ||
      "inactive";

    const activeSubscription =
      isActiveSubscription(
        subscriptionStatus
      );

    const websiteBoughtOut =
      Boolean(
        profile?.website_bought_out
      );

    return res.status(200).json({
      signedIn: true,
      signed_in: true,

      user: {
        id: user.id,
        email:
          user.email ||
          profile?.email ||
          null,
        fullName:
          profile?.full_name ||
          user.user_metadata?.full_name ||
          user.user_metadata?.name ||
          null
      },

      account: {
        plan,
        subscriptionStatus,
        subscription_status:
          subscriptionStatus,
        activeSubscription,
        active_subscription:
          activeSubscription,
        subscribed:
          activeSubscription,
        hasActivePlan:
          activeSubscription,
        has_active_plan:
          activeSubscription,
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
          profile?.buyout_plan ||
          null,
        buyout_plan:
          profile?.buyout_plan ||
          null,
        buyoutCompletedAt:
          profile?.buyout_completed_at ||
          null,
        buyout_completed_at:
          profile?.buyout_completed_at ||
          null
      },

      plan,
      subscriptionStatus,
      subscription_status:
        subscriptionStatus,
      activeSubscription,
      active_subscription:
        activeSubscription,
      subscribed:
        activeSubscription,
      hasActivePlan:
        activeSubscription,
      has_active_plan:
        activeSubscription,
      websiteBoughtOut,
      website_bought_out:
        websiteBoughtOut,
      buyoutPlan:
        profile?.buyout_plan ||
        null,
      buyout_plan:
        profile?.buyout_plan ||
        null,
      buyoutCompletedAt:
        profile?.buyout_completed_at ||
        null,
      buyout_completed_at:
        profile?.buyout_completed_at ||
        null
    });
  } catch (error) {
    console.error(
      "Account API error:",
      error
    );

    return res
      .status(error.status || 500)
      .json({
        signedIn: false,
        signed_in: false,
        error:
          error.message ||
          "Unable to load account information."
      });
  }
}