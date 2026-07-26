import {stripe,admin} from "./_lib.js";
export const config={api:{bodyParser:false}};
async function rawBody(req){const chunks=[];for await(const chunk of req)chunks.push(Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk));return Buffer.concat(chunks);}
export default async function handler(req,res){
  if(req.method!=="POST")return res.status(405).end();
  try{const body=await rawBody(req);const event=stripe.webhooks.constructEvent(body,req.headers["stripe-signature"],process.env.STRIPE_WEBHOOK_SECRET);
    if(event.type==="checkout.session.completed"){const session=event.data.object;const userId=session.metadata?.user_id; if(userId){
      const isBuyout=session.mode==="payment"&&session.metadata?.purchase_type==="buyout";
      await admin.from("profiles").upsert({
        id:userId,
        stripe_customer_id:session.customer,
        plan:session.metadata?.plan,
        subscription_status:isBuyout?"bought_out":"trialing",
        website_bought_out:isBuyout,
        buyout_plan:isBuyout?session.metadata?.plan:null,
        buyout_completed_at:isBuyout?new Date().toISOString():null
      },{onConflict:"id"});
    }}
    if(event.type==="customer.subscription.updated"||event.type==="customer.subscription.deleted"){const sub=event.data.object;const customer=String(sub.customer);await admin.from("profiles").update({subscription_status:sub.status}).eq("stripe_customer_id",customer);}
    res.status(200).json({received:true});
  }catch(error){res.status(400).json({error:error.message});}
}
