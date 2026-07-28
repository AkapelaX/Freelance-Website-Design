import {
  stripe,
  admin,
  authenticatedUser,
  assertServerConfig,
  sendJson
} from "../_lib.js";

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

function cleanText(value) {
  return typeof value === "string"
    ? value.trim()
    : "";
}

function requestOrigin(req) {
  const forwardedProto = cleanText(
    req.headers["x-forwarded-proto"]
  )
    .split(",")[0]
    .trim();

  const protocol =
    forwardedProto ||
    (process.env.NODE_ENV === "development"
      ? "http"
      : "https");

  const forwardedHost = cleanText(
    req.headers["x-forwarded-host"]
  )
    .split(",")[0]
    .trim();

  const host =
    forwardedHost ||
    cleanText(req.headers.host);

  if (!host) {
    const error = new Error(
      "Unable to determine the checkout return address."
    );

    error.status = 500;
    throw error;
  }

  return `${protocol}://${host}`;
}

function safeReturnUrl(value, origin, fallbackPath) {
  const candidate = cleanText(value);

  if (!candidate) {
    return `${origin}${fallbackPath}`;
  }

  try {
    const url = new URL(candidate, origin);

    if (url.origin !== origin) {
      return `${origin}${fallbackPath}`;
    }

    return url.toString();
  } catch {
    return `${origin}${fallbackPath}`;
  }
}

async function loadOwnedProject(userId, websiteId) {
  const normalizedWebsiteId = cleanText(websiteId);

  if (!normalizedWebsiteId) {
    const error = new Error(
      "A website must be selected for a website buyout."
    );

    error.status = 400;
    throw error;
  }

  const { data: project, error: projectError } =
    await admin
      .from("projects")
      .select(`
        id,
        user_id,
        name,
        plan
      `)
      .eq("id", normalizedWebsiteId)
      .eq("user_id", userId)
      .maybeSingle();

  if (projectError) {
    console.error(
      "Unable to verify checkout project:",
      projectError
    );

    const error = new Error(
      "Unable to verify the selected website."
    );

    error.status = 500;
    throw error;
  }

  if (!project) {
    const error = new Error(
      "The selected website was not found or does not belong to your account."
    );

    error.status = 404;
    throw error;
  }

  return project;
}

async function getOrCreateStripeCustomer(user) {
  const { data: profile, error: profileError } =
    await admin
      .from("profiles")
      .select(`
        id,
        email,
        stripe_customer_id
      `)
      .eq("id", user.id)
      .maybeSingle();

  if (profileError) {
    console.error(
      "Unable to load checkout profile:",
      profileError
    );

    const error = new Error(
      "Unable to load your billing profile."
    );

    error.status = 500;
    throw error;
  }

  if (profile?.stripe_customer_id) {
    return profile.stripe_customer_id;
  }

  const customer = await stripe.customers.create({
    email:
      user.email ||
      profile?.email ||
      undefined,

    metadata: {
      user_id: user.id
    }
  });

  const { error: saveCustomerError } =
    await admin
      .from("profiles")
      .upsert(
        {
          id: user.id,
          email:
            user.email ||
            profile?.email ||
            null,
          stripe_customer_id: customer.id
        },
        {
          onConflict: "id"
        }
      );

  if (saveCustomerError) {
    console.error(
      "Unable to save Stripe customer ID:",
      saveCustomerError
    );

    const error = new Error(
      "Your Stripe customer was created, but the billing profile could not be updated."
    );

    error.status = 500;
    throw error;
  }

  return customer.id;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");

    return sendJson(res, 405, {
      error: "Method not allowed."
    });
  }

  try {
    assertServerConfig({
      needsStripe: true
    });

    const user =
      await authenticatedUser(req);

    const plan = cleanText(
      req.body?.plan || "starter"
    ).toLowerCase();

    const purchaseType = cleanText(
      req.body?.purchaseType || "annual"
    ).toLowerCase();

    if (!PRICE_ENVIRONMENTS[plan]) {
      return sendJson(res, 400, {
        error: "Invalid Bluvixa plan."
      });
    }

    if (
      purchaseType !== "annual" &&
      purchaseType !== "buyout"
    ) {
      return sendJson(res, 400, {
        error: "Invalid purchase type."
      });
    }

    const priceEnvironmentName =
      PRICE_ENVIRONMENTS[plan][purchaseType];

    const priceId = cleanText(
      process.env[priceEnvironmentName]
    );

    if (!priceId) {
      const error = new Error(
        `Stripe price is not configured for the ${plan} ${purchaseType} option.`
      );

      error.status = 500;
      throw error;
    }

    let project = null;

    if (purchaseType === "buyout") {
      project = await loadOwnedProject(
        user.id,
        req.body?.websiteId
      );
    }

    const customerId =
      await getOrCreateStripeCustomer(user);

    const origin = requestOrigin(req);

    const successUrl = safeReturnUrl(
      req.body?.successUrl,
      origin,
      "/#projects?checkout=success"
    );

    const cancelUrl = safeReturnUrl(
      req.body?.cancelUrl,
      origin,
      "/#billing?checkout=cancelled"
    );

    const metadata = {
      user_id: user.id,
      plan,
      purchase_type: purchaseType
    };

    if (project?.id) {
      metadata.website_id = project.id;
    }

    const session =
      await stripe.checkout.sessions.create({
        customer: customerId,

        mode:
          purchaseType === "buyout"
            ? "payment"
            : "subscription",

        line_items: [
          {
            price: priceId,
            quantity: 1
          }
        ],

        metadata,

        client_reference_id: user.id,

        success_url: successUrl,

        cancel_url: cancelUrl,

        allow_promotion_codes:
          purchaseType === "annual",

        subscription_data:
          purchaseType === "annual"
            ? {
                metadata
              }
            : undefined,

        payment_intent_data:
          purchaseType === "buyout"
            ? {
                metadata
              }
            : undefined
      });

    if (!session.url) {
      const error = new Error(
        "Stripe did not return a checkout URL."
      );

      error.status = 500;
      throw error;
    }

    return sendJson(res, 200, {
      url: session.url,
      sessionId: session.id
    });
  } catch (error) {
    console.error(
      "Checkout API error:",
      error
    );

    const status =
      Number.isInteger(error?.status)
        ? error.status
        : 500;

    return sendJson(res, status, {
      error:
        error?.message ||
        "Checkout could not be started."
    });
  }
}