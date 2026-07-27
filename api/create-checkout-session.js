import { stripe, admin, authenticatedUser, assertServerConfig, sendJson } from "./_lib.js";
const prices = {
  starter: { annual: "STRIPE_PRICE_STARTER_ANNUAL", buyout: "STRIPE_PRICE_STARTER_BUYOUT" },
  professional: { annual: "STRIPE_PRICE_PROFESSIONAL_ANNUAL", buyout: "STRIPE_PRICE_PROFESSIONAL_BUYOUT" },
  advanced: { annual: "STRIPE_PRICE_ADVANCED_ANNUAL", buyout: "STRIPE_PRICE_ADVANCED_BUYOUT" }
};
export default async function handler(req, res) {
  if (req.method !== "POST") { res.setHeader("Allow", "POST"); return sendJson(res, 405, { error: "Method not allowed." }); }
  try {
    assertServerConfig({ needsStripe: true });
    const user = await authenticatedUser(req);
    const plan = String(req.body?.plan || "starter").toLowerCase();
    const purchaseType = String(req.body?.purchaseType || "annual").toLowerCase();
    if (!prices[plan] || !["annual", "buyout"].includes(purchaseType)) return sendJson(res, 400, { error: "Invalid plan or purchase type." });
    const priceId = process.env[prices[plan][purchaseType]];
    if (!priceId) throw new Error(`Stripe price is not configured for ${plan} ${purchaseType}.`);
    const { data: profile } = await admin.from("profiles").select("*").eq("id", user.id).maybeSingle();
    let customerId = profile?.stripe_customer_id || null;
    if (!customerId) {
      const customer = await stripe.customers.create({ email: user.email, metadata: { user_id: user.id } });
      customerId = customer.id;
      await admin.from("profiles").upsert({ id: user.id, stripe_customer_id: customerId }, { onConflict: "id" });
    }
    const origin = `${req.headers["x-forwarded-proto"] || "https"}://${req.headers.host}`;
    const metadata = { user_id: user.id, plan, purchase_type: purchaseType };
    if (req.body?.websiteId) metadata.website_id = String(req.body.websiteId);
    const session = await stripe.checkout.sessions.create({
      customer: customerId, mode: purchaseType === "buyout" ? "payment" : "subscription",
      line_items: [{ price: priceId, quantity: 1 }], metadata, client_reference_id: user.id,
      success_url: req.body?.successUrl || `${origin}/#projects?checkout=success`,
      cancel_url: req.body?.cancelUrl || `${origin}/#billing`
    });
    return sendJson(res, 200, { url: session.url });
  } catch (error) {
    console.error("Checkout API error:", error);
    return sendJson(res, error.status || 500, { error: error.message || "Checkout could not be started." });
  }
}
