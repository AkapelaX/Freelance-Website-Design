"use strict";

const { getAdmin } = require("./_supabase");
const { requireUser, requireProjectOwner } = require("./_auth");
const { getStripe, priceFor } = require("./_stripe");
const {
  ok,
  fail,
  method,
  action,
  parseJsonBody,
  text,
  publicBaseUrl,
  handleError
} = require("./_utils");

const FREE_TRIAL_DAYS = 7;

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

async function profileFor(user) {
  const supabase = getAdmin();

  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single();

  if (error && error.code !== "PGRST116") {
    throw error;
  }

  return data || {};
}

async function ensureCustomer(stripe, user, profile) {
  if (profile.stripe_customer_id) {
    return profile.stripe_customer_id;
  }

  const customer = await stripe.customers.create({
    email: user.email,
    name:
      profile.full_name ||
      user.user_metadata?.full_name ||
      undefined,
    metadata: {
      supabase_user_id: user.id
    }
  });

  const { error } = await getAdmin()
    .from("profiles")
    .upsert({
      id: user.id,
      email: user.email,
      stripe_customer_id: customer.id,
      updated_at: new Date().toISOString()
    });

  if (error) {
    throw error;
  }

  return customer.id;
}

function customerIdFromObject(object) {
  return typeof object?.customer === "string"
    ? object.customer
    : object?.customer?.id || null;
}

function subscriptionIdFromInvoice(object) {
  if (typeof object?.subscription === "string") {
    return object.subscription;
  }

  if (object?.subscription?.id) {
    return object.subscription.id;
  }

  return null;
}

async function getSubscriptionStatus(stripe, subscriptionId) {
  if (!subscriptionId) {
    return null;
  }

  try {
    const subscription = await stripe.subscriptions.retrieve(subscriptionId);

    return {
      id: subscription.id,
      status: subscription.status || null,
      customerId:
        typeof subscription.customer === "string"
          ? subscription.customer
          : subscription.customer?.id || null,
      plan: subscription.metadata?.plan || null
    };
  } catch (error) {
    console.error(
      "Unable to retrieve Stripe subscription:",
      subscriptionId,
      error.message
    );

    return null;
  }
}

async function applyWebhook(event, stripe) {
  const supabase = getAdmin();
  const object = event.data.object;

  /*
  =========================================================
  CHECKOUT COMPLETED
  =========================================================
  */

  if (event.type === "checkout.session.completed") {
    const userId = object.metadata?.user_id;
    const checkoutType = object.metadata?.checkout_type;
    const plan = object.metadata?.plan;
    const projectId = object.metadata?.project_id;

    if (checkoutType === "subscription" && userId) {
      const subscriptionId =
        typeof object.subscription === "string"
          ? object.subscription
          : object.subscription?.id || null;

      const subscription = await getSubscriptionStatus(
        stripe,
        subscriptionId
      );

      const { error } = await supabase
        .from("profiles")
        .update({
          stripe_customer_id:
            customerIdFromObject(object) ||
            subscription?.customerId ||
            null,
          stripe_subscription_id:
            subscription?.id ||
            subscriptionId ||
            null,
          plan:
            subscription?.plan ||
            plan ||
            null,
          subscription_status:
            subscription?.status ||
            "trialing",
          updated_at: new Date().toISOString()
        })
        .eq("id", userId);

      if (error) {
        throw error;
      }
    }

    if (
      checkoutType === "buyout" &&
      userId &&
      projectId
    ) {
      const { error } = await supabase
        .from("projects")
        .update({
          owned: true,
          buyout_session_id: object.id,
          updated_at: new Date().toISOString()
        })
        .eq("id", projectId)
        .eq("user_id", userId);

      if (error) {
        throw error;
      }
    }

    return;
  }

  /*
  =========================================================
  SUBSCRIPTION CREATED / UPDATED / DELETED
  =========================================================
  */

  if (
    event.type === "customer.subscription.created" ||
    event.type === "customer.subscription.updated" ||
    event.type === "customer.subscription.deleted"
  ) {
    const customerId = customerIdFromObject(object);

    if (!customerId) {
      return;
    }

    const subscriptionStatus =
      event.type === "customer.subscription.deleted"
        ? "canceled"
        : object.status;

    const plan = object.metadata?.plan || null;

    const updateData = {
      subscription_status: subscriptionStatus,
      stripe_subscription_id: object.id,
      updated_at: new Date().toISOString()
    };

    if (plan) {
      updateData.plan = plan;
    }

    const { error } = await supabase
      .from("profiles")
      .update(updateData)
      .eq("stripe_customer_id", customerId);

    if (error) {
      throw error;
    }

    return;
  }

  /*
  =========================================================
  FAILED / ACTION REQUIRED INVOICE
  =========================================================
  */

  if (
    event.type === "invoice.payment_failed" ||
    event.type === "invoice.payment_action_required"
  ) {
    const customerId = customerIdFromObject(object);

    if (!customerId) {
      return;
    }

    const { error } = await supabase
      .from("profiles")
      .update({
        subscription_status:
          event.type === "invoice.payment_failed"
            ? "past_due"
            : "incomplete",
        updated_at: new Date().toISOString()
      })
      .eq("stripe_customer_id", customerId);

    if (error) {
      throw error;
    }

    return;
  }

  /*
  =========================================================
  PAID INVOICE
  =========================================================
  */

  if (
    event.type === "invoice.paid" ||
    event.type === "invoice.payment_succeeded"
  ) {
    const customerId = customerIdFromObject(object);

    if (!customerId) {
      return;
    }

    const subscriptionId = subscriptionIdFromInvoice(object);
    const subscription = await getSubscriptionStatus(
      stripe,
      subscriptionId
    );

    const updateData = {
      updated_at: new Date().toISOString()
    };

    if (subscription?.status) {
      updateData.subscription_status = subscription.status;
    } else if ((object.amount_paid || 0) > 0) {
      updateData.subscription_status = "active";
    }

    if (subscription?.id) {
      updateData.stripe_subscription_id = subscription.id;
    }

    if (subscription?.plan) {
      updateData.plan = subscription.plan;
    }

    const { error } = await supabase
      .from("profiles")
      .update(updateData)
      .eq("stripe_customer_id", customerId);

    if (error) {
      throw error;
    }
  }
}

