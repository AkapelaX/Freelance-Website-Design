import {admin,requireUser,sendError} from "./_lib.js";
export default async function handler(req,res){
  try{const user=await requireUser(req);
    if(req.method==="GET"){const {data,error}=await admin.from("projects").select("project_data").eq("user_id",user.id).order("updated_at",{ascending:false}).limit(1).maybeSingle();if(error)throw error;return res.status(200).json({project:data?.project_data||null});}
    if(req.method==="POST"){const project=req.body?.project;if(!project)throw Object.assign(new Error("Project data is required."),{status:400});const payload={user_id:user.id,name:project.business?.name||"My Website",slug:project.project?.slug||null,plan:project.plan||"starter",project_data:project,updated_at:new Date().toISOString()};const {error}=await admin.from("projects").upsert(payload,{onConflict:"user_id"});if(error)throw error;return res.status(200).json({saved:true});}
    return res.status(405).json({error:"Method not allowed."});
  }catch(error){sendError(res,error);}
}
