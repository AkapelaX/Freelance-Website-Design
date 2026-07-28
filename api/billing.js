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

async function rawBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks);
}

async function profileFor(user) {
  const supabase = getAdmin();
  const { data } = await supabase.from("profiles").select("*").eq("id", user.id).single();
  return data || {};
}

async function ensureCustomer(stripe, user, profile) {
  if (profile.stripe_customer_id) return profile.stripe_customer_id;
  const customer = await stripe.customers.create({
    email: user.email,
    name: profile.full_name || user.user_metadata?.full_name || undefined,
    metadata: { supabase_user_id: user.id }
  });
  await getAdmin().from("profiles").upsert({
    id: user.id,
    email: user.email,
    stripe_customer_id: customer.id,
    updated_at: new Date().toISOString()
  });
  return customer.id;
}

async function applyWebhook(event) {
  const supabase = getAdmin();
  const object = event.data.object;

  if (event.type === "checkout.session.completed") {
    const userId = object.metadata?.user_id;
    const checkoutType = object.metadata?.checkout_type;
    const plan = object.metadata?.plan;

    if (checkoutType === "subscription" && userId) {
      await supabase.from("profiles").update({
        stripe_customer_id: object.customer,
        stripe_subscription_id: object.subscription,
        plan,
        subscription_status: "active",
        updated_at: new Date().toISOString()
      }).eq("id", userId);
    }

    if (checkoutType === "buyout" && userId && object.metadata?.project_id) {
      await supabase.from("projects").update({
        owned: true,
        buyout_session_id: object.id,
        updated_at: new Date().toISOString()
      })
      .eq("id", object.metadata.project_id)
      .eq("user_id", userId);
    }
  }

  if (event.type === "customer.subscription.updated" ||
      event.type === "customer.subscription.deleted") {
    const status = object.status;
    await supabase.from("profiles").update({
      subscription_status: status,
      stripe_subscription_id: object.id,
      updated_at: new Date().toISOString()
    }).eq("stripe_customer_id", object.customer);
  }
}

module.exports = async function handler(req, res) {
  try {
    const name = action(req, "");

    if (name === "webhook") {
      method(req, ["POST"]);
      const stripe = getStripe();
      const signature = req.headers["stripe-signature"];
      if (!process.env.STRIPE_WEBHOOK_SECRET) return fail(res, 500, "STRIPE_WEBHOOK_SECRET is missing");
      const payload = await rawBody(req);
      let event;
      try {
        event = stripe.webhooks.constructEvent(
          payload,
          signature,
          process.env.STRIPE_WEBHOOK_SECRET
        );
      } catch (error) {
        return fail(res, 400, `Webhook signature failed: ${error.message}`);
      }
      await applyWebhook(event);
      return ok(res, { received: true });
    }

    const body = parseJsonBody(req);
    const user = await requireUser(req);
    const stripe = getStripe();
    const profile = await profileFor(user);
    const customerId = await ensureCustomer(stripe, user, profile);

    if (name === "subscription-checkout" || name === "buyout-checkout") {
      method(req, ["POST"]);
      const checkoutType = name === "buyout-checkout" ? "buyout" : "subscription";
      const plan = ["starter", "professional", "advanced"].includes(body.plan)
        ? body.plan
        : "starter";
      const projectId = text(body.project_id, 80);

      if (checkoutType === "buyout") {
        if (!projectId) return fail(res, 400, "project_id is required for a buyout");
        await requireProjectOwner(projectId, user.id);
      }

      const session = await stripe.checkout.sessions.create({
        customer: customerId,
        mode: checkoutType === "subscription" ? "subscription" : "payment",
        line_items: [{ price: priceFor(plan, checkoutType), quantity: 1 }],
        success_url: text(body.success_url, 1000) ||
          `${publicBaseUrl(req)}/#billing?checkout=success`,
        cancel_url: text(body.cancel_url, 1000) ||
          `${publicBaseUrl(req)}/#billing?checkout=canceled`,
        allow_promotion_codes: checkoutType === "subscription",
        metadata: {
          user_id: user.id,
          plan,
          checkout_type: checkoutType,
          project_id: projectId || ""
        },
        subscription_data: checkoutType === "subscription"
          ? { metadata: { user_id: user.id, plan } }
          : undefined
      });

      return ok(res, { url: session.url, id: session.id });
    }

    if (name === "portal") {
      method(req, ["POST"]);
      const portal = await stripe.billingPortal.sessions.create({
        customer: customerId,
        return_url: text(body.return_url, 1000) || `${publicBaseUrl(req)}/#billing`
      });
      return ok(res, { url: portal.url });
    }

    if (name === "status") {
      method(req, ["GET"]);
      return ok(res, {
        plan: profile.plan || "starter",
        subscription_status: profile.subscription_status || "inactive",
        stripe_customer_id: profile.stripe_customer_id || null
      });
    }

    return fail(res, 404, "Unknown billing action");
  } catch (error) {
    return handleError(res, error);
  }
};

module.exports.config = {
  api: {
    bodyParser: false
  }
};
