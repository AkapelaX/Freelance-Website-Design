import { createClient } from "@supabase/supabase-js";
import Stripe from "stripe";
export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || "sk_test_missing");
export const admin = createClient(process.env.SUPABASE_URL || "https://invalid.supabase.co", process.env.SUPABASE_SERVICE_ROLE_KEY || "missing", {auth:{persistSession:false}});
export async function requireUser(req){
  const token=(req.headers.authorization||"").replace(/^Bearer\s+/i,"");
  if(!token) throw Object.assign(new Error("Sign in required."),{status:401});
  const {data,error}=await admin.auth.getUser(token);
  if(error||!data.user) throw Object.assign(new Error("Invalid session."),{status:401});
  return data.user;
}
export function sendError(res,error){res.status(error.status||500).json({error:error.message||"Server error."});}
