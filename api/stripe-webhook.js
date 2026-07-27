import { stripe, admin, assertServerConfig, planFromPriceId } from "./_lib.js";
export const config = { api: { bodyParser: false } };
async function rawBody(req) { const chunks=[]; for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk)); return Buffer.concat(chunks); }
async function byCustomer(customerId, values) { const { error } = await admin.from("profiles").update(values).eq("stripe_customer_id", customerId); if (error) throw error; }
export default async function handler(req, res) {
  if (req.method !== "POST") { res.setHeader("Allow", "POST"); return res.status(405).json({ error: "Method not allowed." }); }
  try {
    assertServerConfig({ needsStripe: true });
    if (!process.env.STRIPE_WEBHOOK_SECRET) throw new Error("STRIPE_WEBHOOK_SECRET is not configured.");
    const event = stripe.webhooks.constructEvent(await rawBody(req), req.headers["stripe-signature"], process.env.STRIPE_WEBHOOK_SECRET);
    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      const userId = session.metadata?.user_id || session.client_reference_id;
      if (userId) {
        const buyout = session.mode === "payment" && session.metadata?.purchase_type === "buyout";
        let status = buyout ? "bought_out" : "active";
        let plan = session.metadata?.plan || null;
        if (session.subscription) {
          const sub = await stripe.subscriptions.retrieve(String(session.subscription));
          status = sub.status; plan = plan || sub.metadata?.plan || planFromPriceId(sub.items.data[0]?.price?.id);
        }
        const values = { id:userId, stripe_customer_id:session.customer?String(session.customer):null, plan, subscription_status:status };
        if (buyout) Object.assign(values,{ website_bought_out:true,buyout_plan:plan,buyout_completed_at:new Date().toISOString() });
        const { error } = await admin.from("profiles").upsert(values,{onConflict:"id"}); if(error) throw error;
      }
    }
    if (["customer.subscription.created","customer.subscription.updated","customer.subscription.deleted"].includes(event.type)) {
      const sub=event.data.object; const priceId=sub.items.data[0]?.price?.id;
      const values={subscription_status:sub.status}; const plan=sub.metadata?.plan||planFromPriceId(priceId); if(plan)values.plan=plan;
      await byCustomer(String(sub.customer),values);
    }
    if (event.type === "invoice.payment_failed") await byCustomer(String(event.data.object.customer),{subscription_status:"past_due"});
    if (event.type === "invoice.payment_succeeded" && event.data.object.subscription) {
      const sub=await stripe.subscriptions.retrieve(String(event.data.object.subscription)); await byCustomer(String(sub.customer),{subscription_status:sub.status});
    }
    return res.status(200).json({ received:true });
  } catch (error) { console.error("Stripe webhook error:",error); return res.status(error.status||400).json({error:error.message||"Webhook processing failed."}); }
}
