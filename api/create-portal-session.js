import {stripe,admin,requireUser,sendError} from "./api/_lib.js";
export default async function handler(req,res){
  if(req.method!=="POST") return res.status(405).json({error:"Method not allowed."});
  try{const user=await requireUser(req);const {data}=await admin.from("profiles").select("stripe_customer_id").eq("id",user.id).single();if(!data?.stripe_customer_id)throw Object.assign(new Error("No Stripe customer exists yet."),{status:400});const session=await stripe.billingPortal.sessions.create({customer:data.stripe_customer_id,return_url:req.body?.returnUrl||req.headers.origin});res.status(200).json({url:session.url});}catch(error){sendError(res,error);}
}