module.exports = async function handler(req, res) {
  try {
    const stripeSignature = req.headers["stripe-signature"];

    const name = stripeSignature
      ? "webhook"
      : action(req, "");

    /*
    =========================================================
    STRIPE WEBHOOK
    =========================================================
    */

    if (name === "webhook") {
      method(req, ["POST"]);

      const stripe = getStripe();

      if (!stripeSignature) {
        return fail(
          res,
          400,
          "Stripe signature header is missing"
        );
      }

      if (!process.env.STRIPE_WEBHOOK_SECRET) {
        return fail(
          res,
          500,
          "STRIPE_WEBHOOK_SECRET is missing"
        );
      }

      const payload = await rawBody(req);

      let event;

      try {
        event = stripe.webhooks.constructEvent(
          payload,
          stripeSignature,
          process.env.STRIPE_WEBHOOK_SECRET
        );
      } catch (error) {
        return fail(
          res,
          400,
          `Webhook signature failed: ${error.message}`
        );
      }

      await applyWebhook(event, stripe);

      return ok(res, {
        received: true,
        event: event.type
      });
    }

    /*
    =========================================================
    AUTHENTICATED BILLING ACTIONS
    =========================================================
    */

    const body = parseJsonBody(req);
    const user = await requireUser(req);
    const stripe = getStripe();
    const profile = await profileFor(user);

    /*
    =========================================================
    BILLING STATUS
    =========================================================
    */

    if (name === "status") {
      method(req, ["GET"]);

      return ok(res, {
        plan: profile.plan || "starter",
        subscription_status:
          profile.subscription_status || "inactive",
        stripe_customer_id:
          profile.stripe_customer_id || null,
        stripe_subscription_id:
          profile.stripe_subscription_id || null
      });
    }

    /*
    =========================================================
    STRIPE CUSTOMER
    =========================================================
    */

    const customerId = await ensureCustomer(
      stripe,
      user,
      profile
    );

    /*
    =========================================================
    CHECKOUT
    =========================================================
    */

    if (
      name === "subscription-checkout" ||
      name === "buyout-checkout"
    ) {
      method(req, ["POST"]);

      const checkoutType =
        name === "buyout-checkout"
          ? "buyout"
          : "subscription";

      const plan = [
        "starter",
        "professional",
        "advanced"
      ].includes(body.plan)
        ? body.plan
        : "starter";

      const projectId = text(
        body.project_id,
        80
      );

      if (checkoutType === "buyout") {
        if (!projectId) {
          return fail(
            res,
            400,
            "project_id is required for a buyout"
          );
        }

        await requireProjectOwner(
          projectId,
          user.id
        );
      }

      const sessionOptions = {
        customer: customerId,

        mode:
          checkoutType === "subscription"
            ? "subscription"
            : "payment",

        line_items: [
          {
            price: priceFor(
              plan,
              checkoutType
            ),
            quantity: 1
          }
        ],

        success_url:
          text(body.success_url, 1000) ||
          `${publicBaseUrl(
            req
          )}/#billing?checkout=success`,

        cancel_url:
          text(body.cancel_url, 1000) ||
          `${publicBaseUrl(
            req
          )}/#billing?checkout=canceled`,

        metadata: {
          user_id: user.id,
          plan,
          checkout_type: checkoutType,
          project_id: projectId || ""
        }
      };

      if (checkoutType === "subscription") {
        sessionOptions.allow_promotion_codes = true;

        sessionOptions.subscription_data = {
          trial_period_days: FREE_TRIAL_DAYS,
          metadata: {
            user_id: user.id,
            plan
          }
        };
      }

      const session =
        await stripe.checkout.sessions.create(
          sessionOptions
        );

      return ok(res, {
        url: session.url,
        id: session.id
      });
    }

    /*
    =========================================================
    STRIPE CUSTOMER PORTAL
    =========================================================
    */

    if (name === "portal") {
      method(req, ["POST"]);

      const portal =
        await stripe.billingPortal.sessions.create({
          customer: customerId,

          return_url:
            text(body.return_url, 1000) ||
            `${publicBaseUrl(req)}/#billing`
        });

      return ok(res, {
        url: portal.url
      });
    }

    return fail(
      res,
      404,
      "Unknown billing action"
    );
  } catch (error) {
    return handleError(res, error);
  }
};

module.exports.config = {
  api: {
    bodyParser: false
  }
};