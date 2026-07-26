import {admin,requireUser,sendError} from "./_lib.js";
export default async function handler(req,res){
  try{const user=await requireUser(req);const [{data:profile},{data:project}]=await Promise.all([admin.from("profiles").select("plan,subscription_status,website_bought_out,buyout_plan,buyout_completed_at").eq("id",user.id).maybeSingle(),admin.from("projects").select("name").eq("user_id",user.id).maybeSingle()]);res.status(200).json({plan:profile?.plan||null,subscriptionStatus:profile?.subscription_status||null,projectName:project?.name||null,websiteBoughtOut:!!profile?.website_bought_out,buyoutPlan:profile?.buyout_plan||null,buyoutCompletedAt:profile?.buyout_completed_at||null});}catch(error){sendError(res,error);}
}
