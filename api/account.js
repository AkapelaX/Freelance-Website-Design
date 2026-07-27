import { admin, stripe, authenticatedUser, assertServerConfig, sendJson, planFromPriceId } from "./_lib.js";

const activeStatuses = new Set(["active", "trialing"]);
function normalizeProfile(profile = {}) {
  return {
    plan: profile.plan || null,
    subscriptionStatus: profile.subscription_status || "inactive",
    stripeCustomerId: profile.stripe_customer_id || null,
    websiteBoughtOut: Boolean(profile.website_bought_out),
    buyoutPlan: profile.buyout_plan || null,
    buyoutCompletedAt: profile.buyout_completed_at || null
  };
}
async function recoverStripeAccount(user, account) {
  if (!process.env.STRIPE_SECRET_KEY) return account;
  let customerId = account.stripeCustomerId;
  if (!customerId && user.email) {
    const customers = await stripe.customers.list({ email: user.email, limit: 10 });
    const customer = customers.data.find(item => !item.deleted) || customers.data[0];
    customerId = customer?.id || null;
  }
  if (!customerId) return account;
  const subscriptions = await stripe.subscriptions.list({ customer: customerId, status: "all", limit: 20 });
  const subscription = subscriptions.data.find(item => activeStatuses.has(item.status)) || subscriptions.data[0];
  if (!subscription) return { ...account, stripeCustomerId: customerId };
  const priceId = subscription.items.data[0]?.price?.id || "";
  const plan = subscription.metadata?.plan || planFromPriceId(priceId) || account.plan;
  const recovered = { ...account, stripeCustomerId: customerId, plan, subscriptionStatus: subscription.status };
  await admin.from("profiles").upsert({ id: user.id, stripe_customer_id: customerId, plan, subscription_status: subscription.status }, { onConflict: "id" });
  return recovered;
}
export default async function handler(req, res) {
  if (req.method !== "GET") { res.setHeader("Allow", "GET"); return sendJson(res, 405, { error: "Method not allowed." }); }
  try {
    assertServerConfig();
    const user = await authenticatedUser(req);
    const { data, error } = await admin.from("profiles").select("*").eq("id", user.id).maybeSingle();
    if (error) throw error;
    let account = normalizeProfile(data || {});
    account = await recoverStripeAccount(user, account);
    const subscribed = activeStatuses.has(String(account.subscriptionStatus).toLowerCase());
    return sendJson(res, 200, {
      signedIn: true, user: { id: user.id, email: user.email || null },
      plan: account.plan, subscriptionStatus: account.subscriptionStatus,
      subscribed, activeSubscription: subscribed, hasActivePlan: subscribed,
      stripeCustomerId: account.stripeCustomerId,
      websiteBoughtOut: account.websiteBoughtOut, buyoutPlan: account.buyoutPlan,
      buyoutCompletedAt: account.buyoutCompletedAt
    });
  } catch (error) {
    console.error("Account API error:", error);
    return sendJson(res, error.status || 500, { signedIn: false, error: error.message || "Unable to load account information." });
  }
}
