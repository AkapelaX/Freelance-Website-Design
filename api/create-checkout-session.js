import {stripe,admin,requireUser,sendError} from "./_lib.js";
const prices={
  starter:{annual:process.env.STRIPE_PRICE_STARTER_ANNUAL,buyout:process.env.STRIPE_PRICE_STARTER_BUYOUT},
  professional:{annual:process.env.STRIPE_PRICE_PROFESSIONAL_ANNUAL,buyout:process.env.STRIPE_PRICE_PROFESSIONAL_BUYOUT},
  advanced:{annual:process.env.STRIPE_PRICE_ADVANCED_ANNUAL,buyout:process.env.STRIPE_PRICE_ADVANCED_BUYOUT}
};
export default async function handler(req,res){
  if(req.method!=="POST") return res.status(405).json({error:"Method not allowed."});
  try{
    const user=await requireUser(req); const {plan,purchaseType="annual",successUrl,cancelUrl}=req.body||{};
    const price=prices[plan]?.[purchaseType]; if(!price) throw Object.assign(new Error("Stripe price is not configured for this selection."),{status:400});
    const {data:profile}=await admin.from("profiles").select("stripe_customer_id").eq("id",user.id).maybeSingle();
    let customer=profile?.stripe_customer_id;
    if(!customer){
      const created=await stripe.customers.create({email:user.email,metadata:{supabase_user_id:user.id}}); customer=created.id;
      await admin.from("profiles").upsert({id:user.id,email:user.email,stripe_customer_id:customer},{onConflict:"id"});
    }
    const recurring=purchaseType==="annual";
    const session=await stripe.checkout.sessions.create({
      customer, mode:recurring?"subscription":"payment", line_items:[{price,quantity:1}],
      subscription_data:recurring?{trial_period_days:7,metadata:{plan,user_id:user.id}}:undefined,
      metadata:{plan,purchase_type:purchaseType,user_id:user.id},
      success_url:successUrl||`${req.headers.origin}/#account`, cancel_url:cancelUrl||req.headers.origin
    });
    res.status(200).json({url:session.url});
  }catch(error){sendError(res,error);}
}
