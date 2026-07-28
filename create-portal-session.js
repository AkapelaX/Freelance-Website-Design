import { stripe, admin, authenticatedUser, assertServerConfig, sendJson } from "../_lib.js";
export default async function handler(req, res) {
  if (req.method !== "POST") { res.setHeader("Allow", "POST"); return sendJson(res, 405, { error: "Method not allowed." }); }
  try {
    assertServerConfig({ needsStripe: true });
    const user = await authenticatedUser(req);
    const { data, error } = await admin.from("profiles").select("*").eq("id", user.id).maybeSingle();
    if (error) throw error;
    if (!data?.stripe_customer_id) return sendJson(res, 400, { error: "No Stripe billing account is connected yet." });
    const origin = `${req.headers["x-forwarded-proto"] || "https"}://${req.headers.host}`;
    const session = await stripe.billingPortal.sessions.create({ customer: data.stripe_customer_id, return_url: req.body?.returnUrl || `${origin}/#billing` });
    return sendJson(res, 200, { url: session.url });
  } catch (error) {
    console.error("Portal API error:", error);
    return sendJson(res, error.status || 500, { error: error.message || "Billing portal could not be opened." });
  }
}
