"use strict";

import {
  stripe,
  admin,
  assertServerConfig,
  planFromPriceId
} from "./_lib.js";

export const config = {
  api: {
    bodyParser: false
  }
};

function text(value) {
  return typeof value === "string"
    ? value.trim()
    : "";
}

function isObject(value) {
  return Boolean(
    value &&
    typeof value === "object" &&
    !Array.isArray(value)
  );
}

async function rawBody(req) {
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

function sendJson(res, status, payload) {
  res.status(status);
  res.setHeader(
    "Content-Type",
    "application/json; charset=utf-8"
  );
  res.setHeader(
    "Cache-Control",
    "no-store, no-cache, must-revalidate, max-age=0"
  );

  return res.end(
    JSON.stringify(payload)
  );
}

function firstSubscriptionItem(subscription) {
  return (
    subscription?.items?.data?.[0] ||
    null
  );
}

function subscriptionPlan(subscription) {
  const item =
    firstSubscriptionItem(subscription);

  return (
    text(subscription?.metadata?.plan) ||
    planFromPriceId(
      item?.price?.id
    ) ||
    null
  );
}

function checkoutPlan(session) {
  return (
    text(session?.metadata?.plan) ||
    null
  );
}

function checkoutUserId(session) {
  return text(
    session?.metadata?.user_id ||
    session?.client_reference_id
  );
}

function checkoutProjectId(session) {
  return text(
    session?.metadata?.project_id ||
    session?.metadata?.projectId ||
    session?.metadata?.website_id ||
    session?.metadata?.websiteId
  );
}

function customerIdFrom(value) {
  if (typeof value === "string") {
    return value;
  }

  if (
    value &&
    typeof value === "object"
  ) {
    return text(value.id);
  }

  return "";
}

function subscriptionIdFrom(value) {
  if (typeof value === "string") {
    return value;
  }

  if (
    value &&
    typeof value === "object"
  ) {
    return text(value.id);
  }

  return "";
}

async function updateProfileByCustomer(
  customerId,
  values
) {
  if (!customerId) {
    return;
  }

  const {
    error
  } = await admin
    .from("profiles")
    .update(values)
    .eq(
      "stripe_customer_id",
      customerId
    );

  if (error) {
    throw error;
  }
}

async function upsertProfileByUser(
  userId,
  values
) {
  if (!userId) {
    return;
  }

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

async function getOwnedProject(
  projectId,
  userId
) {
  const {
    data,
    error
  } = await admin
    .from("projects")
    .select(
      [
        "id",
        "user_id",
        "name",
        "plan",
        "project_data",
        "website_bought_out",
        "buyout_plan",
        "buyout_completed_at",
        "updated_at"
      ].join(",")
    )
    .eq("id", projectId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  if (!data) {
    const error = new Error(
      "The website connected to this buyout was not found."
    );

    error.status = 404;
    throw error;
  }

  return data;
}

function buyoutProjectData(
  project,
  {
    plan,
    completedAt
  }
) {
  const source =
    isObject(project.project_data)
      ? project.project_data
      : {};

  const backend =
    isObject(source.backend)
      ? source.backend
      : {};

  return {
    ...source,

    backend: {
      ...backend,
      websiteId: project.id,
      userId: project.user_id,
      websiteBoughtOut: true,
      buyoutPlan:
        plan ||
        project.plan ||
        null,
      buyoutCompletedAt:
        completedAt,
      updatedAt:
        completedAt
    }
  };
}

async function completeWebsiteBuyout(
  session
) {
  const userId =
    checkoutUserId(session);

  const projectId =
    checkoutProjectId(session);

  if (!userId) {
    throw new Error(
      "Buyout checkout is missing user_id metadata."
    );
  }

  if (!projectId) {
    throw new Error(
      "Buyout checkout is missing project_id metadata."
    );
  }

  const project =
    await getOwnedProject(
      projectId,
      userId
    );

  const completedAt =
    new Date().toISOString();

  const plan =
    checkoutPlan(session) ||
    project.plan ||
    null;

  const {
    error
  } = await admin
    .from("projects")
    .update({
      website_bought_out: true,
      buyout_plan: plan,
      buyout_completed_at:
        project.buyout_completed_at ||
        completedAt,
      project_data:
        buyoutProjectData(
          project,
          {
            plan,
            completedAt:
              project.buyout_completed_at ||
              completedAt
          }
        ),
      updated_at:
        completedAt
    })
    .eq("id", project.id)
    .eq(
      "user_id",
      project.user_id
    );

  if (error) {
    throw error;
  }

  const customerId =
    customerIdFrom(
      session.customer
    );

  await upsertProfileByUser(
    userId,
    {
      stripe_customer_id:
        customerId ||
        null
    }
  );
}

async function completeSubscriptionCheckout(
  session
) {
  const userId =
    checkoutUserId(session);

  if (!userId) {
    return;
  }

  const customerId =
    customerIdFrom(
      session.customer
    );

  const subscriptionId =
    subscriptionIdFrom(
      session.subscription
    );

  let plan =
    checkoutPlan(session);

  let subscriptionStatus =
    "active";

  if (subscriptionId) {
    const subscription =
      await stripe.subscriptions.retrieve(
        subscriptionId
      );

    subscriptionStatus =
      subscription.status;

    plan =
      plan ||
      subscriptionPlan(
        subscription
      );
  }

  await upsertProfileByUser(
    userId,
    {
      stripe_customer_id:
        customerId ||
        null,
      plan:
        plan ||
        null,
      subscription_status:
        subscriptionStatus
    }
  );
}

async function handleCheckoutCompleted(
  session
) {
  const isBuyout =
    session.mode === "payment" &&
    text(
      session.metadata?.purchase_type
    ).toLowerCase() === "buyout";

  if (isBuyout) {
    await completeWebsiteBuyout(
      session
    );

    return;
  }

  if (
    session.mode === "subscription"
  ) {
    await completeSubscriptionCheckout(
      session
    );
  }
}

async function handleSubscriptionChanged(
  subscription
) {
  const customerId =
    customerIdFrom(
      subscription.customer
    );

  if (!customerId) {
    return;
  }

  const values = {
    subscription_status:
      subscription.status
  };

  const plan =
    subscriptionPlan(
      subscription
    );

  if (plan) {
    values.plan = plan;
  }

  await updateProfileByCustomer(
    customerId,
    values
  );
}

async function handleInvoicePaymentFailed(
  invoice
) {
  const customerId =
    customerIdFrom(
      invoice.customer
    );

  await updateProfileByCustomer(
    customerId,
    {
      subscription_status:
        "past_due"
    }
  );
}

async function handleInvoicePaymentSucceeded(
  invoice
) {
  const subscriptionId =
    subscriptionIdFrom(
      invoice.subscription
    );

  if (!subscriptionId) {
    return;
  }

  const subscription =
    await stripe.subscriptions.retrieve(
      subscriptionId
    );

  await handleSubscriptionChanged(
    subscription
  );
}

export default async function handler(
  req,
  res
) {
  if (req.method !== "POST") {
    res.setHeader(
      "Allow",
      "POST"
    );

    return sendJson(
      res,
      405,
      {
        error:
          "Method not allowed."
      }
    );
  }

  try {
    assertServerConfig({
      needsStripe: true
    });

    const webhookSecret =
      text(
        process.env
          .STRIPE_WEBHOOK_SECRET
      );

    if (!webhookSecret) {
      throw new Error(
        "STRIPE_WEBHOOK_SECRET is not configured."
      );
    }

    const signature =
      req.headers[
        "stripe-signature"
      ];

    if (!signature) {
      return sendJson(
        res,
        400,
        {
          error:
            "Stripe signature is missing."
        }
      );
    }

    const body =
      await rawBody(req);

    const event =
      stripe.webhooks.constructEvent(
        body,
        signature,
        webhookSecret
      );

    switch (event.type) {
      case "checkout.session.completed":
      case "checkout.session.async_payment_succeeded":
        await handleCheckoutCompleted(
          event.data.object
        );
        break;

      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted":
        await handleSubscriptionChanged(
          event.data.object
        );
        break;

      case "invoice.payment_failed":
        await handleInvoicePaymentFailed(
          event.data.object
        );
        break;

      case "invoice.payment_succeeded":
        await handleInvoicePaymentSucceeded(
          event.data.object
        );
        break;

      default:
        break;
    }

    return sendJson(
      res,
      200,
      {
        received: true
      }
    );
  } catch (error) {
    console.error(
      "Stripe webhook error:",
      error
    );

    return sendJson(
      res,
      Number.isInteger(error?.status)
        ? error.status
        : 400,
      {
        error:
          error?.message ||
          "Webhook processing failed."
      }
    );
  }
}