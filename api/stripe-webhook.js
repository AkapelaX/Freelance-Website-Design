import {
  stripe,
  admin
} from "./_lib.js";

export const config = {
  api: {
    bodyParser: false
  }
};

async function getRawBody(req) {
  const chunks = [];

  for await (const chunk of req) {
    chunks.push(
      Buffer.isBuffer(chunk)
        ? chunk
        : Buffer.from(chunk)
    );
  }

  return Buffer.concat(chunks);
}

function createHttpError(message, status = 500) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function normalizePlan(plan) {
  if (!plan) {
    return null;
  }

  return String(plan)
    .trim()
    .toLowerCase();
}

async function updateProfileByUserId(userId, values) {
  const {
    error
  } = await admin
    .from("profiles")
    .upsert(
      {
        id: userId,
        ...values,
        updated_at: new Date().toISOString()
      },
      {
        onConflict: "id"
      }
    );

  if (error) {
    throw error;
  }
}

async function updateProfileByCustomerId(customerId, values) {
  const {
    data,
    error
  } = await admin
    .from("profiles")
    .update({
      ...values,
      updated_at: new Date().toISOString()
    })
    .eq("stripe_customer_id", customerId)
    .select("id");

  if (error) {
    throw error;
  }

  if (!data || data.length === 0) {
    console.warn(
      "No profile found for Stripe customer:",
      customerId
    );
  }
}

async function handleCheckoutCompleted(session) {
  const userId =
    session.metadata?.user_id ||
    session.client_reference_id ||
    null;

  const plan = normalizePlan(
    session.metadata?.plan
  );

  const purchaseType =
    session.metadata?.purchase_type ||
    null;

  if (!userId) {
    throw createHttpError(
      "Checkout session is missing user_id metadata.",
      400
    );
  }

  const customerId = session.customer
    ? String(session.customer)
    : null;

  const isBuyout =
    session.mode === "payment" &&
    purchaseType === "buyout";

  if (isBuyout) {
    await updateProfileByUserId(userId, {
      stripe_customer_id: customerId,
      plan,
      website_bought_out: true,
      buyout_plan: plan,
      buyout_completed_at:
        new Date().toISOString()
    });

    return;
  }

  let subscriptionStatus = "active";
  let subscriptionId = null;

  if (session.subscription) {
    subscriptionId =
      String(session.subscription);

    const subscription =
      await stripe.subscriptions.retrieve(
        subscriptionId
      );

    subscriptionStatus =
      subscription.status || "active";
  }

  await updateProfileByUserId(userId, {
    stripe_customer_id: customerId,
    stripe_subscription_id:
      subscriptionId,
    plan,
    subscription_status:
      subscriptionStatus
  });
}

async function handleSubscriptionChange(subscription) {
  const customerId = subscription.customer
    ? String(subscription.customer)
    : null;

  if (!customerId) {
    throw createHttpError(
      "Subscription is missing a Stripe customer ID.",
      400
    );
  }

  const plan = normalizePlan(
    subscription.metadata?.plan
  );

  const values = {
    stripe_subscription_id:
      subscription.id
        ? String(subscription.id)
        : null,
    subscription_status:
      subscription.status || "inactive"
  };

  if (plan) {
    values.plan = plan;
  }

  if (
    subscription.status === "canceled" ||
    subscription.status === "unpaid" ||
    subscription.status === "incomplete_expired"
  ) {
    values.subscription_status =
      subscription.status;
  }

  await updateProfileByCustomerId(
    customerId,
    values
  );
}

async function handleInvoicePaymentFailed(invoice) {
  const customerId = invoice.customer
    ? String(invoice.customer)
    : null;

  if (!customerId) {
    return;
  }

  await updateProfileByCustomerId(
    customerId,
    {
      subscription_status: "past_due"
    }
  );
}

async function handleInvoicePaymentSucceeded(invoice) {
  const customerId = invoice.customer
    ? String(invoice.customer)
    : null;

  if (!customerId || !invoice.subscription) {
    return;
  }

  const subscription =
    await stripe.subscriptions.retrieve(
      String(invoice.subscription)
    );

  const values = {
    stripe_subscription_id:
      subscription.id
        ? String(subscription.id)
        : null,
    subscription_status:
      subscription.status || "active"
  };

  const plan = normalizePlan(
    subscription.metadata?.plan
  );

  if (plan) {
    values.plan = plan;
  }

  await updateProfileByCustomerId(
    customerId,
    values
  );
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");

    return res.status(405).json({
      error: "Method not allowed."
    });
  }

  try {
    const signature =
      req.headers["stripe-signature"];

    if (!signature) {
      throw createHttpError(
        "Missing Stripe signature.",
        400
      );
    }

    const webhookSecret =
      process.env.STRIPE_WEBHOOK_SECRET;

    if (!webhookSecret) {
      throw createHttpError(
        "STRIPE_WEBHOOK_SECRET is not configured.",
        500
      );
    }

    const body = await getRawBody(req);

    const event =
      stripe.webhooks.constructEvent(
        body,
        signature,
        webhookSecret
      );

    switch (event.type) {
      case "checkout.session.completed":
        await handleCheckoutCompleted(
          event.data.object
        );
        break;

      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted":
        await handleSubscriptionChange(
          event.data.object
        );
        break;

      case "invoice.payment_succeeded":
        await handleInvoicePaymentSucceeded(
          event.data.object
        );
        break;

      case "invoice.payment_failed":
        await handleInvoicePaymentFailed(
          event.data.object
        );
        break;

      case "customer.subscription.trial_will_end":
        break;

      default:
        console.log(
          "Unhandled Stripe event:",
          event.type
        );
        break;
    }

    return res.status(200).json({
      received: true
    });
  } catch (error) {
    console.error(
      "Stripe webhook error:",
      error
    );

    return res
      .status(error.status || 400)
      .json({
        error:
          error.message ||
          "Webhook processing failed."
      });
  }
}