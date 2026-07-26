import {
  stripe,
  admin,
  requireUser,
  sendError
} from "./_lib.js";

const PRICES = {
  starter: {
    annual: process.env.STRIPE_PRICE_STARTER_ANNUAL,
    buyout: process.env.STRIPE_PRICE_STARTER_BUYOUT
  },
  professional: {
    annual: process.env.STRIPE_PRICE_PROFESSIONAL_ANNUAL,
    buyout: process.env.STRIPE_PRICE_PROFESSIONAL_BUYOUT
  },
  advanced: {
    annual: process.env.STRIPE_PRICE_ADVANCED_ANNUAL,
    buyout: process.env.STRIPE_PRICE_ADVANCED_BUYOUT
  }
};

function getOrigin(req) {
  if (req.headers.origin) {
    return req.headers.origin;
  }

  const protocol =
    req.headers["x-forwarded-proto"] ||
    (process.env.NODE_ENV === "production" ? "https" : "http");

  const host =
    req.headers["x-forwarded-host"] ||
    req.headers.host;

  if (!host) {
    const error = new Error("Unable to determine the application URL.");
    error.status = 500;
    throw error;
  }

  return `${protocol}://${host}`;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");

    return res.status(405).json({
      error: "Method not allowed."
    });
  }

  try {
    const user = await requireUser(req);

    const {
      plan,
      purchaseType = "annual",
      successUrl,
      cancelUrl
    } = req.body || {};

    const validPlans = [
      "starter",
      "professional",
      "advanced"
    ];

    const validPurchaseTypes = [
      "annual",
      "buyout"
    ];

    if (!validPlans.includes(plan)) {
      const error = new Error("Invalid Bluvixa plan.");
      error.status = 400;
      throw error;
    }

    if (!validPurchaseTypes.includes(purchaseType)) {
      const error = new Error("Invalid purchase type.");
      error.status = 400;
      throw error;
    }

    const price = PRICES[plan]?.[purchaseType]?.trim();

    if (!price) {
      const error = new Error(
        "Stripe price is not configured for this selection."
      );
      error.status = 400;
      throw error;
    }

    if (!price.startsWith("price_")) {
      const error = new Error(
        "The configured Stripe value must be a Price ID beginning with price_."
      );
      error.status = 500;
      throw error;
    }

    const {
      data: profile,
      error: profileError
    } = await admin
      .from("profiles")
      .select("stripe_customer_id")
      .eq("id", user.id)
      .maybeSingle();

    if (profileError) {
      throw profileError;
    }

    let customerId = profile?.stripe_customer_id || null;

    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email,
        metadata: {
          supabase_user_id: user.id
        }
      });

      customerId = customer.id;

      const {
        error: profileUpdateError
      } = await admin
        .from("profiles")
        .upsert(
          {
            id: user.id,
            email: user.email,
            stripe_customer_id: customerId
          },
          {
            onConflict: "id"
          }
        );

      if (profileUpdateError) {
        throw profileUpdateError;
      }
    }

    const isAnnualSubscription =
      purchaseType === "annual";

    const origin = getOrigin(req);

    const checkoutSession =
      await stripe.checkout.sessions.create({
        customer: customerId,

        mode: isAnnualSubscription
          ? "subscription"
          : "payment",

        line_items: [
          {
            price,
            quantity: 1
          }
        ],

        subscription_data: isAnnualSubscription
          ? {
              trial_period_days: 7,
              metadata: {
                plan,
                user_id: user.id
              }
            }
          : undefined,

        metadata: {
          plan,
          purchase_type: purchaseType,
          user_id: user.id
        },

        success_url:
          successUrl ||
          `${origin}/#account`,

        cancel_url:
          cancelUrl ||
          `${origin}/#pricing`,

        allow_promotion_codes: true,

        billing_address_collection: "auto"
      });

    if (!checkoutSession.url) {
      const error = new Error(
        "Stripe did not return a checkout URL."
      );
      error.status = 500;
      throw error;
    }

    return res.status(200).json({
      url: checkoutSession.url
    });
  } catch (error) {
    return sendError(res, error);
  }
}