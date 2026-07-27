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

async function updateProfileByUserId(userId, values) {
  const {
    error
  } = await admin
    .from("profiles")
    .upsert(
      {
        id: userId,
        ...values
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
    error
  } = await admin
    .from("profiles")
    .update(values)
    .eq("stripe_customer_id", customerId);

  if (error) {
    throw error;
  }
}

async function handleCheckoutCompleted(session) {
  const userId =
    session.metadata?.user_id ||
    session.client_reference_id;

  const plan =
    session.metadata?.plan || null;

  const purchaseType =
    session.metadata?.purchase_type;

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

  if (session.subscription) {
    const subscription =
      await stripe.subscriptions.retrieve(
        String(session.subscription)
      );

    subscriptionStatus =
      subscription.status || "active";
  }

  await updateProfileByUserId(userId, {
    stripe_customer_id: customerId,
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

  const values = {
    subscription_status:
      subscription.status
  };

  if (subscription.metadata?.plan) {
    values.plan =
      subscription.metadata.plan;
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

  await updateProfileByCustomerId(
    customerId,
    {
      subscription_status:
        subscription.status
    }
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

      default:
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