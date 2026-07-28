/* =========================================================
   BLUVIXA MASTER FRONTEND
   Consolidated: platform, domain manager, and visual builder.
   ========================================================= */
(function(){
"use strict";

/* =========================================================
   BLUVIXA 11.0 PUBLISHING CENTER CONTROLLER
   One router, one authentication controller, one project library.
   Supabase and Stripe API routes remain unchanged.
   ========================================================= */

var supabaseClient=null;
var currentUser=null;
var accountData=null;
var authMode="signin";
var initialized=false;

var PROJECTS_KEY="bluvixa_projects_v6";
var SNAPSHOTS_KEY="bluvixa_snapshots_v6";
var ACTIVE_PROJECT_KEY="bluvixa_active_project_v6";
var draftFilter="all";

var projectsCache=[];
var snapshotsCache=[];
var cloudWorkspaceLoaded=false;
var cloudSyncTimer=null;
var cloudRecordIds=new Set();
var lastCloudError="";

var AUTOSAVE_DELAY=1600;
var autosaveTimer=null;
var autosaveInFlight=false;
var autosaveQueued=false;
var autosaveEnabled=true;
var suppressAutosaveUntil=0;
var lastAutosaveSignature="";
var lastOpenedProjectKey="bluvixa_last_opened_project_v9";
var publishingCenterProjectId="";
var publishingProgressTimer=null;
var publishingProgressValue=0;
var MEDIA_BUCKET="website-assets";
var MEDIA_SIGNED_URL_SECONDS=315360000;
var mediaUploadInFlight=0;

function id(name){return document.getElementById(name);}
function all(selector){return Array.prototype.slice.call(document.querySelectorAll(selector));}
function text(name,value){var node=id(name);if(node)node.textContent=value==null?"":String(value);}
function withTimeout(promise,timeoutMs,label){
  return Promise.race([
    promise,
    new Promise(function(_resolve,reject){
      setTimeout(function(){reject(new Error((label||"Request")+" timed out."));},timeoutMs||12000);
    })
  ]);
}
function escapeHtml(value){
  return String(value==null?"":value).replace(/[&<>"']/g,function(character){
    return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[character];
  });
}
function toast(message){
  var node=id("toast");
  if(!node){alert(message);return;}
  node.textContent=message;
  node.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer=setTimeout(function(){node.classList.remove("show");},2800);
}
function setSaveStatus(message,mode){
  var label=id("saveStatus");
  var wrapper=label&&label.closest(".builder-save-status");
  if(label)label.textContent=message||"";
  if(wrapper){
    wrapper.classList.toggle("is-saving",mode==="saving");
    wrapper.classList.toggle("is-error",mode==="error");
  }
}
function stableSignature(value){
  try{return JSON.stringify(value||{});}
  catch(_error){return String(Date.now());}
}
function scheduleAutosave(reason){
  if(!autosaveEnabled||!currentUser||!supabaseClient)return;
  if(Date.now()<suppressAutosaveUntil)return;
  if(routeName()!=="builder")return;
  clearTimeout(autosaveTimer);
  setSaveStatus("Unsaved changes","saving");
  autosaveTimer=setTimeout(function(){void runAutosave(reason||"change");},AUTOSAVE_DELAY);
}
async function runAutosave(_reason){
  if(!autosaveEnabled||!currentUser||!supabaseClient)return false;
  if(autosaveInFlight){autosaveQueued=true;return false;}
  var state=currentBuilderState();
  if(!state)return false;
  var signature=stableSignature(state);
  if(signature===lastAutosaveSignature){
    setSaveStatus("All changes saved to cloud","");
    return true;
  }

  autosaveInFlight=true;
  autosaveQueued=false;
  setSaveStatus("Saving to cloud…","saving");
  try{
    var ok=await saveActiveProject(false);
    if(!ok)throw new Error(lastCloudError||"Cloud save failed.");
    lastAutosaveSignature=stableSignature(currentBuilderState());
    setSaveStatus("All changes saved to cloud","");
    return true;
  }catch(error){
    setSaveStatus("Cloud save needs attention","error");
    console.error("Bluvixa autosave failed:",error);
    return false;
  }finally{
    autosaveInFlight=false;
    if(autosaveQueued){
      autosaveQueued=false;
      scheduleAutosave("queued-change");
    }
  }
}
function safeJson(key,fallback){
  try{
    var value=JSON.parse(localStorage.getItem(key)||"null");
    return value==null?fallback:value;
  }catch(_error){return fallback;}
}
function saveJson(key,value){localStorage.setItem(key,JSON.stringify(value));}
function clone(value){return JSON.parse(JSON.stringify(value));}
function formatDate(value){
  var date=new Date(value);
  if(Number.isNaN(date.getTime()))return "Unknown";
  return date.toLocaleString("en-US",{month:"short",day:"numeric",year:"numeric",hour:"numeric",minute:"2-digit"});
}
function titleCase(value){
  return String(value||"").replace(/[_-]+/g," ").replace(/\b\w/g,function(letter){return letter.toUpperCase();});
}
function sanitizeSlug(value){
  return String(value||"website").toLowerCase().trim().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"").slice(0,48)||"website";
}
function buyoutPrice(plan){
  return {starter:499,professional:599,advanced:699}[String(plan||"starter").toLowerCase()]||499;
}
function currentAccountPlan(){
  var value=accountData&&accountData.plan?String(accountData.plan).toLowerCase():"starter";
  return ["starter","professional","advanced"].indexOf(value)>=0?value:"starter";
}
function lockBuilderPlan(){
  var select=id("planSelect");
  if(!select)return;
  var plan=currentAccountPlan();
  select.innerHTML='<option value="'+plan+'">'+titleCase(plan)+'</option>';
  select.value=plan;
  select.disabled=true;
  select.setAttribute("aria-readonly","true");
  var state=currentBuilderState();
  if(state){
    state.plan=plan;
    if(typeof window.bluvixaImportState==="function")window.bluvixaImportState(state);
  }
}
function projectUrl(project){
  if(project&&project.customDomain&&project.domainStatus==="connected")return "https://"+project.customDomain;
  var slug=sanitizeSlug(project&&project.slug||project&&project.name||"website");
  return window.location.origin+"/site/"+encodeURIComponent(slug);
}
function isUuid(value){
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value||""));
}
function makeUuid(){
  if(window.crypto&&typeof window.crypto.randomUUID==="function")return window.crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g,function(character){
    var random=Math.random()*16|0;
    var value=character==="x"?random:(random&3|8);
    return value.toString(16);
  });
}
function uniquePublishedSlug(project){
  var existing=String(project&&project.slug||"").trim();
  if(existing)return sanitizeSlug(existing);
  var base=sanitizeSlug(project&&project.name||"website")||"website";
  var suffix=String(project&&project.id||makeUuid()).replace(/-/g,"").slice(-8);
  return base+"-"+suffix;
}
function normalizeProject(project){
  var copy=clone(project||{});
  if(!isUuid(copy.id))copy.id=makeUuid();
  copy.name=copy.name||"Untitled Website";
  copy.plan=copy.plan||"starter";
  copy.createdAt=copy.createdAt||new Date().toISOString();
  copy.updatedAt=copy.updatedAt||copy.createdAt;
  copy.state=copy.state||{};
  copy.slug=copy.slug||"";
  copy.published=!!copy.published;
  copy.publishedUrl=copy.publishedUrl||"";
  copy.websiteBoughtOut=!!copy.websiteBoughtOut;
  copy.domainStatus=copy.domainStatus||"not_connected";
  return copy;
}
function normalizeSnapshot(snapshot){
  var copy=clone(snapshot||{});
  if(!isUuid(copy.id))copy.id=makeUuid();
  if(copy.projectId&&!isUuid(copy.projectId))copy.projectId="";
  copy.name=copy.name||"Untitled Snapshot";
  copy.plan=copy.plan||"starter";
  copy.savedAt=copy.savedAt||new Date().toISOString();
  copy.state=copy.state||{};
  return copy;
}
function getProjects(){
  if(currentUser)return projectsCache;
  var value=safeJson(PROJECTS_KEY,[]);
  return Array.isArray(value)?value.map(normalizeProject):[];
}
function getSnapshots(){
  if(currentUser)return snapshotsCache;
  var value=safeJson(SNAPSHOTS_KEY,[]);
  return Array.isArray(value)?value.map(normalizeSnapshot):[];
}
function setProjects(value){
  projectsCache=(Array.isArray(value)?value:[]).map(normalizeProject);
  saveJson(PROJECTS_KEY,projectsCache);
  scheduleCloudSync();
}
function setSnapshots(value){
  snapshotsCache=(Array.isArray(value)?value:[]).map(normalizeSnapshot);
  saveJson(SNAPSHOTS_KEY,snapshotsCache);
  scheduleCloudSync();
}
function activeProjectId(){return localStorage.getItem(ACTIVE_PROJECT_KEY)||"";}
function setActiveProjectId(value){localStorage.setItem(ACTIVE_PROJECT_KEY,value||"");}

function fileExtension(file){
  var name=String(file&&file.name||"");
  var match=name.toLowerCase().match(/\.([a-z0-9]{1,8})$/);
  if(match)return match[1];
  var type=String(file&&file.type||"").toLowerCase();
  var fallback={"image/jpeg":"jpg","image/png":"png","image/webp":"webp","image/gif":"gif","video/mp4":"mp4","video/webm":"webm","video/quicktime":"mov"};
  return fallback[type]||"bin";
}
function cleanMediaName(value){
  return String(value||"media")
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g,"-")
    .replace(/-+/g,"-")
    .replace(/^-|-$/g,"")
    .slice(0,80)||"media";
}
function dataUrlToBlob(dataUrl){
  var parts=String(dataUrl||"").split(",");
  if(parts.length<2)throw new Error("Invalid embedded media data.");
  var mimeMatch=parts[0].match(/^data:([^;]+);base64$/i);
  if(!mimeMatch)throw new Error("Unsupported embedded media format.");
  var binary=atob(parts[1]);
  var bytes=new Uint8Array(binary.length);
  for(var index=0;index<binary.length;index++)bytes[index]=binary.charCodeAt(index);
  return new Blob([bytes],{type:mimeMatch[1]});
}
async function createLongLivedMediaUrl(path){
  var signed=await supabaseClient.storage.from(MEDIA_BUCKET).createSignedUrl(path,MEDIA_SIGNED_URL_SECONDS);
  if(signed.error)throw signed.error;
  return signed.data&&signed.data.signedUrl?signed.data.signedUrl:"";
}
async function uploadMediaBlob(blob,originalName,projectId){
  if(!currentUser||!supabaseClient)throw new Error("Sign in before uploading media.");
  projectId=isUuid(projectId)?projectId:(activeProjectId()||makeUuid());
  var fileLike=blob;
  var extension=fileExtension({name:originalName,type:blob.type});
  var baseName=cleanMediaName(String(originalName||"media").replace(/\.[^.]+$/,"")||"media");
  var path=currentUser.id+"/"+projectId+"/"+Date.now()+"-"+makeUuid()+"-"+baseName+"."+extension;
  mediaUploadInFlight++;
  setSaveStatus("Uploading media to cloud…","saving");
  try{
    var result=await supabaseClient.storage.from(MEDIA_BUCKET).upload(path,fileLike,{cacheControl:"31536000",contentType:blob.type||"application/octet-stream",upsert:false});
    if(result.error)throw result.error;
    var url=await createLongLivedMediaUrl(path);
    if(!url)throw new Error("The media URL could not be created.");
    return {url:url,path:path,type:String(blob.type||"").indexOf("video/")===0?"video":"image"};
  }finally{
    mediaUploadInFlight=Math.max(0,mediaUploadInFlight-1);
    if(!mediaUploadInFlight)setSaveStatus("All changes saved to cloud","");
  }
}
async function uploadMediaFile(file,kind){
  if(!file)throw new Error("No file was selected.");
  var isVideo=String(file.type||"").indexOf("video/")===0;
  var maxBytes=isVideo?100*1024*1024:25*1024*1024;
  if(file.size>maxBytes)throw new Error(isVideo?"Videos must be 100 MB or smaller.":"Images must be 25 MB or smaller.");
  if(String(file.type||"").indexOf("image/")!==0&&!isVideo)throw new Error("Please choose an image or video file.");
  return uploadMediaBlob(file,file.name,activeProjectId());
}
async function migrateEmbeddedMedia(value,projectId,keyPath){
  if(typeof value==="string"&&value.indexOf("data:")===0&&value.indexOf(";base64,")>0){
    var blob=dataUrlToBlob(value);
    var hint=(keyPath||"media").split(".").pop()||"media";
    var ext=fileExtension({type:blob.type});
    var uploaded=await uploadMediaBlob(blob,hint+"."+ext,projectId);
    return uploaded.url;
  }
  if(Array.isArray(value)){
    for(var i=0;i<value.length;i++)value[i]=await migrateEmbeddedMedia(value[i],projectId,(keyPath||"state")+"."+i);
    return value;
  }
  if(value&&typeof value==="object"){
    var keys=Object.keys(value);
    for(var k=0;k<keys.length;k++)value[keys[k]]=await migrateEmbeddedMedia(value[keys[k]],projectId,(keyPath||"state")+"."+keys[k]);
  }
  return value;
}
window.bluvixaUploadMedia=async function(file,kind){
  try{
    var uploaded=await uploadMediaFile(file,kind);
    toast(uploaded.type==="video"?"Video uploaded to cloud.":"Image uploaded to cloud.");
    return uploaded;
  }catch(error){
    setSaveStatus("Media upload needs attention","error");
    throw error;
  }
};

function projectToRow(project){
  var state=clone(project.state||{});
  state.__bluvixa_record_type="project";
  return {
    id:project.id,
    user_id:currentUser.id,
    name:project.name||"Untitled Website",
    slug:(project.published||project.domainStatus==="reserved"||project.customDomain)?(project.slug||uniquePublishedSlug(project)):null,
    plan:project.plan||"starter",
    project_data:state,
    published:project.published===true,
    published_url:project.publishedUrl||null,
    custom_domain:project.customDomain||null,
    domain_status:["not_connected","verifying","connected","failed","removing"].indexOf(project.domainStatus)>=0?project.domainStatus:"not_connected",
    website_bought_out:!!project.websiteBoughtOut,
    buyout_plan:project.buyoutPlan||null,
    buyout_completed_at:project.buyoutCompletedAt||null
  };
}
function snapshotToRow(snapshot){
  var state=clone(snapshot.state||{});
  state.__bluvixa_record_type="snapshot";
  state.__bluvixa_parent_project_id=snapshot.projectId||null;
  state.__bluvixa_saved_at=snapshot.savedAt||new Date().toISOString();
  return {
    id:snapshot.id,
    user_id:currentUser.id,
    name:snapshot.name||"Untitled Snapshot",
    slug:null,
    plan:snapshot.plan||"starter",
    project_data:state,
    published:false,
    custom_domain:null,
    domain_status:"not_connected",
    website_bought_out:false,
    buyout_plan:null,
    buyout_completed_at:null
  };
}
function rowToProject(row){
  var state=clone(row.project_data||{});
  delete state.__bluvixa_record_type;
  delete state.__bluvixa_parent_project_id;
  delete state.__bluvixa_saved_at;
  return normalizeProject({
    id:row.id,
    name:row.name,
    slug:row.slug,
    plan:row.plan,
    state:state,
    published:row.published===true,
    publishedUrl:row.published_url||null,
    publishedAt:(state.backend&&state.backend.publishedAt)||row.updated_at||null,
    customDomain:row.custom_domain||"",
    domainStatus:row.domain_status||"not_connected",
    websiteBoughtOut:!!row.website_bought_out,
    buyoutPlan:row.buyout_plan||null,
    buyoutCompletedAt:row.buyout_completed_at||null,
    createdAt:row.created_at,
    updatedAt:row.updated_at
  });
}
function rowToSnapshot(row){
  var state=clone(row.project_data||{});
  var parentId=state.__bluvixa_parent_project_id||"";
  var savedAt=state.__bluvixa_saved_at||row.updated_at||row.created_at;
  delete state.__bluvixa_record_type;
  delete state.__bluvixa_parent_project_id;
  delete state.__bluvixa_saved_at;
  return normalizeSnapshot({
    id:row.id,
    projectId:parentId,
    name:row.name,
    plan:row.plan,
    savedAt:savedAt,
    state:state
  });
}
async function saveCloudRow(row){
  if(!currentUser||!supabaseClient)throw new Error("You must be signed in before saving to the cloud.");
  var result=await supabaseClient
    .from("projects")
    .upsert([row],{onConflict:"id"})
    .select("id")
    .single();
  if(result.error)throw result.error;
  cloudRecordIds.add(row.id);
  lastCloudError="";
  cloudWorkspaceLoaded=true;
  return result.data;
}
async function saveProjectToCloud(project){
  project.state=await migrateEmbeddedMedia(project.state||{},project.id,"project");
  return saveCloudRow(projectToRow(project));
}
async function saveSnapshotToCloud(snapshot){
  snapshot.state=await migrateEmbeddedMedia(snapshot.state||{},snapshot.projectId||snapshot.id,"snapshot");
  return saveCloudRow(snapshotToRow(snapshot));
}
async function syncCloudWorkspace(){
  if(!currentUser||!supabaseClient)return false;
  try{
    for(var projectIndex=0;projectIndex<projectsCache.length;projectIndex++){
      await saveProjectToCloud(projectsCache[projectIndex]);
    }
    for(var snapshotIndex=0;snapshotIndex<snapshotsCache.length;snapshotIndex++){
      await saveSnapshotToCloud(snapshotsCache[snapshotIndex]);
    }
    return true;
  }catch(error){
    lastCloudError=error.message||"Unknown cloud save error";
    console.error("Bluvixa cloud save failed:",error);
    return false;
  }
}
function scheduleCloudSync(){
  if(!currentUser||!supabaseClient)return;
  clearTimeout(cloudSyncTimer);
  cloudSyncTimer=setTimeout(function(){syncCloudWorkspace();},500);
}
async function deleteCloudRecord(recordId){
  if(!currentUser||!supabaseClient||!recordId)return true;
  try{
    var result=await supabaseClient
      .from("projects")
      .delete()
      .eq("id",recordId);
    if(result.error)throw result.error;
    cloudRecordIds.delete(recordId);
    lastCloudError="";
    return true;
  }catch(error){
    lastCloudError=error.message||"Unknown cloud delete error";
    console.error("Bluvixa cloud delete failed:",error);
    return false;
  }
}
async function loadCloudWorkspace(){
  if(!currentUser||!supabaseClient)return;

  var localProjects=safeJson(PROJECTS_KEY,[]);
  var localSnapshots=safeJson(SNAPSHOTS_KEY,[]);
  projectsCache=[];
  snapshotsCache=[];
  cloudRecordIds=new Set();

  var result=await supabaseClient
    .from("projects")
    .select("*")
    .order("updated_at",{ascending:false});

  if(result.error){
    lastCloudError=result.error.message||"Cloud load failed";
    console.error("Bluvixa cloud load failed:",result.error);
    projectsCache=(Array.isArray(localProjects)?localProjects:[]).map(normalizeProject);
    snapshotsCache=(Array.isArray(localSnapshots)?localSnapshots:[]).map(normalizeSnapshot);
    cloudWorkspaceLoaded=false;
    renderProjects();renderDrafts();renderDomainSelectors();renderPublishing();
    return;
  }

  lastCloudError="";
  var rows=result.data||[];
  rows.forEach(function(row){
    cloudRecordIds.add(row.id);
    var recordType=row.project_data&&row.project_data.__bluvixa_record_type;
    if(recordType==="snapshot")snapshotsCache.push(rowToSnapshot(row));
    else projectsCache.push(rowToProject(row));
  });

  projectsCache.sort(function(a,b){return new Date(b.updatedAt)-new Date(a.updatedAt);});
  snapshotsCache.sort(function(a,b){return new Date(b.savedAt)-new Date(a.savedAt);});
  cloudWorkspaceLoaded=true;

  /* One-time migration from browser storage only when this account has no cloud rows. */
  if(!rows.length&&(localProjects.length||localSnapshots.length)){
    projectsCache=(Array.isArray(localProjects)?localProjects:[]).map(normalizeProject);
    snapshotsCache=(Array.isArray(localSnapshots)?localSnapshots:[]).map(normalizeSnapshot);
    await syncCloudWorkspace();
  }

  saveJson(PROJECTS_KEY,projectsCache);
  saveJson(SNAPSHOTS_KEY,snapshotsCache);
  renderProjects();renderDrafts();renderDomainSelectors();renderPublishing();
}
function currentBuilderState(){
  try{return typeof window.bluvixaExportState==="function"?window.bluvixaExportState():null;}
  catch(_error){return null;}
}

/* ---------- API ---------- */
async function api(path,options){
  var headers={"Content-Type":"application/json"};
  if(supabaseClient){
    var sessionResult=await supabaseClient.auth.getSession();
    var session=sessionResult.data&&sessionResult.data.session;
    if(session)headers.Authorization="Bearer "+session.access_token;
  }
  var response=await fetch(path,Object.assign({},options||{},{
    headers:Object.assign(headers,(options&&options.headers)||{})
  }));
  var contentType=response.headers.get("content-type")||"";
  var data=contentType.indexOf("application/json")>=0
    ? await response.json().catch(function(){return {};})
    : {};
  if(!response.ok)throw new Error(data.error||"Request failed.");
  return data;
}

/* ---------- ROUTER ---------- */
function routeName(){
  var name=(location.hash||"#home").slice(1).split("?")[0];
  var valid=["home","projects","drafts","builder","billing","domains","pricing"];
  return valid.indexOf(name)>=0?name:"home";
}
function showRoute(){
  var name=routeName();
  var signedIn=!!currentUser;

  if(signedIn&&name==="home")name="projects";
  if(!signedIn&&["projects","drafts","billing","domains"].indexOf(name)>=0)name="home";

  all(".app-page").forEach(function(page){
    var active=page.getAttribute("data-page")===name;
    page.classList.toggle("route-active",active);
    page.hidden=!active;
  });

  all("[data-route-link]").forEach(function(link){
    link.classList.toggle("active",link.getAttribute("data-route-link")===name);
  });

  document.body.classList.toggle("member-authenticated",signedIn);
  document.body.setAttribute("data-route",name);

  if(name==="projects")renderProjects();
  if(name==="drafts")renderDrafts();
  if(name==="domains"){renderDomainSelectors();renderPublishing();}
  if(name==="builder"){
    updateBuilderTitle();
    if(currentUser)setSaveStatus("Autosave is on","");
  }

  closeMobileMenu();
  window.scrollTo(0,0);
}

/* ---------- AUTH UI ---------- */
function openAuth(mode){
  authMode=mode||"signin";
  var signup=authMode==="signup";
  text("authTitle",signup?"Create your Bluvixa account":"Sign in to Bluvixa");
  text("authSubmitBtn",signup?"Create Account":"Sign In");
  if(id("fullNameGroup"))id("fullNameGroup").classList.toggle("hidden",!signup);
  if(id("showSignInTab"))id("showSignInTab").classList.toggle("active",!signup);
  if(id("showSignUpTab"))id("showSignUpTab").classList.toggle("active",signup);
  if(id("authPassword"))id("authPassword").autocomplete=signup?"new-password":"current-password";
  if(id("authMessage")){id("authMessage").textContent="";id("authMessage").classList.add("hidden");}
  if(id("authModal"))id("authModal").classList.remove("hidden");
}
function closeAuth(){if(id("authModal"))id("authModal").classList.add("hidden");}
function authMessage(message,error){
  var node=id("authMessage");
  if(!node)return;
  node.textContent=message||"";
  node.classList.toggle("hidden",!message);
  node.style.borderColor=error?"rgba(255,90,90,.55)":"rgba(70,210,145,.45)";
}
async function submitAuth(event){
  event.preventDefault();
  if(!supabaseClient){authMessage("Authentication is not connected.",true);return;}
  var email=id("authEmail").value.trim();
  var password=id("authPassword").value;
  var button=id("authSubmitBtn");
  if(button)button.disabled=true;
  try{
    if(authMode==="signup"){
      var fullName=id("authFullName")?id("authFullName").value.trim():"";
      var result=await supabaseClient.auth.signUp({
        email:email,password:password,options:{data:{full_name:fullName}}
      });
      if(result.error)throw result.error;
      if(result.data.session){
        closeAuth();
        location.hash="#projects";
        toast("Welcome to Bluvixa.");
      }else{
        authMessage("Account created. Check your email to verify it.",false);
      }
    }else{
      var login=await supabaseClient.auth.signInWithPassword({email:email,password:password});
      if(login.error)throw login.error;
      closeAuth();
      location.hash="#projects";
      toast("Welcome back to Bluvixa.");
    }
  }catch(error){
    authMessage(error.message||"Authentication failed.",true);
  }finally{
    if(button)button.disabled=false;
  }
}
async function forgotPassword(){
  if(!supabaseClient){authMessage("Authentication is not connected.",true);return;}
  var email=(id("authEmail")&&id("authEmail").value.trim())||(currentUser&&currentUser.email)||"";
  if(!email){authMessage("Enter your email first.",true);return;}
  var result=await supabaseClient.auth.resetPasswordForEmail(email,{redirectTo:location.origin+"/#projects"});
  if(result.error){authMessage(result.error.message,true);return;}
  authMessage("Password reset email sent.",false);
}
async function signOut(){
  if(supabaseClient)await supabaseClient.auth.signOut();
  currentUser=null;accountData=null;
  location.hash="#home";
  applySession(null);
  toast("Signed out.");
}
function closeLoading(){
  var loading=id("sessionLoadingScreen");
  if(loading)loading.classList.add("ready");
}
async function applySession(session){
  currentUser=session?session.user:null;
  var signedIn=!!currentUser;

  ["signInBtn","startTrialBtn"].forEach(function(name){
    if(id(name))id(name).classList.toggle("hidden",signedIn);
  });
  ["signOutBtn","accountNavLink"].forEach(function(name){
    if(id(name))id(name).classList.toggle("hidden",!signedIn);
  });

  if(id("publicNav"))id("publicNav").classList.toggle("hidden",signedIn);
  if(id("memberNav"))id("memberNav").classList.toggle("hidden",!signedIn);
  if(id("mobileMenuPublic"))id("mobileMenuPublic").classList.toggle("hidden",signedIn);
  if(id("mobileMenuMember"))id("mobileMenuMember").classList.toggle("hidden",!signedIn);

  text("sidebarMemberEmail",signedIn?currentUser.email:"");
  text("draftsMemberEmail",signedIn?currentUser.email:"");
  text("accountEmail",signedIn?currentUser.email:"—");

  var landingStart=id("landingStartBtn");
  if(landingStart){
    landingStart.textContent=signedIn?"Open My Websites":"Start 7-Day Free Trial";
    landingStart.dataset.action=signedIn?"open-projects":"signup";
  }
  var secondary=id("landingSecondaryBtn");
  if(secondary){
    secondary.textContent=signedIn?"Continue Building":"Preview the Builder";
    secondary.href="#builder";
  }

  closeLoading();
  showRoute();

  if(signedIn){
    try{
      await withTimeout(loadAccount(),12000,"Account check");
    }catch(error){
      console.warn("Bluvixa account check did not finish:",error);
    }
    try{
      await withTimeout(loadCloudWorkspace(),15000,"Cloud workspace");
    }catch(error){
      console.warn("Bluvixa cloud workspace did not finish:",error);
      cloudWorkspaceLoaded=false;
      projectsCache=readJson(PROJECTS_KEY,[]).map(normalizeProject);
      snapshotsCache=readJson(SNAPSHOTS_KEY,[]).map(normalizeSnapshot);
      renderProjects();renderDrafts();renderDomainSelectors();renderPublishing();
      toast("Signed in. Cloud data is taking longer than expected.");
    }

    var requestedRoute=routeName();
    var lastProjectId=localStorage.getItem(lastOpenedProjectKey)||activeProjectId();
    var recoverProject=getProjects().find(function(item){return item.id===lastProjectId;});
    if(requestedRoute==="builder"&&recoverProject){
      loadProject(recoverProject.id,{silent:true});
    }else if(["home","top",""].indexOf(requestedRoute)>=0){
      location.hash="#projects";
    }
  }else{
    cloudWorkspaceLoaded=false;
    projectsCache=[];
    snapshotsCache=[];
  }

  showRoute();
}
async function initAuth(){
  try{
    var config=await withTimeout(api("/api/api?action=config"),10000,"Configuration");
    if(!config.supabaseUrl||!config.supabaseAnonKey){
      closeLoading();
      return;
    }
    if(!window.supabase)throw new Error("Supabase client did not load.");
    supabaseClient=window.supabase.createClient(config.supabaseUrl,config.supabaseAnonKey);
    var sessionResult=await withTimeout(supabaseClient.auth.getSession(),10000,"Session check");
    await applySession(sessionResult.data.session);
    supabaseClient.auth.onAuthStateChange(function(_event,session){
      setTimeout(function(){void applySession(session);},0);
    });
  }catch(error){
    console.error("Bluvixa auth initialization failed:",error);
    closeLoading();
    showRoute();
  }
}

/* ---------- ACCOUNT / STRIPE ---------- */
function accountDate(data){
  var raw=data.trialEnd||data.trialEndsAt||data.currentPeriodEnd||data.renewalDate||data.subscriptionEnd;
  if(!raw)return "Date unavailable";
  var date=new Date(typeof raw==="number"?raw*1000:raw);
  return Number.isNaN(date.getTime())?String(raw):date.toLocaleDateString("en-US",{year:"numeric",month:"short",day:"numeric"});
}
async function loadAccount(){
  try{
    var data=await api("/api/api?action=account");
    accountData=data;
    var plan=data.plan?titleCase(data.plan):"Starter";
    var status=data.subscriptionStatus?titleCase(data.subscriptionStatus):"Not subscribed";
    var owned=!!data.websiteBoughtOut;

    text("accountPlan",plan);
    text("accountBillingStatus",status);
    text("dashboardSubscriptionPlan",plan);
    text("dashboardSubscriptionStatus",status);
    text("dashboardSubscriptionDate",accountDate(data));
    text("memberConfirmationTitle","Signed in as "+(currentUser?currentUser.email:"member"));
    text("projectsGreeting","Welcome home, "+((currentUser&&currentUser.user_metadata&&currentUser.user_metadata.full_name)||"member"));
    text("trialHomeTitle",String(data.subscriptionStatus||"").toLowerCase()==="trialing"?plan+" trial is active":plan+" membership");
    text("trialHomeMessage",String(data.subscriptionStatus||"").toLowerCase()==="trialing"
      ?"Your trial is active. Build unlimited draft projects, save snapshots, and manage billing from this workspace."
      :"Your Bluvixa account is ready.");
    text("mobileMemberPlan",plan);
    text("mobileMemberStatus",status);
    lockBuilderPlan();
  }catch(error){
    console.warn("Account data could not be loaded:",error);
    text("trialHomeTitle","Your Bluvixa workspace");
    text("trialHomeMessage","You are signed in. Account details will appear when the master account endpoint responds.");
  }
}
async function checkout(plan,purchaseType,websiteId){
  if(!currentUser){openAuth("signup");return;}
  try{
    var data=await api("/api/api?action=checkout",{
      method:"POST",
      body:JSON.stringify({
        plan:plan,
        purchaseType:purchaseType||"annual",
        websiteId:websiteId||null,
        successUrl:location.origin+"/#projects",
        cancelUrl:location.href
      })
    });
    if(!data.url)throw new Error("Checkout URL was not returned.");
    location.href=data.url;
  }catch(error){toast(error.message);}
}
async function portal(){
  if(!currentUser){openAuth("signin");return;}
  try{
    var data=await api("/api/api?action=portal",{
      method:"POST",
      body:JSON.stringify({returnUrl:location.origin+"/#billing"})
    });
    if(!data.url)throw new Error("Billing portal URL was not returned.");
    location.href=data.url;
  }catch(error){toast(error.message);}
}
async function exportWebsite(projectId){
  if(!currentUser){openAuth("signin");return;}
  try{
    var sessionResult=await supabaseClient.auth.getSession();
    var session=sessionResult.data.session;
    var response=await fetch("/api/api?action=export&project_id="+encodeURIComponent(projectId||""),{
      headers:{Authorization:"Bearer "+session.access_token}
    });
    if(!response.ok){
      var errorData=await response.json().catch(function(){return {};});
      throw new Error(errorData.error||"Export generation is not connected yet.");
    }
    var blob=await response.blob();
    var url=URL.createObjectURL(blob);
    var anchor=document.createElement("a");
    anchor.href=url;anchor.download="bluvixa-website.zip";
    document.body.appendChild(anchor);anchor.click();anchor.remove();
    setTimeout(function(){URL.revokeObjectURL(url);},1000);
    toast("Website export downloaded.");
  }catch(error){toast(error.message);}
}

/* ---------- PROJECTS ---------- */
function createProject(name,state){
  var builderState=state?clone(state):currentBuilderState();
  if(!builderState){toast("The builder is still loading.");return null;}
  var now=new Date().toISOString();
  var project={
    id:makeUuid(),
    name:(name||"Untitled Website").trim()||"Untitled Website",
    plan:currentAccountPlan(),
    createdAt:now,updatedAt:now,published:false,
    slug:(builderState.project&&builderState.project.slug)||"",
    customDomain:"",
    domainStatus:"not_connected",
    websiteBoughtOut:false,
    state:builderState
  };
  var projects=getProjects();
  projects.unshift(project);
  setProjects(projects);
  setActiveProjectId(project.id);
  return project;
}
function blankState(){
  var state=currentBuilderState();
  if(!state)return null;
  state=clone(state);
  state.business={name:"",bio:"",phone:"",email:"",hours:"",address:"",callText:""};
  state.header={tagline:"",headline:"",image:"",bio:""};
  state.photos=[];state.gallery=[];state.mapUrl="";
  state.project={slug:"",domainMode:"subdomain",customDomain:"",domainStatus:"not_connected",dnsVerified:false};
  state.backend={userId:null,websiteId:null,published:false,updatedAt:null};
  return state;
}
function newWebsite(){
  var state=blankState();
  if(!state){toast("Open the builder once, then create a website.");location.hash="#builder";return;}
  var project=createProject("Untitled Website",state);
  if(project&&typeof window.bluvixaImportState==="function"){
    project.state.plan=currentAccountPlan();
    window.bluvixaImportState(clone(project.state));
    lockBuilderPlan();
    location.hash="#builder";
    updateBuilderTitle();
    localStorage.setItem(lastOpenedProjectKey,project.id);
    lastAutosaveSignature="";
    setSaveStatus("New website ready — autosave is on","");
    scheduleAutosave("new-project");
    toast("New website created.");
  }
}
async function saveActiveProject(showMessage){
  var state=currentBuilderState();
  if(!state){toast("The builder is still loading.");return false;}
  var projects=getProjects();
  var project=projects.find(function(item){return item.id===activeProjectId();});
  if(!project){
    var name=(state.business&&state.business.name)?state.business.name+" Website":"Untitled Website";
    project=createProject(name,state);
    projects=getProjects();
  }else{
    project.state=clone(state);
    project.name=(state.business&&state.business.name)?state.business.name+" Website":project.name;
    project.plan=currentAccountPlan();
    project.state.plan=project.plan;
    project.updatedAt=new Date().toISOString();
    project.published=!!(state.backend&&state.backend.published);
    project.slug=(state.project&&state.project.slug)||project.slug;
    project.customDomain=(state.project&&state.project.customDomain)||project.customDomain;
    project.domainStatus=(state.project&&state.project.domainStatus)||project.domainStatus;
    projectsCache=projects.map(normalizeProject);
    saveJson(PROJECTS_KEY,projectsCache);
  }

  renderProjects();renderDrafts();renderPublishing();

  if(currentUser&&supabaseClient){
    try{
      setSaveStatus("Saving to cloud…","saving");
      await saveProjectToCloud(project);
      lastAutosaveSignature=stableSignature(project.state);
      localStorage.setItem(lastOpenedProjectKey,project.id);
      setSaveStatus("All changes saved to cloud","");
      if(showMessage)toast("Website saved to your cloud account.");
      return true;
    }catch(error){
      lastCloudError=error.message||"Unknown cloud save error";
      console.error("Bluvixa project save failed:",error);
      setSaveStatus("Cloud save needs attention","error");
      if(showMessage)toast("Cloud save failed: "+lastCloudError);
      return false;
    }
  }

  setSaveStatus("Saved on this device","");
  if(showMessage)toast("Website saved on this device. Sign in to save it to the cloud.");
  return true;
}
function loadProject(projectId,options){
  var project=getProjects().find(function(item){return item.id===projectId;});
  if(!project){if(!(options&&options.silent))toast("Website not found.");return;}
  setActiveProjectId(project.id);
  localStorage.setItem(lastOpenedProjectKey,project.id);
  suppressAutosaveUntil=Date.now()+2200;
  if(typeof window.bluvixaImportState==="function"){
    project.state.plan=currentAccountPlan();
    window.bluvixaImportState(clone(project.state));
    lockBuilderPlan();
    lastAutosaveSignature=stableSignature(project.state);
    location.hash="#builder";
    updateBuilderTitle();
    setSaveStatus("All changes saved to cloud","");
    if(!(options&&options.silent))toast(project.name+" loaded.");
  }
}
function duplicateProject(projectId){
  var project=getProjects().find(function(item){return item.id===projectId;});
  if(!project)return;
  var copiedState=clone(project.state||{});
  copiedState.project=copiedState.project||{};
  copiedState.project.slug="";
  copiedState.project.customDomain="";
  copiedState.project.domainStatus="not_connected";
  copiedState.backend=copiedState.backend||{};
  copiedState.backend.published=false;
  var copy=createProject(project.name+" Copy",copiedState);
  if(copy){copy.slug="";copy.customDomain="";copy.domainStatus="not_connected";copy.published=false;}
  renderProjects();renderDrafts();renderDomainSelectors();renderPublishing();
  toast("Website duplicated as a new draft.");
}
function deleteProject(projectId){
  deleteCloudRecord(projectId);
  setProjects(getProjects().filter(function(item){return item.id!==projectId;}));
  if(activeProjectId()===projectId)setActiveProjectId("");
  renderProjects();renderDrafts();renderDomainSelectors();renderPublishing();
  toast("Website deleted.");
}
function projectCard(project){
  return '<article class="website-project-card">'+
    '<div class="website-project-preview"><div><strong>'+escapeHtml(project.name)+'</strong><small>'+escapeHtml(projectUrl(project))+'</small></div></div>'+
    '<div class="website-project-body">'+
      '<div class="project-meta-row"><strong>'+escapeHtml(titleCase(project.plan))+'</strong><span class="project-status '+(project.websiteBoughtOut?"owned":project.published?"published":"")+'">'+(project.websiteBoughtOut?"Owned":project.published?"Published":"Draft")+'</span></div>'+
      '<div class="project-meta"><div><span>UPDATED</span><strong>'+escapeHtml(formatDate(project.updatedAt))+'</strong></div><div><span>OWNERSHIP</span><strong>'+(project.websiteBoughtOut?"Purchased":"Subscription")+'</strong></div></div>'+
      '<div class="project-actions">'+
        '<button class="btn btn-primary" data-project-action="load" data-project-id="'+project.id+'">Edit</button>'+
        '<button class="btn btn-secondary" data-project-action="duplicate" data-project-id="'+project.id+'">Duplicate</button>'+
        '<button class="btn btn-secondary" data-project-action="drafts" data-project-id="'+project.id+'">Drafts</button>'+
        '<button class="btn btn-danger" data-project-action="delete" data-project-id="'+project.id+'">Delete</button>'+
      '</div>'+
    '</div>'+
  '</article>';
}
function renderProjects(){
  var grid=id("websiteLibraryGrid");if(!grid)return;
  var query=(id("projectSearchInput")?id("projectSearchInput").value:"").trim().toLowerCase();
  var projects=getProjects();
  var filtered=projects.filter(function(project){
    return !query||project.name.toLowerCase().indexOf(query)>=0||projectUrl(project).toLowerCase().indexOf(query)>=0;
  });
  text("projectCount",projects.length);
  text("publishedProjectCount",projects.filter(function(project){return project.published;}).length);
  text("draftProjectCount",projects.filter(function(project){return !project.published;}).length);
  grid.innerHTML=filtered.length?filtered.map(projectCard).join(""):'<div class="empty-state">No websites yet. Select “Create New Website” to begin.</div>';
}

/* ---------- DRAFTS ---------- */
async function saveSnapshot(){
  var state=currentBuilderState();
  if(!state){toast("The builder is still loading.");return;}
  var project=getProjects().find(function(item){return item.id===activeProjectId();});
  var snapshot={
    id:makeUuid(),
    projectId:project?project.id:"",
    name:project?project.name+" Snapshot":"Untitled Snapshot",
    plan:currentAccountPlan(),
    savedAt:new Date().toISOString(),
    state:clone(state)
  };
  snapshotsCache=[snapshot].concat(getSnapshots()).slice(0,60).map(normalizeSnapshot);
  saveJson(SNAPSHOTS_KEY,snapshotsCache);
  renderDrafts();
  if(currentUser&&supabaseClient){
    try{
      await saveSnapshotToCloud(snapshot);
      toast("Snapshot saved to your cloud account.");
    }catch(error){
      lastCloudError=error.message||"Unknown cloud save error";
      console.error("Bluvixa snapshot save failed:",error);
      toast("Snapshot kept on this device. Cloud error: "+lastCloudError);
    }
  }else toast("Snapshot saved on this device.");
}
function loadSnapshot(snapshotId){
  var snapshot=getSnapshots().find(function(item){return item.id===snapshotId;});
  if(!snapshot){toast("Snapshot not found.");return;}
  setActiveProjectId(snapshot.projectId||"");
  if(typeof window.bluvixaImportState==="function"){
    snapshot.state.plan=currentAccountPlan();
    window.bluvixaImportState(clone(snapshot.state));
    lockBuilderPlan();
    location.hash="#builder";
    toast("Snapshot loaded.");
  }
}
function deleteSnapshot(snapshotId){
  deleteCloudRecord(snapshotId);
  setSnapshots(getSnapshots().filter(function(item){return item.id!==snapshotId;}));
  renderDrafts();toast("Snapshot deleted.");
}
function draftCard(item,type){
  var project=type==="project"?item:getProjects().find(function(entry){return entry.id===item.projectId;});
  var owned=project&&project.websiteBoughtOut;
  return '<article class="draft-card '+(type==="project"?"project-draft":"snapshot-draft")+'">'+
    '<div class="draft-thumb"><strong>'+escapeHtml(item.name)+'</strong></div>'+
    '<div class="draft-card-body">'+
      '<span class="draft-type-label">'+(type==="project"?"WEBSITE PROJECT":"SNAPSHOT")+'</span>'+
      '<strong>'+(type==="project"?(item.published?"Published website":"Incomplete website"):"Saved snapshot")+'</strong>'+
      '<small>'+escapeHtml(formatDate(type==="project"?item.updatedAt:item.savedAt))+'</small>'+
      '<div class="draft-ownership-row"><small>'+(owned?"Website owned":"Buyout $"+buyoutPrice(item.plan))+'</small><span class="project-status '+(owned?"owned":"")+'">'+(owned?"Export unlocked":"Export locked")+'</span></div>'+
      '<div class="draft-card-actions">'+
        '<button class="btn btn-primary btn-small" data-draft-action="'+(type==="project"?"load-project":"load-snapshot")+'" data-item-id="'+item.id+'">Load</button>'+
        (type==="project"
          ? (owned
              ? '<button class="btn btn-primary btn-small" data-draft-action="export" data-item-id="'+item.id+'">Export ZIP</button>'
              : '<button class="btn btn-secondary btn-small" data-draft-action="buyout" data-item-id="'+item.id+'">Buy Out $'+buyoutPrice(item.plan)+'</button>')
          : '<button class="btn btn-secondary btn-small" data-draft-action="delete-snapshot" data-item-id="'+item.id+'">Delete</button>')+
      '</div>'+
    '</div>'+
  '</article>';
}
function renderDrafts(){
  var grid=id("savedDraftsGrid");if(!grid)return;
  var query=(id("draftSearchInput")?id("draftSearchInput").value:"").trim().toLowerCase();
  var entries=[];
  getProjects().forEach(function(project){
    if(draftFilter==="all"||draftFilter==="project"||(draftFilter==="incomplete"&&!project.published)){
      entries.push({item:project,type:"project",date:project.updatedAt});
    }
  });
  if(draftFilter==="all"||draftFilter==="snapshot"){
    getSnapshots().forEach(function(snapshot){
      entries.push({item:snapshot,type:"snapshot",date:snapshot.savedAt});
    });
  }
  entries=entries.filter(function(entry){return !query||entry.item.name.toLowerCase().indexOf(query)>=0;});
  entries.sort(function(a,b){return new Date(b.date)-new Date(a.date);});
  text("savedDraftCount",entries.length);
  grid.innerHTML=entries.length?entries.map(function(entry){return draftCard(entry.item,entry.type);}).join(""):'<div class="empty-state">No matching drafts or websites.</div>';
}

/* ---------- DOMAINS ---------- */
function domainSuggestions(term,extension){
  var slug=sanitizeSlug(term);
  var compact=slug.replace(/-/g,"");
  var year=new Date().getFullYear();
  return [slug+extension,compact+"online"+extension,"get"+compact+extension,slug+year+extension,compact+"hq"+extension,"my"+compact+extension]
    .filter(function(value,index,array){return value&&array.indexOf(value)===index;});
}
async function searchDomains(){
  var term=(id("domainSearchInput").value||"").trim();
  var extension=id("domainExtensionSelect").value||".com";
  if(!term){toast("Enter a business or website name.");return;}
  var results=domainSuggestions(term,extension);
  var live=false;
  try{
    var response=await fetch("/api/api?action=domain-search",{
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({query:term,extension:extension})
    });
    if(response.ok){
      var data=await response.json();
      if(Array.isArray(data.results)&&data.results.length){results=data.results;live=true;}
    }
  }catch(_error){}
  text("domainProviderNote",live?"Live availability returned by the connected domain provider.":"Showing generated suggestions. Connect a registrar provider for live availability and pricing.");
  id("domainResultsGrid").innerHTML=results.map(function(result){
    var domain=typeof result==="string"?result:result.domain;
    var available=typeof result==="string"?null:result.available;
    var price=typeof result==="string"?"":result.price;
    return '<article class="domain-result-card"><strong>'+escapeHtml(domain)+'</strong><small>'+(available===true?"Available"+(price?" — "+price:""):available===false?"Unavailable":"Availability requires provider")+'</small><button class="btn btn-secondary" data-domain-use="'+escapeHtml(domain)+'">Use This Domain</button></article>';
  }).join("");
}
function renderDomainSelectors(){
  ["subdomainProjectSelect","customDomainProjectSelect"].forEach(function(name){
    var select=id(name);if(!select)return;
    select.innerHTML=getProjects().map(function(project){
      return '<option value="'+project.id+'">'+escapeHtml(project.name)+'</option>';
    }).join("");
  });
}
function reserveSubdomain(){
  var projectId=id("subdomainProjectSelect").value;
  var slug=sanitizeSlug(id("subdomainSlugInput").value);
  if(!projectId||!slug){toast("Choose a website and enter an address.");return;}
  var projects=getProjects();
  if(projects.some(function(project){return project.id!==projectId&&project.slug===slug;})){
    text("subdomainResultMessage",slug+".bluvixa.com is already used by another project in this account.");
    return;
  }
  var project=projects.find(function(item){return item.id===projectId;});
  project.slug=slug;project.customDomain="";project.domainStatus="reserved";project.updatedAt=new Date().toISOString();
  if(project.state&&project.state.project){
    project.state.project.slug=slug;
    project.state.project.domainMode="subdomain";
  }
  setProjects(projects);
  text("subdomainResultMessage","Reserved. Publish the website to make it live at "+window.location.origin+"/site/"+slug+".");
  renderProjects();renderDrafts();renderPublishing();
}
async function connectCustomDomain(){
  var projectId=id("customDomainProjectSelect").value;
  var domain=String(id("customDomainWorkspaceInput").value||"").toLowerCase().trim().replace(/^https?:\/\//,"").replace(/^www\./,"").replace(/\/.*$/,"");
  if(!projectId||!/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i.test(domain)){
    toast("Choose a website and enter a valid domain.");
    return;
  }

  text("customDomainResultMessage","Connecting "+domain+"…");
  try{
    var result=await authenticatedApi("/api/api?action=domain&domain_action=connect",{projectId:projectId,domain:domain});
    var projects=getProjects();
    var project=projects.find(function(item){return item.id===projectId;});
    if(project){
      project.customDomain=domain;
      project.domainStatus=result.verified?"connected":"waiting";
      project.updatedAt=new Date().toISOString();
      if(project.state&&project.state.project){
        project.state.project.customDomain=domain;
        project.state.project.domainMode="custom";
        project.state.project.domainStatus=project.domainStatus;
        project.state.project.dnsVerified=!!result.verified;
      }
      setProjects(projects);
      await saveProjectToCloud(project);
    }
    if(id("dnsWorkspace"))id("dnsWorkspace").classList.remove("hidden");
    text("customDomainResultMessage",result.verified
      ? domain+" is connected and ready."
      : domain+" was added. Complete the DNS records shown by your domain provider, then try again.");
    renderProjects();renderDrafts();renderPublishing();
  }catch(error){
    console.error("Bluvixa custom-domain connection failed:",error);
    text("customDomainResultMessage","Domain connection failed: "+(error.message||"Unknown error"));
    toast("Domain connection failed.");
  }
}

function publishingSelectedProject(){
  var select=id("publishingCenterProjectSelect");
  var projectId=(select&&select.value)||publishingCenterProjectId||activeProjectId();
  return getProjects().find(function(item){return item.id===projectId;})||getProjects()[0]||null;
}
function formatPublishedDate(value){
  if(!value)return "Never";
  var date=new Date(value);
  if(Number.isNaN(date.getTime()))return "Never";
  return date.toLocaleString(undefined,{month:"short",day:"numeric",year:"numeric",hour:"numeric",minute:"2-digit"});
}
function setPublishingProgress(value,activeStep,message){
  publishingProgressValue=Math.max(0,Math.min(100,Number(value)||0));
  text("publishingProgressPercent",Math.round(publishingProgressValue)+"%");
  var bar=id("publishingProgressBar");
  if(bar)bar.style.width=publishingProgressValue+"%";
  document.querySelectorAll("[data-publish-step]").forEach(function(step){
    var key=step.getAttribute("data-publish-step");
    var order={save:1,media:2,build:3,deploy:4};
    var current=order[activeStep]||0;
    var own=order[key]||0;
    step.classList.remove("is-error");
    step.classList.toggle("is-active",own===current);
    step.classList.toggle("is-complete",own<current||(publishingProgressValue===100&&own<=4));
    var small=step.querySelector("small");
    if(small){
      if(own<current||(publishingProgressValue===100&&own<=4))small.textContent="Complete";
      else if(own===current)small.textContent=message||"Working…";
      else small.textContent="Waiting";
    }
  });
}
function beginPublishingProgress(){
  clearInterval(publishingProgressTimer);
  setPublishingProgress(8,"save","Saving…");
  publishingProgressTimer=setInterval(function(){
    if(publishingProgressValue<24)setPublishingProgress(publishingProgressValue+3,"save","Saving…");
    else if(publishingProgressValue<48)setPublishingProgress(publishingProgressValue+3,"media","Checking uploads…");
    else if(publishingProgressValue<72)setPublishingProgress(publishingProgressValue+2,"build","Preparing website…");
    else if(publishingProgressValue<88)setPublishingProgress(publishingProgressValue+1,"deploy","Deploying…");
  },180);
}
function finishPublishingProgress(success){
  clearInterval(publishingProgressTimer);
  publishingProgressTimer=null;
  if(success)setPublishingProgress(100,"deploy","Live");
  else{
    setPublishingProgress(Math.max(10,publishingProgressValue),"deploy","Needs attention");
    var deploy=document.querySelector('[data-publish-step="deploy"]');
    if(deploy)deploy.classList.add("is-error");
  }
}
async function copyPublishedLink(){
  var project=publishingSelectedProject();
  if(!project||!project.published){text("publishingShareMessage","Publish this website before copying its link.");return;}
  var url=projectUrl(project);
  try{
    await navigator.clipboard.writeText(url);
    text("publishingShareMessage","Live link copied.");
    toast("Website link copied.");
  }catch(_error){
    var input=id("publishingShareUrl");
    if(input){input.focus();input.select();}
    text("publishingShareMessage","Select and copy the highlighted link.");
  }
}
async function sharePublishedSite(){
  var project=publishingSelectedProject();
  if(!project||!project.published){text("publishingShareMessage","Publish this website before sharing it.");return;}
  var url=projectUrl(project);
  if(navigator.share){
    try{await navigator.share({title:project.name,text:"Visit "+project.name,url:url});}
    catch(error){if(error&&error.name!=="AbortError")text("publishingShareMessage","Sharing was not completed.");}
  }else{
    await copyPublishedLink();
  }
}
function renderPublishingVersions(project){
  var box=id("publishingVersionHistory");if(!box)return;
  if(!project){box.innerHTML='<div class="empty-state">No website selected.</div>';return;}
  var versions=getSnapshots()
    .filter(function(snapshot){return snapshot.projectId===project.id;})
    .sort(function(a,b){return new Date(b.savedAt)-new Date(a.savedAt);})
    .slice(0,6);
  var current='<article class="publishing-version-row current"><div><strong>Current cloud version</strong><small>'+escapeHtml(formatPublishedDate(project.updatedAt))+'</small></div><span>Current</span></article>';
  box.innerHTML=current+(versions.length?versions.map(function(snapshot,index){
    return '<article class="publishing-version-row"><div><strong>'+escapeHtml(snapshot.name||("Saved version "+(index+1)))+'</strong><small>'+escapeHtml(formatPublishedDate(snapshot.savedAt))+'</small></div><button class="btn btn-secondary" data-project-action="load-snapshot" data-snapshot-id="'+snapshot.id+'">Open</button></article>';
  }).join(""):'<div class="publishing-version-empty">No saved snapshots yet. Use Save Snapshot in the builder to create restore points.</div>');
}
function renderPublishingCenter(){
  var select=id("publishingCenterProjectSelect");
  var workspace=id("publishingCenterWorkspace");
  var empty=id("publishingCenterEmpty");
  if(!select||!workspace||!empty)return;
  var projects=getProjects();
  if(!projects.length){
    select.innerHTML="";
    workspace.classList.add("hidden");
    empty.classList.remove("hidden");
    return;
  }
  workspace.classList.remove("hidden");
  empty.classList.add("hidden");
  var preferred=publishingCenterProjectId||select.value||activeProjectId()||projects[0].id;
  if(!projects.some(function(project){return project.id===preferred;}))preferred=projects[0].id;
  publishingCenterProjectId=preferred;
  select.innerHTML=projects.map(function(project){
    return '<option value="'+project.id+'"'+(project.id===preferred?" selected":"")+'>'+escapeHtml(project.name)+'</option>';
  }).join("");
  var project=projects.find(function(item){return item.id===preferred;});
  var published=!!project.published;
  var url=projectUrl(project);
  var customConnected=project.customDomain&&project.domainStatus==="connected";
  text("publishingCenterProjectName",project.name);
  text("publishingStatusText",published?"Live":"Draft");
  text("publishingCenterMessage",published?"Your latest saved website is publicly available.":"This website is private until you publish it.");
  text("publishingMetricStatus",published?"Live":"Draft");
  text("publishingMetricStatusDetail",published?"Publicly visible":"Not publicly visible");
  text("publishingMetricDate",published?formatPublishedDate(project.publishedAt||project.updatedAt):"Never");
  text("publishingMetricDomain",customConnected?project.customDomain:"Bluvixa address");
  text("publishingMetricDomainDetail",customConnected?"Custom domain connected":"No custom domain connected");
  text("publishingMetricSsl",published?"Active":"Ready");
  var dot=id("publishingStatusDot");if(dot)dot.classList.toggle("is-live",published);
  var primary=id("publishingPrimaryBtn");
  if(primary){
    primary.textContent=published?"Unpublish Website":"Publish Now";
    primary.dataset.projectId=project.id;
    primary.dataset.publishAction=published?"unpublish":"publish";
    primary.classList.toggle("btn-danger",published);
  }
  var liveLink=id("publishingLiveUrl");
  if(liveLink){
    liveLink.textContent=published?url:"Not published";
    liveLink.href=published?url:"#";
    liveLink.classList.toggle("is-disabled",!published);
  }
  var share=id("publishingShareUrl");
  if(share)share.value=published?url:"Publish the website to create a public link";
  var view=id("publishingViewLiveBtn");
  if(view){
    view.href=published?url:"#";
    view.classList.toggle("hidden",!published);
  }
  renderPublishingVersions(project);
  if(!publishingProgressTimer)setPublishingProgress(published?100:0,published?"deploy":"",published?"Live":"Waiting");
}
async function togglePublish(projectId){
  var projects=getProjects();
  var project=projects.find(function(item){return item.id===projectId;});
  if(!project)return;

  /*
    Capture the requested action before saveActiveProject() runs.
    Saving re-renders the Publishing Center. On mobile, stale builder state
    could change the red Unpublish button back to Publish Now before the
    request was created, causing Unpublish to publish the site again.
  */
  var primaryButton=id("publishingPrimaryBtn");
  var publishAction=String(primaryButton&&primaryButton.dataset.publishAction||"").toLowerCase();
  var shouldPublish=publishAction?publishAction==="publish":!project.published;

  try{
    beginPublishingProgress();

    if(activeProjectId()===projectId&&typeof window.bluvixaExportState==="function"){
      var saved=await saveActiveProject(false);
      if(!saved)throw new Error(lastCloudError||"Save the website before publishing.");
      projects=getProjects();
      project=projects.find(function(item){return item.id===projectId;});
      if(!project)throw new Error("Website project could not be reloaded.");
    }

    toast(shouldPublish?"Publishing website…":"Unpublishing website…");

    var result=await authenticatedApi("/api/api?action=publish",{
      projectId:projectId,
      publish:shouldPublish,
      requestedSlug:project.slug||sanitizeSlug(project.name)
    });

    if(typeof result.published!=="boolean"){
      throw new Error("The server returned an invalid publishing status.");
    }

    project.published=result.published;
    project.slug=result.slug||project.slug||"";
    project.publishedUrl=project.published?(result.url||project.publishedUrl||projectUrl(project)):"";
    project.updatedAt=new Date().toISOString();
    project.publishedAt=project.published?project.updatedAt:null;

    if(project.state){
      project.state.backend=project.state.backend||{};
      project.state.project=project.state.project||{};
      project.state.backend.published=project.published;
      project.state.backend.publishedUrl=project.publishedUrl||null;
      project.state.backend.publishedAt=project.publishedAt;
      project.state.project.slug=project.slug;
      project.state.project.domainStatus=project.domainStatus;
    }

    /*
      Keep the active builder state synchronized with the server result.
      Mobile browsers fire visibilitychange/pagehide more aggressively;
      without this update, a later autosave can restore the old published
      value immediately after an unpublish request.
    */
    if(activeProjectId()===projectId&&project.state&&typeof window.bluvixaImportState==="function"){
      suppressAutosaveUntil=Date.now()+2200;
      window.bluvixaImportState(clone(project.state));
      lastAutosaveSignature=stableSignature(project.state);
    }

    /*
      The API has already written the final published/draft status.
      Do not immediately call saveProjectToCloud here because a second
      cloud write can overwrite the status that was just set by the API.
    */
    setProjects(projects);
    renderProjects();
    renderDrafts();
    renderPublishing();
    renderPublishingCenter();
    finishPublishingProgress(true);

    if(project.published){
      toast("Website published successfully.");
      window.open(result.url||projectUrl(project),"_blank","noopener");
    }else{
      toast("Website unpublished.");
    }
  }catch(error){
    finishPublishingProgress(false);
    console.error("Bluvixa publishing failed:",error);
    toast("Publishing failed: "+(error.message||"Unknown error"));
  }
}
function renderPublishing(){renderPublishingCenter();}

/* ---------- BUILDER ---------- */
function updateBuilderTitle(){
  var project=getProjects().find(function(item){return item.id===activeProjectId();});
  text("builderProjectTitle",project?project.name:"Build your website");
  text("builderProjectSubtitle",project?"Editing website project · "+titleCase(project.plan)+" plan":"Create or load a website project.");
}

/* ---------- MOBILE MENU ---------- */
function toggleMobileMenu(){
  var menu=id("mobileMenu"),button=id("mobileMenuButton");
  if(!menu||!button)return;
  var opening=menu.classList.contains("hidden");
  menu.classList.toggle("hidden",!opening);
  button.classList.toggle("open",opening);
  button.setAttribute("aria-expanded",String(opening));
}
function closeMobileMenu(){
  var menu=id("mobileMenu"),button=id("mobileMenuButton");
  if(menu)menu.classList.add("hidden");
  if(button){button.classList.remove("open");button.setAttribute("aria-expanded","false");}
}

/* ---------- DELEGATED CLICKS ---------- */
function handleClick(event){
  var button=event.target.closest("button,a");
  if(!button)return;

  if(button.id==="signInBtn"||button.id==="mobileSignInBtn"){event.preventDefault();openAuth("signin");return;}
  if(button.id==="startTrialBtn"||button.id==="mobileStartTrialBtn"){event.preventDefault();openAuth("signup");return;}
  if(button.id==="landingStartBtn"){
    event.preventDefault();
    if(currentUser)location.hash="#projects";else openAuth("signup");
    return;
  }
  if(button.id==="accountNavLink"){event.preventDefault();location.hash="#projects";return;}
  if(button.id==="signOutBtn"||button.id==="accountSignOutBtn"||button.id==="mobileSignOutBtn"){event.preventDefault();signOut();return;}
  if(button.id==="mobileMenuButton"){event.preventDefault();toggleMobileMenu();return;}
  if(button.id==="closeAuthBtn"){event.preventDefault();closeAuth();return;}
  if(button.id==="showSignInTab"){event.preventDefault();openAuth("signin");return;}
  if(button.id==="showSignUpTab"){event.preventDefault();openAuth("signup");return;}
  if(button.id==="forgotPasswordBtn"){event.preventDefault();forgotPassword();return;}
  if(button.id==="manageBillingBtn"){event.preventDefault();portal();return;}
  if(button.id==="createWebsiteBtn"||button.id==="createWebsiteFromDraftsBtn"){event.preventDefault();newWebsite();return;}
  if(button.id==="saveWebsiteProjectBtn"){event.preventDefault();void saveActiveProject(true);return;}
  if(button.id==="saveCurrentDraftBtn"||button.id==="saveSnapshotTopBtn"){event.preventDefault();void saveSnapshot();return;}
  if(button.id==="searchDomainsBtn"){event.preventDefault();searchDomains();return;}
  if(button.id==="reserveSubdomainBtn"){event.preventDefault();reserveSubdomain();return;}
  if(button.id==="connectCustomDomainWorkspaceBtn"){event.preventDefault();void connectCustomDomain();return;}

  if(button.matches(".pricingTrial,.memberPlanCheckout")){
    event.preventDefault();
    checkout(button.getAttribute("data-plan")||"professional","annual",null);
    return;
  }

  var projectAction=button.getAttribute("data-project-action");
  var projectId=button.getAttribute("data-project-id");
  if(projectAction){
    event.preventDefault();
    if(projectAction==="load")loadProject(projectId);
    if(projectAction==="duplicate")duplicateProject(projectId);
    if(projectAction==="drafts")location.hash="#drafts";
    if(projectAction==="delete")deleteProject(projectId);
    if(projectAction==="publish")void togglePublish(projectId);
    if(projectAction==="load-snapshot"){
      var snapshotId=button.getAttribute("data-snapshot-id");
      var snapshot=getSnapshots().find(function(item){return item.id===snapshotId;});
      if(snapshot&&typeof window.bluvixaImportState==="function"){
        var parent=getProjects().find(function(item){return item.id===snapshot.projectId;});
        if(parent)setActiveProjectId(parent.id);
        suppressAutosaveUntil=Date.now()+2200;
        window.bluvixaImportState(clone(snapshot.state));
        location.hash="#builder";
        updateBuilderTitle();
        toast("Saved version opened in the builder.");
      }
    }
    return;
  }

  var draftAction=button.getAttribute("data-draft-action");
  var itemId=button.getAttribute("data-item-id");
  if(draftAction){
    event.preventDefault();
    if(draftAction==="load-project")loadProject(itemId);
    if(draftAction==="load-snapshot")loadSnapshot(itemId);
    if(draftAction==="delete-snapshot")deleteSnapshot(itemId);
    if(draftAction==="buyout"){
      var project=getProjects().find(function(item){return item.id===itemId;});
      if(project)checkout(project.plan,"buyout",project.id);
    }
    if(draftAction==="export")exportWebsite(itemId);
    return;
  }

  var useDomain=button.getAttribute("data-domain-use");
  if(useDomain){
    event.preventDefault();
    if(id("customDomainWorkspaceInput"))id("customDomainWorkspaceInput").value=useDomain;
    id("customDomainWorkspaceInput").scrollIntoView({behavior:"smooth",block:"center"});
    return;
  }
}

/* ---------- BIND ---------- */
function bind(){
  if(initialized)return;
  initialized=true;

  document.addEventListener("click",handleClick);
  window.addEventListener("hashchange",showRoute);

  if(id("authForm"))id("authForm").addEventListener("submit",submitAuth);
  if(id("authModal"))id("authModal").addEventListener("click",function(event){
    if(event.target===id("authModal"))closeAuth();
  });
  var builderPage=document.querySelector('[data-page="builder"]');
  if(builderPage){
    builderPage.addEventListener("input",function(event){
      if(event.target&&event.target.closest("input,textarea,select"))scheduleAutosave("input");
    });
    builderPage.addEventListener("change",function(event){
      if(event.target&&event.target.closest("input,textarea,select"))scheduleAutosave("change");
    });
    builderPage.addEventListener("click",function(event){
      var button=event.target&&event.target.closest("button");
      if(!button)return;
      if(["saveWebsiteProjectBtn","saveCurrentDraftBtn","saveSnapshotTopBtn"].indexOf(button.id)>=0)return;
      if(button.closest(".tabs,.photo-actions,.gallery-actions,.panel,.sidebar-footer"))scheduleAutosave("builder-action");
    });
  }

  document.addEventListener("bluvixa:builder-change",function(){scheduleAutosave("media-change");});

  document.addEventListener("visibilitychange",function(){
    if(document.visibilityState==="hidden"&&currentUser&&routeName()==="builder"){
      clearTimeout(autosaveTimer);
      void runAutosave("page-hidden");
    }
  });
  window.addEventListener("pagehide",function(){
    if(currentUser&&routeName()==="builder"){
      var state=currentBuilderState();
      if(state)saveJson("bluvixa_emergency_builder_state_v8",state);
    }
  });

  if(id("publishingCenterProjectSelect"))id("publishingCenterProjectSelect").addEventListener("change",function(event){
    publishingCenterProjectId=event.target.value;
    renderPublishingCenter();
  });
  if(id("publishingPrimaryBtn"))id("publishingPrimaryBtn").addEventListener("click",function(){
    var project=publishingSelectedProject();
    if(project)void togglePublish(project.id);
  });
  if(id("copyPublishedLinkBtn"))id("copyPublishedLinkBtn").addEventListener("click",function(){void copyPublishedLink();});
  if(id("sharePublishedSiteBtn"))id("sharePublishedSiteBtn").addEventListener("click",function(){void sharePublishedSite();});
  if(id("openDomainForPublishingBtn"))id("openDomainForPublishingBtn").addEventListener("click",function(){
    var project=publishingSelectedProject();
    if(project){
      var select=id("customDomainProjectSelect");
      if(select)select.value=project.id;
      var input=id("customDomainWorkspaceInput");
      if(input)input.focus();
      window.scrollTo({top:Math.max(0,(input?input.getBoundingClientRect().top:0)+window.scrollY-120),behavior:"smooth"});
    }
  });

  if(id("projectSearchInput"))id("projectSearchInput").addEventListener("input",renderProjects);
  if(id("draftSearchInput"))id("draftSearchInput").addEventListener("input",renderDrafts);
  if(id("domainSearchInput"))id("domainSearchInput").addEventListener("keydown",function(event){
    if(event.key==="Enter"){event.preventDefault();searchDomains();}
  });

  all("[data-draft-filter]").forEach(function(button){
    button.addEventListener("click",function(){
      draftFilter=button.getAttribute("data-draft-filter");
      all("[data-draft-filter]").forEach(function(item){item.classList.toggle("active",item===button);});
      renderDrafts();
    });
  });

  all("#mobileMenu a").forEach(function(link){link.addEventListener("click",closeMobileMenu);});

  renderProjects();
  renderDrafts();
  renderDomainSelectors();
  renderPublishing();
  showRoute();
  initAuth();
}

window.BluvixaPlatform={
  openAuth:openAuth,
  checkout:checkout,
  exportWebsite:exportWebsite,
  saveProject:saveActiveProject,
  createProject:createProject,
  getActiveProjectId:activeProjectId
};

document.addEventListener("DOMContentLoaded",bind);
async function authenticatedApi(path,payload){
  if(!supabaseClient)throw new Error("Supabase is not initialized.");
  var sessionResult=await supabaseClient.auth.getSession();
  var accessToken=sessionResult&&sessionResult.data&&sessionResult.data.session&&sessionResult.data.session.access_token;
  if(!accessToken)throw new Error("Please sign in again.");
  var response=await fetch(path,{
    method:"POST",
    headers:{
      "Content-Type":"application/json",
      "Authorization":"Bearer "+accessToken
    },
    body:JSON.stringify(payload||{})
  });
  var data=await response.json().catch(function(){return {};});
  if(!response.ok)throw new Error(data.error||data.message||"Request failed.");
  return data;
}

})();


/* ================= DOMAIN MANAGER ================= */

(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);

  let projects = [];
  let currentProject = null;
  let refreshTimer = null;
  let busy = false;
  let loadingProjects = false;

  function getAccessToken() {
    try {
      for (let index = 0; index < localStorage.length; index += 1) {
        const key = localStorage.key(index);

        if (!key || !key.startsWith("sb-") || !key.endsWith("-auth-token")) {
          continue;
        }

        const stored = JSON.parse(localStorage.getItem(key) || "{}");
        const accessToken =
          stored.access_token ||
          stored.currentSession?.access_token ||
          stored.session?.access_token;

        if (accessToken) {
          return accessToken;
        }
      }
    } catch (error) {
      console.error("Unable to read the Supabase session.", error);
    }

    return "";
  }

  async function domainApi(action, options = {}) {
    const accessToken = getAccessToken();

    if (!accessToken) {
      throw new Error("Your session has expired. Sign out and sign back in.");
    }

    const domainQuery = String(action || "")
      .replace(/^\?/, "")
      .replace(/^action=/, "domain_action=");
    const response = await fetch(`/api/api?action=domain&${domainQuery}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
        ...(options.headers || {})
      },
      cache: "no-store"
    });

    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(payload.error || `Request failed (${response.status}).`);
    }

    return payload;
  }

  function setText(id, value) {
    const element = $(id);
    if (element) element.textContent = value;
  }

  function setValue(id, value) {
    const element = $(id);
    if (element) element.value = value;
  }

  function setHref(id, value) {
    const element = $(id);
    if (!element) return;

    element.href = value || "#";
    element.classList.toggle("disabled-link", !value);
  }

  function setHidden(id, hidden) {
    const element = $(id);
    if (element) element.classList.toggle("hidden", hidden);
  }

  function showMessage(id, text, type = "") {
    const element = $(id);
    if (!element) return;

    element.textContent = text || "";
    element.className = `dm-inline-message${type ? ` ${type}` : ""}`;
  }

  function cleanDomain(value) {
    return String(value || "")
      .trim()
      .toLowerCase()
      .replace(/^https?:\/\//, "")
      .replace(/\/.*$/, "");
  }

  function cleanSlug(value) {
    return String(value || "")
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .replace(/-{2,}/g, "-")
      .slice(0, 63);
  }

  function escapeHtml(value) {
    return String(value || "").replace(/[&<>"']/g, (character) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;"
    })[character]);
  }

  function domainStatusLabel(status) {
    return ({
      not_connected: "Not Connected",
      verifying: "Verifying",
      connected: "Connected",
      failed: "Needs Attention",
      removing: "Removing"
    })[status] || "Not Connected";
  }

  function sslStatusLabel(status) {
    return ({
      active: "Active",
      provisioning: "Provisioning",
      failed: "Needs Attention",
      waiting: "Waiting"
    })[status] || "Waiting";
  }

  function setBusy(value) {
    busy = value;

    [
      "dmCheckSlugBtn",
      "dmReserveSlugBtn",
      "dmConnectBtn",
      "dmVerifyBtn",
      "dmRetryBtn",
      "dmRemoveBtn",
      "dmRefreshAllBtn"
    ].forEach((id) => {
      const button = $(id);
      if (button) button.disabled = value;
    });
  }

  function selectedProjectId() {
    return $("dmProjectSelect")?.value ||
      $("publishingCenterProjectSelect")?.value ||
      "";
  }

  function updateLocalProject(project) {
    if (!project?.id) return;

    const index = projects.findIndex((item) => item.id === project.id);

    if (index >= 0) {
      projects[index] = { ...projects[index], ...project };
    } else {
      projects.push(project);
    }

    currentProject = project;
  }

  function populateProjectSelectors(preferredId = "") {
    const domainSelect = $("dmProjectSelect");
    const publishingSelect = $("publishingCenterProjectSelect");
    const previousDomainId = domainSelect?.value || "";
    const previousPublishingId = publishingSelect?.value || "";

    const options = projects.length
      ? projects.map((project) => {
          const projectName = project.name || "Untitled Website";
          return `<option value="${escapeHtml(project.id)}">${escapeHtml(projectName)}</option>`;
        }).join("")
      : '<option value="">No websites found</option>';

    if (domainSelect) domainSelect.innerHTML = options;
    if (publishingSelect) publishingSelect.innerHTML = options;

    const requestedId =
      preferredId ||
      previousDomainId ||
      previousPublishingId ||
      projects[0]?.id ||
      "";

    if (domainSelect && projects.some((project) => project.id === requestedId)) {
      domainSelect.value = requestedId;
    }

    if (publishingSelect && projects.some((project) => project.id === requestedId)) {
      publishingSelect.value = requestedId;
    }
  }

  function syncProjectSelectors(projectId, sourceId) {
    if (!projectId) return;

    const domainSelect = $("dmProjectSelect");
    const publishingSelect = $("publishingCenterProjectSelect");

    if (sourceId !== "dmProjectSelect" && domainSelect) {
      domainSelect.value = projectId;
    }

    if (sourceId !== "publishingCenterProjectSelect" && publishingSelect) {
      publishingSelect.value = projectId;
    }
  }

  function renderDomainManager(project) {
    currentProject = project || null;

    const slug = project?.slug || "";
    const bluvixaUrl = slug ? `https://bluvixa.com/site/${slug}` : "";
    const customDomain = project?.custom_domain || "";
    const domainStatus = project?.domain_status || "not_connected";
    const sslStatus = project?.ssl_status || "waiting";
    const hasCustomDomain = Boolean(customDomain);

    const statusClass =
      domainStatus === "connected"
        ? "connected"
        : domainStatus === "failed"
          ? "failed"
          : domainStatus === "verifying"
            ? "verifying"
            : "waiting";

    setValue("dmSlugInput", slug);
    setValue("dmDomainInput", customDomain);

    setText("dmOverviewBluvixa", bluvixaUrl || "Not reserved");
    setText(
      "dmOverviewBluvixaDetail",
      bluvixaUrl ? "Ready to publish." : "Choose an address below."
    );

    setText("dmBluvixaAddress", bluvixaUrl || "Not reserved");
    setHref("dmBluvixaAddress", bluvixaUrl);
    setText("dmDetailBluvixa", bluvixaUrl || "Not reserved");

    setText("dmOverviewDomain", customDomain || "Not connected");
    setText(
      "dmOverviewDomainDetail",
      customDomain ? "Assigned to this website." : "Optional custom domain."
    );

    setText("dmOverviewSsl", sslStatusLabel(sslStatus));
    setText(
      "dmOverviewSslDetail",
      sslStatus === "active"
        ? "HTTPS is active."
        : "HTTPS activates after verification."
    );

    setText("dmSideDomain", customDomain || "No custom domain");
    setText("dmDetailDomainStatus", domainStatusLabel(domainStatus));
    setText("dmDetailDnsStatus", project?.dns_verified ? "Yes" : "No");
    setText("dmDetailSslStatus", sslStatusLabel(sslStatus));
    setText(
      "dmDetailVerifiedAt",
      project?.verified_at
        ? new Date(project.verified_at).toLocaleString()
        : "—"
    );
    setText(
      "dmDetailLastChecked",
      project?.domain_last_checked_at
        ? new Date(project.domain_last_checked_at).toLocaleString()
        : "—"
    );

    const liveDot = $("dmLiveDot");
    if (liveDot) liveDot.className = `dm-live-dot ${statusClass}`;

    const statusPill = $("dmStatusPill");
    if (statusPill) {
      statusPill.className = `dm-status-pill ${statusClass}`;
      statusPill.textContent = domainStatusLabel(domainStatus);
    }

    setText(
      "dmLiveTitle",
      domainStatus === "connected"
        ? "Domain connected"
        : domainStatus === "verifying"
          ? "Waiting for DNS"
          : domainStatus === "failed"
            ? "Domain needs attention"
            : "Not connected"
    );

    setText(
      "dmLiveMessage",
      project?.domain_error ||
        (domainStatus === "connected"
          ? "Custom domain is verified and secured."
          : domainStatus === "verifying"
            ? "Add the DNS records and retry verification."
            : "Enter a custom domain and select Connect Domain.")
    );

    setHidden("dmDnsEmpty", hasCustomDomain);
    setHidden("dmDnsRecords", !hasCustomDomain);

    const dnsRecords = Array.isArray(project?.dns_records)
      ? project.dns_records
      : [];

    const aRecord = dnsRecords.find((record) => record.type === "A");
    const cnameRecord = dnsRecords.find((record) => record.type === "CNAME");

    setText("dmDnsType1", aRecord?.type || "A");
    setText("dmDnsHost1", aRecord?.name || "@");
    setText("dmDnsValue1", aRecord?.value || "76.76.21.21");

    setText("dmDnsType2", cnameRecord?.type || "CNAME");
    setText("dmDnsHost2", cnameRecord?.name || "www");
    setText(
      "dmDnsValue2",
      cnameRecord?.value || "cname.vercel-dns.com"
    );

    const verificationRecord = project?.verification_record || null;
    setHidden("dmVerificationRecord", !verificationRecord);

    if (verificationRecord) {
      setText(
        "dmVerificationHost",
        verificationRecord.name || "_vercel"
      );
      setText("dmVerificationValue", verificationRecord.value || "");
    }

    const publishingBadge = $("dmPublishingDomainBadge");
    if (publishingBadge) {
      publishingBadge.className = `dm-mini-badge ${statusClass}`;
      publishingBadge.textContent = domainStatusLabel(domainStatus);
    }

    setText(
      "publishingMetricDomain",
      customDomain || bluvixaUrl || "Bluvixa address"
    );

    setText(
      "publishingMetricDomainDetail",
      customDomain
        ? domainStatusLabel(domainStatus)
        : bluvixaUrl
          ? "Bluvixa address reserved"
          : "No address reserved"
    );

    setText("publishingMetricSsl", sslStatusLabel(sslStatus));

    setText(
      "dmPublishingSslDetail",
      sslStatus === "active"
        ? "HTTPS is active"
        : customDomain
          ? "HTTPS activates after domain verification"
          : "HTTPS activates after publishing"
    );

    const removeButton = $("dmRemoveBtn");
    if (removeButton) removeButton.disabled = busy || !hasCustomDomain;

    scheduleAutomaticRefresh();
  }

  async function loadProjects(preferredId = "") {
    if (loadingProjects) return;
    loadingProjects = true;
    setBusy(true);

    try {
      const data = await domainApi("action=status");
      projects = Array.isArray(data.projects) ? data.projects : [];
      populateProjectSelectors(preferredId);

      if (projects.length) {
        await loadSelectedProjectStatus(true);
      } else {
        renderDomainManager(null);
      }
    } catch (error) {
      showMessage("dmStatusMessage", error.message, "error");
    } finally {
      loadingProjects = false;
      setBusy(false);
    }
  }

  async function loadSelectedProjectStatus(quiet = false) {
    const projectId = selectedProjectId();

    if (!projectId) {
      renderDomainManager(null);
      return;
    }

    try {
      const data = await domainApi(
        `action=status&project_id=${encodeURIComponent(projectId)}`
      );

      updateLocalProject(data.domain);
      syncProjectSelectors(projectId);
      renderDomainManager(data.domain);

      if (!quiet) {
        showMessage("dmStatusMessage", "Status refreshed.", "success");
      }
    } catch (error) {
      if (!quiet) {
        showMessage("dmStatusMessage", error.message, "error");
      }
    }
  }

  async function checkOrReserveSlug(reserve) {
    const projectId = selectedProjectId();
    const slug = cleanSlug($("dmSlugInput")?.value);

    setValue("dmSlugInput", slug);

    if (!projectId) {
      showMessage("dmSlugMessage", "Select a website first.", "error");
      return;
    }

    if (slug.length < 3) {
      showMessage(
        "dmSlugMessage",
        "Use at least 3 letters or numbers.",
        "error"
      );
      return;
    }

    setBusy(true);
    showMessage(
      "dmSlugMessage",
      reserve ? "Reserving address…" : "Checking availability…",
      "info"
    );

    try {
      const action = reserve ? "reserve-slug" : "check-slug";
      const data = await domainApi(`action=${action}`, {
        method: "POST",
        body: JSON.stringify({
          project_id: projectId,
          slug
        })
      });

      if (reserve) {
        updateLocalProject(data.domain);
        renderDomainManager(data.domain);
        showMessage("dmSlugMessage", data.message, "success");
      } else {
        showMessage(
          "dmSlugMessage",
          data.available
            ? `${data.url} is available.`
            : "That address is already reserved.",
          data.available ? "success" : "error"
        );
      }
    } catch (error) {
      showMessage("dmSlugMessage", error.message, "error");
    } finally {
      setBusy(false);
    }
  }

  async function connectCustomDomain() {
    const projectId = selectedProjectId();
    const domain = cleanDomain($("dmDomainInput")?.value);

    setValue("dmDomainInput", domain);

    if (!projectId) {
      showMessage("dmConnectMessage", "Select a website first.", "error");
      return;
    }

    if (!domain) {
      showMessage("dmConnectMessage", "Enter a domain first.", "error");
      return;
    }

    setBusy(true);
    showMessage(
      "dmConnectMessage",
      "Adding domain to Vercel…",
      "info"
    );

    try {
      const data = await domainApi("action=connect", {
        method: "POST",
        body: JSON.stringify({
          project_id: projectId,
          domain
        })
      });

      updateLocalProject(data.domain);
      renderDomainManager(data.domain);
      showMessage("dmConnectMessage", data.message, "success");
    } catch (error) {
      showMessage("dmConnectMessage", error.message, "error");
    } finally {
      setBusy(false);
    }
  }

  async function verifyCustomDomain() {
    const projectId = selectedProjectId();

    if (!projectId) {
      showMessage("dmStatusMessage", "Select a website first.", "error");
      return;
    }

    setBusy(true);
    showMessage("dmStatusMessage", "Checking DNS and SSL…", "info");

    try {
      const data = await domainApi("action=check", {
        method: "POST",
        body: JSON.stringify({ project_id: projectId })
      });

      updateLocalProject(data.domain);
      renderDomainManager(data.domain);

      showMessage(
        "dmStatusMessage",
        data.message,
        data.domain?.domain_status === "connected" ? "success" : "info"
      );
    } catch (error) {
      showMessage("dmStatusMessage", error.message, "error");
    } finally {
      setBusy(false);
    }
  }

  async function removeCustomDomain() {
    const projectId = selectedProjectId();

    if (!currentProject?.custom_domain) {
      showMessage(
        "dmStatusMessage",
        "No custom domain is connected.",
        "error"
      );
      return;
    }

    const confirmed = window.confirm(
      `Remove ${currentProject.custom_domain}?`
    );

    if (!confirmed) return;

    setBusy(true);

    try {
      const data = await domainApi("action=remove", {
        method: "POST",
        body: JSON.stringify({ project_id: projectId })
      });

      updateLocalProject(data.domain);
      renderDomainManager(data.domain);

      showMessage(
        "dmStatusMessage",
        "Custom domain removed. The Bluvixa address remains available.",
        "success"
      );
    } catch (error) {
      showMessage("dmStatusMessage", error.message, "error");
    } finally {
      setBusy(false);
    }
  }

  function scheduleAutomaticRefresh() {
    window.clearInterval(refreshTimer);

    if (
      !$("dmAutoRefreshToggle")?.checked ||
      !currentProject?.custom_domain ||
      currentProject?.domain_status === "connected"
    ) {
      return;
    }

    refreshTimer = window.setInterval(() => {
      if (!busy && window.location.hash === "#domains") {
        loadSelectedProjectStatus(true);
      }
    }, 30000);
  }

  function domainsPageIsOpen() {
    return window.location.hash === "#domains";
  }

  function bindEvents() {
    $("dmCheckSlugBtn")?.addEventListener("click", () => {
      checkOrReserveSlug(false);
    });

    $("dmReserveSlugBtn")?.addEventListener("click", () => {
      checkOrReserveSlug(true);
    });

    $("dmConnectBtn")?.addEventListener("click", connectCustomDomain);
    $("dmVerifyBtn")?.addEventListener("click", verifyCustomDomain);
    $("dmRetryBtn")?.addEventListener("click", verifyCustomDomain);
    $("dmRemoveBtn")?.addEventListener("click", removeCustomDomain);

    $("dmRefreshAllBtn")?.addEventListener("click", () => {
      loadProjects(selectedProjectId());
    });

    $("dmProjectSelect")?.addEventListener("change", async (event) => {
      syncProjectSelectors(event.target.value, "dmProjectSelect");
      await loadSelectedProjectStatus(true);
    });

    $("publishingCenterProjectSelect")?.addEventListener(
      "change",
      async (event) => {
        syncProjectSelectors(
          event.target.value,
          "publishingCenterProjectSelect"
        );
        await loadSelectedProjectStatus(true);
      }
    );

    $("dmAutoRefreshToggle")?.addEventListener(
      "change",
      scheduleAutomaticRefresh
    );

    $("dmSlugInput")?.addEventListener("input", (event) => {
      event.target.value = cleanSlug(event.target.value);
    });

    $("dmSlugInput")?.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        checkOrReserveSlug(false);
      }
    });

    $("dmDomainInput")?.addEventListener("input", (event) => {
      event.target.value = event.target.value.replace(/\s+/g, "");
    });

    $("dmDomainInput")?.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        connectCustomDomain();
      }
    });

    document.addEventListener("click", async (event) => {
      const copyButton = event.target.closest(".dm-copy-btn");
      if (!copyButton) return;

      const target = $(copyButton.dataset.copyTarget);
      const value = target?.textContent?.trim();

      if (!value) return;

      try {
        await navigator.clipboard.writeText(value);
        const originalText = copyButton.textContent;
        copyButton.textContent = "Copied";

        window.setTimeout(() => {
          copyButton.textContent = originalText;
        }, 1200);
      } catch (error) {
        window.prompt("Copy this value:", value);
      }
    });
  }

  document.addEventListener("DOMContentLoaded", () => {
    bindEvents();

    if (domainsPageIsOpen()) {
      loadProjects();
    }
  });

  window.addEventListener("hashchange", () => {
    if (domainsPageIsOpen()) {
      loadProjects(selectedProjectId());
    } else {
      window.clearInterval(refreshTimer);
    }
  });

  window.addEventListener("bluvixa:projects-updated", (event) => {
    if (!domainsPageIsOpen()) return;
    loadProjects(event.detail?.projectId || selectedProjectId());
  });

  window.BluvixaDomainManager = {
    refresh: () => loadProjects(selectedProjectId()),
    refreshCurrent: () => loadSelectedProjectStatus(false),
    getCurrentProject: () => currentProject
  };
})();

/* ================= VISUAL BUILDER ================= */

"use strict";

    var PLAN_CONFIG = {
      starter:{name:"Starter",monthly:15,annual:180,buyout:499,photos:10,gallery:0},
      professional:{name:"Professional",monthly:29,annual:348,buyout:599,photos:15,gallery:12},
      advanced:{name:"Advanced",monthly:49,annual:588,buyout:699,photos:20,gallery:12}
    };

    var STORAGE_KEY = "bluvixa_v25_backend_ready_final";
    var DRAFT_DB_NAME = "bluvixa_builder_storage";
    var DRAFT_DB_STORE = "drafts";
    var DRAFT_DB_KEY = "current_project";

    function openDraftDatabase(){
      return new Promise(function(resolve,reject){
        if(!window.indexedDB){reject(new Error("IndexedDB is unavailable."));return;}
        var request=indexedDB.open(DRAFT_DB_NAME,1);
        request.onupgradeneeded=function(){
          var database=request.result;
          if(!database.objectStoreNames.contains(DRAFT_DB_STORE)){
            database.createObjectStore(DRAFT_DB_STORE);
          }
        };
        request.onsuccess=function(){resolve(request.result);};
        request.onerror=function(){reject(request.error||new Error("Device storage could not be opened."));};
      });
    }

    async function saveDraftToDevice(projectState){
      var database=await openDraftDatabase();
      return new Promise(function(resolve,reject){
        var transaction=database.transaction(DRAFT_DB_STORE,"readwrite");
        transaction.objectStore(DRAFT_DB_STORE).put(projectState,DRAFT_DB_KEY);
        transaction.oncomplete=function(){database.close();resolve();};
        transaction.onerror=function(){database.close();reject(transaction.error||new Error("Device save failed."));};
      });
    }

    async function loadDraftFromDevice(){
      var database=await openDraftDatabase();
      return new Promise(function(resolve,reject){
        var transaction=database.transaction(DRAFT_DB_STORE,"readonly");
        var request=transaction.objectStore(DRAFT_DB_STORE).get(DRAFT_DB_KEY);
        request.onsuccess=function(){database.close();resolve(request.result||null);};
        request.onerror=function(){database.close();reject(request.error||new Error("Device draft could not be loaded."));};
      });
    }
    var pendingPhotoMedia = {src:"",type:""};
    var pendingGalleryMedia = {src:"",type:""};

    var state = {
      plan:"professional",
      business:{
        name:"",
        bio:"",
        phone:"",
        email:"",
        hours:"",
        address:"",
        callText:""
      },
      header:{
        tagline:"",
        headline:"",
        image:"",
        bio:""
      },
      design:{
        logo:"",
        themeColor:"#1769ff",
        headerColor:"#082b5e",
        buttonColor:"#1769ff",
        cardColor:"#ffffff",
        logoOutlineColor:"#61c7ff",
        scroll:["Home","Services","Gallery","Reviews","Contact"],
        aboutHeading:"",
        aboutCover:"",
        mapHeading:"",
        mapCover:"",
        featuredHeading:"",
        featuredDescription:"",
        galleryHeading:"",
        galleryDescription:"",
        featuredCover:"",
        galleryCover:""
      },
      photos:[],
      gallery:[],
      mapUrl:"",
      billing:{status:"trialing",boughtOut:false},
      project:{slug:"",domainMode:"subdomain",customDomain:"",domainStatus:"not_connected",dnsVerified:false},
      backend:{userId:null,websiteId:null,published:false,updatedAt:null}
    };

    function byId(id){return document.getElementById(id);}
    function all(selector){return Array.prototype.slice.call(document.querySelectorAll(selector));}

    function escapeHtml(value){
      return String(value == null ? "" : value)
        .replace(/&/g,"&amp;")
        .replace(/</g,"&lt;")
        .replace(/>/g,"&gt;")
        .replace(/"/g,"&quot;")
        .replace(/'/g,"&#039;");
    }

    function phoneHref(value){
      return "tel:" + String(value || "").replace(/[^\d+]/g,"");
    }

    function sanitizeSlug(value){
      return String(value || "")
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9-]+/g,"-")
        .replace(/-+/g,"-")
        .replace(/^-|-$/g,"")
        .slice(0,63);
    }

    function normalizeDomain(value){
      return String(value || "")
        .toLowerCase()
        .trim()
        .replace(/^https?:\/\//,"")
        .replace(/^www\./,"")
        .replace(/\/$/,"");
    }

    function isValidDomain(value){
      return /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i.test(value);
    }

    function getPublishedUrl(){
      if(state.project.domainMode === "custom" && state.project.customDomain){
        return "https://" + state.project.customDomain;
      }
      return "https://" + (state.project.slug || "website") + ".bluvixa.com";
    }

    function showToast(message){
      var toast = byId("toast");
      toast.textContent = message;
      toast.classList.add("show");
      clearTimeout(showToast.timer);
      showToast.timer = setTimeout(function(){toast.classList.remove("show");},2600);
    }

    async function readFile(file,allowedTypes,callback){
      if(!file){return;}
      var allowed = allowedTypes.some(function(prefix){return file.type.indexOf(prefix) === 0;});
      if(!allowed){
        showToast(allowedTypes.indexOf("video/") >= 0 ? "Please choose an image or video file." : "Please choose an image file.");
        return;
      }

      if(typeof window.bluvixaUploadMedia === "function"){
        try{
          var uploaded = await window.bluvixaUploadMedia(file,allowedTypes.indexOf("video/") >= 0 ? "media" : "image");
          callback(uploaded.url,uploaded.type,uploaded.path);
          document.dispatchEvent(new CustomEvent("bluvixa:builder-change",{detail:{reason:"media-upload",path:uploaded.path}}));
          return;
        }catch(error){
          showToast("Cloud upload failed: " + (error.message || "Unknown error"));
          return;
        }
      }

      var reader = new FileReader();
      reader.onload = function(){
        callback(reader.result,file.type.indexOf("video/") === 0 ? "video" : "image","");
        document.dispatchEvent(new CustomEvent("bluvixa:builder-change",{detail:{reason:"local-media"}}));
      };
      reader.onerror = function(){showToast("That file could not be read.");};
      reader.readAsDataURL(file);
    }

    function readImage(file,callback){
      readFile(file,["image/"],function(src){callback(src);});
    }

    function readMedia(file,callback){
      readFile(file,["image/","video/"],callback);
    }

    function mediaMarkup(item,className){
      var src = item && (item.src || item.image || item.video || "");
      var type = item && (item.type || (item.video ? "video" : "image"));
      if(!src){return "";}
      if(type === "video"){
        return '<video class="' + className + '" src="' + src + '" controls playsinline preload="metadata"></video>';
      }
      return '<img class="' + className + '" src="' + src + '" alt="">';
    }

    function cloneState(input){
      return JSON.parse(JSON.stringify(input));
    }

    function syncFromInputs(){
      state.plan = byId("planSelect").value;
      state.business.name = byId("businessName").value.trim();
      state.business.bio = byId("businessBio").value.trim();
      state.business.phone = byId("phoneNumber").value.trim();
      state.business.email = byId("emailAddress").value.trim();
      state.business.hours = byId("businessHours").value.trim();
      state.business.callText = byId("callButtonText").value.trim();
      state.business.address = byId("businessAddress").value.trim();
      state.header.tagline = byId("headerTagline").value.trim();
      state.header.headline = byId("headerHeadline").value.trim();
      state.design.themeColor = byId("themeColor").value;
      state.design.headerColor = byId("headerColor").value;
      state.design.buttonColor = byId("buttonColor").value;
      state.design.cardColor = byId("cardColor").value;
      state.design.logoOutlineColor = byId("logoOutlineColor").value;
      state.design.scroll = byId("scrollItems").value.split(",").map(function(item){return item.trim();}).filter(Boolean);
      state.design.aboutHeading = byId("aboutHeading").value.trim();
      state.design.mapHeading = byId("mapHeading").value.trim();
      state.mapUrl = byId("mapEmbedUrl").value.trim();
      state.billing.status = byId("subscriptionStatus").value;
      state.project.slug = sanitizeSlug(byId("projectSlug").value);
      state.project.domainMode = byId("domainModeCustom").checked ? "custom" : "subdomain";
      state.project.customDomain = normalizeDomain(byId("customDomain").value);

      state.header.bio = byId("headerBio").value.trim();
      state.design.featuredHeading = byId("featuredHeading").value.trim();
      state.design.featuredDescription = byId("featuredDescription").value.trim();
      state.design.galleryHeading = byId("galleryHeading").value.trim();
      state.design.galleryDescription = byId("galleryDescription").value.trim();
    }

    function applyToInputs(){
      byId("planSelect").value = state.plan;
      byId("businessName").value = state.business.name;
      byId("businessBio").value = state.business.bio;
      byId("phoneNumber").value = state.business.phone;
      byId("emailAddress").value = state.business.email;
      byId("businessHours").value = state.business.hours;
      byId("callButtonText").value = state.business.callText;
      byId("businessAddress").value = state.business.address;
      byId("headerTagline").value = state.header.tagline || "";
      byId("headerHeadline").value = state.header.headline;
      byId("headerBio").value = state.header.bio || "";
      byId("themeColor").value = state.design.themeColor || "#1769ff";
      byId("headerColor").value = state.design.headerColor || "#082b5e";
      byId("buttonColor").value = state.design.buttonColor || "#1769ff";
      byId("cardColor").value = state.design.cardColor || "#ffffff";
      byId("logoOutlineColor").value = state.design.logoOutlineColor || "#61c7ff";
      byId("scrollItems").value = state.design.scroll.join(", ");
      byId("aboutHeading").value = state.design.aboutHeading || "";
      byId("mapHeading").value = state.design.mapHeading || "";
      byId("featuredHeading").value = state.design.featuredHeading || "";
      byId("featuredDescription").value = state.design.featuredDescription || "";
      byId("galleryHeading").value = state.design.galleryHeading || "";
      byId("galleryDescription").value = state.design.galleryDescription || "";
      byId("mapEmbedUrl").value = state.mapUrl;
      byId("subscriptionStatus").value = state.billing.status;
      byId("projectSlug").value = state.project.slug;
      byId("customDomain").value = state.project.customDomain || "";
      byId("domainModeCustom").checked = state.project.domainMode === "custom";
      byId("domainModeSubdomain").checked = state.project.domainMode !== "custom";
    }

    function enforcePlan(){
      if(!state || typeof state !== "object"){return;}
      var planKey = String(state.plan || "starter").toLowerCase();
      var config = PLAN_CONFIG[planKey] || PLAN_CONFIG.starter;
      state.plan = planKey in PLAN_CONFIG ? planKey : "starter";
      state.photos = Array.isArray(state.photos) ? state.photos : [];
      state.gallery = Array.isArray(state.gallery) ? state.gallery : [];

      state.photos = state.photos.slice(0,config.photos);
      state.gallery = state.gallery.slice(0,config.gallery);
      byId("headerNotice").textContent = config.name + " includes one main headline and one header bio.";
      byId("photoNotice").textContent = config.name + " allows " + config.photos + " uploads. Set one section header and one section bio above; each upload includes one photo or video and one description.";
      byId("galleryNotice").textContent = config.gallery === 0
        ? "Starter does not include the dedicated gallery upload section."
        : config.name + " allows up to " + config.gallery + " gallery uploads. Set one section header and one section bio; each upload includes one photo or video and one description.";

      byId("galleryControls").classList.toggle("hidden",config.gallery === 0);
      byId("previewGallerySection").classList.toggle("hidden",config.gallery === 0);

      byId("billingNotice").innerHTML =
        "<strong>" + config.name + "</strong><br>" +
        "$" + config.monthly + "/month equivalent, billed annually at $" + config.annual + ".<br>" +
        "Website buyout: $" + config.buyout + ".";

    }


    function darken(hex){
      var cleaned = String(hex).replace("#","");
      var value = parseInt(cleaned,16);
      var red = Math.max(0,(value >> 16) - 24);
      var green = Math.max(0,((value >> 8) & 255) - 24);
      var blue = Math.max(0,(value & 255) - 24);
      return "rgb(" + red + "," + green + "," + blue + ")";
    }

    function captureActiveField(){
      var active = document.activeElement;
      if(!active || !active.id){return null;}
      var snapshot = {id:active.id,scrollTop:active.scrollTop || 0};
      if(typeof active.selectionStart === "number"){
        snapshot.start = active.selectionStart;
        snapshot.end = active.selectionEnd;
      }
      return snapshot;
    }

    function restoreActiveField(snapshot){
      if(!snapshot){return;}
      var field = byId(snapshot.id);
      if(!field){return;}
      field.focus({preventScroll:true});
      if(typeof snapshot.start === "number" && typeof field.setSelectionRange === "function"){
        var max = field.value.length;
        field.setSelectionRange(Math.min(snapshot.start,max),Math.min(snapshot.end,max));
      }
      field.scrollTop = snapshot.scrollTop || 0;
    }

    function bindPreviewNavigation(){
      var scroller = document.querySelector(".preview-wrap");
      var preview = byId("preview");
      if(!scroller || !preview || scroller.dataset.navigationBound === "true"){return;}
      scroller.dataset.navigationBound = "true";

      scroller.addEventListener("click",function(event){
        var button = event.target.closest("[data-preview-target]");
        if(!button || !preview.contains(button)){return;}
        event.preventDefault();

        var target = byId(button.getAttribute("data-preview-target"));
        if(!target){return;}
        if(target.classList.contains("hidden")){
          showToast("That section is not available on the selected plan.");
          return;
        }

        var header = preview.querySelector(".site-header");
        var headerHeight = header ? header.offsetHeight : 0;
        var destination = Math.max(0,target.offsetTop - headerHeight - 10);

        scroller.scrollTo({top:destination,behavior:"smooth"});

        preview.querySelectorAll("[data-preview-target]").forEach(function(item){
          item.classList.toggle("active",item === button);
        });

        var siteNav = byId("previewSiteNav");
        var menuToggle = byId("previewMenuToggle");
        if(siteNav){siteNav.classList.remove("open");}
        if(menuToggle){
          menuToggle.classList.remove("open");
          menuToggle.setAttribute("aria-expanded","false");
          menuToggle.setAttribute("aria-label","Open website navigation");
        }
      });
    }

    function bindPreviewMenu(){
      var toggle = byId("previewMenuToggle");
      var nav = byId("previewSiteNav");
      var preview = byId("preview");
      if(!toggle || !nav || toggle.dataset.bound === "true"){return;}
      toggle.dataset.bound = "true";

      toggle.addEventListener("click",function(event){
        event.preventDefault();
        event.stopPropagation();
        var isOpen = nav.classList.toggle("open");
        toggle.classList.toggle("open",isOpen);
        toggle.setAttribute("aria-expanded",String(isOpen));
        toggle.setAttribute("aria-label",isOpen ? "Close website navigation" : "Open website navigation");
      });

      document.addEventListener("click",function(event){
        if(!preview.classList.contains("mobile")){return;}
        if(nav.contains(event.target) || toggle.contains(event.target)){return;}
        nav.classList.remove("open");
        toggle.classList.remove("open");
        toggle.setAttribute("aria-expanded","false");
        toggle.setAttribute("aria-label","Open website navigation");
      });
    }

    function render(){
      bindPreviewNavigation();
      bindPreviewMenu();
      var activeField = captureActiveField();
      syncFromInputs();
      enforcePlan();

      var config = PLAN_CONFIG[state.plan];
      var color = state.design.buttonColor;
      var href = phoneHref(state.business.phone);
      applyBrandingTheme();

      byId("previewBusinessName").textContent = (state.business.name || "Your Business").toUpperCase();
      byId("previewTagline").textContent = state.header.tagline || "";
      byId("previewTagline").hidden = !state.header.tagline;
      byId("previewHeadline").textContent = state.header.headline || "Build a stronger online presence.";
      byId("previewBusinessBio").textContent = state.business.bio || "";
      byId("previewPhone").textContent = state.business.phone || "";
      byId("previewEmail").textContent = state.business.email || "";
      byId("previewHours").textContent = state.business.hours || "";
      byId("previewAddress").textContent = state.business.address || "";
      byId("previewMapAddress").textContent = state.business.address || "";
      byId("previewAboutHeading").textContent = state.design.aboutHeading || "";
      byId("previewAboutHeading").hidden = !state.design.aboutHeading;
      byId("previewMapHeading").textContent = state.design.mapHeading || "";
      byId("previewMapHeading").hidden = !state.design.mapHeading;
      var aboutSection = byId("previewAboutSection");
      aboutSection.style.backgroundImage = state.design.aboutCover
        ? 'linear-gradient(110deg,rgba(2,12,28,.88),rgba(2,12,28,.60)),url("' + state.design.aboutCover + '")'
        : "";
      aboutSection.classList.toggle("has-cover",!!state.design.aboutCover);
      var mapSection = byId("previewMapSection");
      mapSection.style.backgroundImage = state.design.mapCover
        ? 'linear-gradient(110deg,rgba(2,12,28,.88),rgba(2,12,28,.60)),url("' + state.design.mapCover + '")'
        : "";
      mapSection.classList.toggle("has-cover",!!state.design.mapCover);
      var featuredHeading = byId("previewFeaturedHeading");
      var featuredDescription = byId("previewFeaturedDescription");
      var galleryHeading = byId("previewGalleryHeading");
      var galleryDescription = byId("previewGalleryDescription");

      featuredHeading.textContent = state.design.featuredHeading || "";
      featuredHeading.hidden = !state.design.featuredHeading;
      featuredDescription.textContent = state.design.featuredDescription || "";
      featuredDescription.hidden = !state.design.featuredDescription;
      galleryHeading.textContent = state.design.galleryHeading || "";
      galleryHeading.hidden = !state.design.galleryHeading;
      galleryDescription.textContent = state.design.galleryDescription || "";
      galleryDescription.hidden = !state.design.galleryDescription;
      var featuredSection = byId("previewFeaturedSection");
      featuredSection.style.backgroundImage = state.design.featuredCover
        ? 'linear-gradient(110deg,rgba(2,12,28,.88),rgba(2,12,28,.62)),url("' + state.design.featuredCover + '")'
        : "";
      featuredSection.classList.toggle("has-cover",!!state.design.featuredCover);

      var gallerySection = byId("previewGallerySection");
      gallerySection.style.backgroundImage = state.design.galleryCover
        ? 'linear-gradient(110deg,rgba(2,12,28,.88),rgba(2,12,28,.62)),url("' + state.design.galleryCover + '")'
        : "";
      gallerySection.classList.toggle("has-cover",!!state.design.galleryCover);

      var featuredCover = byId("previewFeaturedCover");
      var galleryCover = byId("previewGalleryCover");
      featuredCover.classList.add("hidden");
      galleryCover.classList.add("hidden");
      byId("previewFooter").textContent = "© " + (state.business.name || "Your Business");

      ["previewCallButton","previewHeroCall","previewMapCall"].forEach(function(id){
        var element = byId(id);
        element.textContent = state.business.callText || "Call Now";
        element.href = href;
        element.style.background = "linear-gradient(180deg," + color + "," + darken(color) + ")";
      });

      byId("previewHero").style.backgroundImage = state.header.image
        ? 'linear-gradient(110deg,rgba(2,12,28,.94),rgba(2,12,28,.58)),url("' + state.header.image + '")'
        : "linear-gradient(110deg,rgba(2,12,28,.94),rgba(2,12,28,.58)),linear-gradient(135deg,#17365f,#08162e)";

      var bioWrap = byId("previewHeaderBios");
      bioWrap.innerHTML = "";

      if(state.header.bio){
        var item = document.createElement("div");
        item.className = "hero-bio";
        item.textContent = state.header.bio;
        item.style.borderLeftColor = color;
        bioWrap.appendChild(item);
      }

      var scrollWrap = byId("previewScroll");
      scrollWrap.innerHTML = "";

      state.design.scroll.forEach(function(item){
        var button = document.createElement("button");
        button.type = "button";
        button.className = "scroll-chip";
        button.textContent = item;
        scrollWrap.appendChild(button);
      });

      renderPhotos();
      renderGallery();
      renderEditorLists();
      renderMap();
      renderDomainSettings();
      renderBackendJson();

      var publishButton = byId("publishBtn");
      if(publishButton){
        publishButton.dataset.published = String(state.backend.published === true);
        publishButton.textContent = state.backend.published
          ? "Unpublish Website"
          : "Publish Website";
        publishButton.classList.toggle("btn-danger",state.backend.published === true);
      }

      byId("previewPhotoCount").textContent = "";
      byId("previewGalleryCount").textContent = "";
      byId("previewPhotoCount").hidden = true;
      byId("previewGalleryCount").hidden = true;
      byId("saveStatus").textContent = "Unsaved";

      updateColorLabels();
      updatePresetSelection();
      restoreActiveField(activeField);
    }

    function hexToRgb(hex){
      var clean = String(hex || "#000000").replace("#","");
      if(clean.length === 3){clean = clean.split("").map(function(c){return c+c;}).join("");}
      var number = parseInt(clean,16);
      if(Number.isNaN(number)){number = 0;}
      return {r:(number>>16)&255,g:(number>>8)&255,b:number&255};
    }

    function mixWithWhite(hex,amount){
      var rgb = hexToRgb(hex);
      var ratio = Math.max(0,Math.min(1,amount));
      var r = Math.round(rgb.r + (255-rgb.r)*ratio);
      var g = Math.round(rgb.g + (255-rgb.g)*ratio);
      var b = Math.round(rgb.b + (255-rgb.b)*ratio);
      return "rgb("+r+","+g+","+b+")";
    }

    function contrastColor(hex){
      var rgb = hexToRgb(hex);
      var luminance = (0.299*rgb.r + 0.587*rgb.g + 0.114*rgb.b);
      return luminance > 155 ? "#0f172a" : "#f8fafc";
    }

    function mutedColor(hex){
      return contrastColor(hex) === "#0f172a" ? "#526174" : "#d3deec";
    }

    function applyBrandingTheme(){
      var preview = byId("preview");
      var theme = state.design.themeColor || "#1769ff";
      var header = state.design.headerColor || "#082b5e";
      var button = state.design.buttonColor || theme;
      var card = state.design.cardColor || "#ffffff";
      var outline = state.design.logoOutlineColor || theme;

      preview.style.setProperty("--site-theme",theme);
      preview.style.setProperty("--site-theme-soft",mixWithWhite(theme,.88));
      preview.style.setProperty("--site-theme-pale",mixWithWhite(theme,.95));
      preview.style.setProperty("--site-header",header);
      preview.style.setProperty("--site-header-dark",darken(header));
      preview.style.setProperty("--site-button",button);
      preview.style.setProperty("--site-button-dark",darken(button));
      preview.style.setProperty("--site-card",card);
      preview.style.setProperty("--site-card-text",contrastColor(card));
      preview.style.setProperty("--site-card-muted",mutedColor(card));
      preview.style.setProperty("--site-logo-outline",outline);

      var logoFrame = byId("previewLogoFrame");
      var logoImage = byId("previewLogoImage");
      if(state.design.logo){
        logoImage.src = state.design.logo;
        logoFrame.classList.add("has-logo");
      }else{
        logoImage.removeAttribute("src");
        logoFrame.classList.remove("has-logo");
      }
    }

    function updateColorLabels(){
      ["themeColor","headerColor","buttonColor","cardColor","logoOutlineColor"].forEach(function(id){
        var value = byId(id).value;
        var label = byId(id+"Value");
        if(label){label.textContent = value;}
      });
    }

    function updatePresetSelection(){
      var presets = {
        blue:{theme:"#1769ff",header:"#082b5e",button:"#1769ff",outline:"#61c7ff"},
        purple:{theme:"#7c3aed",header:"#2e165d",button:"#7c3aed",outline:"#c4a7ff"},
        red:{theme:"#dc2626",header:"#5b1118",button:"#dc2626",outline:"#ff8b8b"},
        green:{theme:"#059669",header:"#06483a",button:"#059669",outline:"#6ee7b7"},
        orange:{theme:"#ea580c",header:"#5b2608",button:"#ea580c",outline:"#fdba74"}
      };
      all(".theme-preset").forEach(function(button){
        var preset = presets[button.getAttribute("data-theme")];
        button.classList.toggle("active",preset && preset.theme === state.design.themeColor && preset.header === state.design.headerColor && preset.button === state.design.buttonColor);
      });
    }

    function renderPhotos(){
      var grid = byId("previewPhotoGrid");
      grid.innerHTML = "";

      if(state.photos.length === 0){
        grid.innerHTML =
          '<article class="content-card">' +
          '<div class="media-placeholder"></div>' +
          '<div class="content-body"><p>No uploads added yet.</p></div>' +
          '</article>';
        return;
      }

      state.photos.forEach(function(item){
        var card = document.createElement("article");
        card.className = "content-card";
        card.innerHTML =
          (mediaMarkup(item,"card-media") || '<div class="media-placeholder"></div>') +
          '<div class="content-body">' +
          '<p>' + escapeHtml(item.description || "") + '</p>' +
          '</div>';
        grid.appendChild(card);
      });
    }

    function renderGallery(){
      var grid = byId("previewGalleryGrid");
      grid.innerHTML = "";

      if(state.gallery.length === 0 && PLAN_CONFIG[state.plan].gallery > 0){
        grid.innerHTML = '<div class="gallery-item"><div class="gallery-caption">No uploads added yet.</div></div>';
        return;
      }

      state.gallery.forEach(function(item){
        var card = document.createElement("div");
        card.className = "gallery-item";
        card.innerHTML =
          mediaMarkup(item,"gallery-media") +
          '<div class="gallery-caption">' + escapeHtml(item.description || "") + '</div>';
        grid.appendChild(card);
      });
    }

    function renderEditorLists(){
      var photoList = byId("photoEditorList");
      photoList.innerHTML = "";

      state.photos.forEach(function(item,index){
        var box = document.createElement("div");
        box.className = "editor-item";
        box.innerHTML =
          mediaMarkup(item,"editor-media") +
          '<div class="editor-row">' +
          '<strong>Upload ' + (index + 1) + '</strong>' +
          '<div class="editor-actions">' +
          '<button type="button" class="btn btn-secondary btn-small" data-photo-up="' + index + '">↑</button>' +
          '<button type="button" class="btn btn-danger btn-small" data-photo-delete="' + index + '">Delete</button>' +
          '</div></div>' +
          '<div class="tiny">' + escapeHtml(item.description || item.bio || "No description") + '</div>';

        photoList.appendChild(box);
      });

      var galleryList = byId("galleryEditorList");
      galleryList.innerHTML = "";

      state.gallery.forEach(function(item,index){
        var box = document.createElement("div");
        box.className = "editor-item";
        box.innerHTML =
          mediaMarkup(item,"editor-media") +
          '<div class="editor-row">' +
          '<strong>Upload ' + (index + 1) + '</strong>' +
          '<div class="editor-actions">' +
          '<button type="button" class="btn btn-secondary btn-small" data-gallery-up="' + index + '">↑</button>' +
          '<button type="button" class="btn btn-danger btn-small" data-gallery-delete="' + index + '">Delete</button>' +
          '</div></div>' +
          '<div class="tiny">' + escapeHtml(item.description || item.bio || "No description") + '</div>';

        galleryList.appendChild(box);
      });
    }

    function buildMapEmbedUrl(value){
      var input = String(value || "").trim();
      if(!input){return "";}

      // Keep a genuine Google Maps embed URL when one is pasted.
      if(/^https:\/\/(?:www\.)?google\.com\/maps\/embed\?/i.test(input) ||
         /^https:\/\/maps\.google\.com\/maps\?/i.test(input)){
        return input;
      }

      // Extract the q parameter from older Google Maps links when possible.
      try{
        if(/^https?:\/\//i.test(input)){
          var parsed = new URL(input);
          var query = parsed.searchParams.get("q") || parsed.searchParams.get("query");
          if(query){input = query;}
        }
      }catch(_error){}

      return "https://www.google.com/maps?q=" + encodeURIComponent(input) + "&output=embed";
    }

    function renderMap(){
      var frame = byId("previewMapFrame");
      var location = state.mapUrl || state.business.address || "";
      var embedUrl = buildMapEmbedUrl(location);

      if(embedUrl){
        frame.removeAttribute("srcdoc");
        frame.src = embedUrl;
        frame.loading = "lazy";
        frame.referrerPolicy = "no-referrer-when-downgrade";
        frame.setAttribute("allowfullscreen","");
      }else{
        frame.removeAttribute("src");
        frame.srcdoc =
          '<html><body style="margin:0;height:100%;display:grid;place-items:center;background:#dbeafe;font-family:Arial;color:#1e3a5f;text-align:center">' +
          '<div><div style="font-size:42px">&#128205;</div><strong>Business Location</strong><br><small>Enter an address or business name in the Map tab.</small></div>' +
          '</body></html>';
      }
    }

    function renderDomainSettings(){
      var customMode = state.project.domainMode === "custom";
      byId("subdomainSettings").classList.toggle("hidden",customMode);
      byId("customDomainSettings").classList.toggle("hidden",!customMode);

      var slug = sanitizeSlug(state.project.slug) || "website";
      state.project.slug = slug;
      byId("projectSlug").value = slug;
      byId("subdomainPreview").textContent = "https://" + slug + ".bluvixa.com";
      byId("publishedAddress").textContent = getPublishedUrl();

      var pill = byId("domainStatusPill");
      var message = byId("domainStatusMessage");
      var dnsPanel = byId("dnsPanel");

      pill.className = "status-pill";
      dnsPanel.classList.add("hidden");

      if(!customMode){
        pill.classList.add("connected");
        pill.textContent = "Ready";
        message.textContent = "Bluvixa will configure this address automatically.";
        return;
      }

      if(state.project.domainStatus === "connected" && state.project.dnsVerified){
        pill.classList.add("connected");
        pill.textContent = "Connected";
        message.textContent = state.project.customDomain + " is verified and ready for HTTPS.";
        dnsPanel.classList.remove("hidden");
      }else if(state.project.domainStatus === "waiting"){
        pill.classList.add("waiting");
        pill.textContent = "Waiting for DNS";
        message.textContent = "Add the DNS records below, then verify the connection.";
        dnsPanel.classList.remove("hidden");
      }else{
        pill.classList.add("offline");
        pill.textContent = "Not connected";
        message.textContent = "Enter your domain and select Connect Domain.";
      }
    }

    function renderBackendJson(){
      var config = PLAN_CONFIG[state.plan];

      var payload = {
        user:{
          id:state.backend.userId,
          email:state.business.email
        },
        subscription:{
          plan:state.plan,
          status:state.billing.status,
          monthly_equivalent_usd:config.monthly,
          annual_total_usd:config.annual,
          buyout_price_usd:config.buyout,
          trial_days:7,
          bought_out:state.billing.boughtOut
        },
        website:{
          id:state.backend.websiteId,
          user_id:state.backend.userId,
          slug:state.project.slug,
          domain_mode:state.project.domainMode,
          custom_domain:state.project.customDomain,
          domain_status:state.project.domainStatus,
          dns_verified:state.project.dnsVerified,
          published_url:getPublishedUrl(),
          business_name:state.business.name,
          business_bio:state.business.bio,
          phone:state.business.phone,
          email:state.business.email,
          business_hours:state.business.hours,
          address:state.business.address,
          call_button_text:state.business.callText,
          map_embed_url:state.mapUrl,
          published:state.backend.published,
          updated_at:state.backend.updatedAt
        },
        header:{
          headline:state.header.headline,
          image_url:state.header.image ? "[browser image data]" : "",
          bio:state.header.bio
        },
        site_settings:state.design,
        content_cards:state.photos,
        gallery_items:state.gallery,
        plan_limits:{
          content_photos:config.photos,
          gallery_uploads:config.gallery,
          header_bios:1
        }
      };

      byId("backendJson").textContent = JSON.stringify(payload,null,2);
    }

    function addPhoto(){
      syncFromInputs();

      var config = PLAN_CONFIG[state.plan];

      if(state.photos.length >= config.photos){
        showToast("You reached the " + config.photos + "-upload limit.");
        return;
      }

      var description = byId("photoDescription").value.trim();

      if(!description && !pendingPhotoMedia.src){
        showToast("Add a photo, video, or description first.");
        return;
      }

      state.photos.push({
        id:String(Date.now()) + Math.random(),
        description:description,
        src:pendingPhotoMedia.src,
        type:pendingPhotoMedia.type
      });

      byId("photoDescription").value = "";
      byId("photoFile").value = "";
      pendingPhotoMedia = {src:"",type:""};

      render();
      saveDraft(false);
    }

    function addGallery(){
      syncFromInputs();

      var config = PLAN_CONFIG[state.plan];

      if(config.gallery === 0){
        showToast("Starter does not include the gallery section.");
        return;
      }

      if(state.gallery.length >= config.gallery){
        showToast("You reached the " + config.gallery + "-upload gallery limit.");
        return;
      }

      var description = byId("galleryUploadDescription").value.trim();

      if(!description && !pendingGalleryMedia.src){
        showToast("Add a photo, video, or description first.");
        return;
      }

      state.gallery.push({
        id:String(Date.now()) + Math.random(),
        description:description,
        src:pendingGalleryMedia.src,
        type:pendingGalleryMedia.type
      });

      byId("galleryUploadDescription").value = "";
      byId("galleryFile").value = "";
      pendingGalleryMedia = {src:"",type:""};

      render();
      saveDraft(false);
    }

    function updateSaveIndicator(text,stateName){
      var status=byId("saveStatus");
      if(status){status.textContent=text;}
      var wrapper=status&&status.closest(".builder-save-status");
      if(wrapper){
        wrapper.classList.toggle("is-saving",stateName==="saving");
        wrapper.classList.toggle("is-error",stateName==="error");
      }
    }

    function saveDraft(showMessage){
      syncFromInputs();
      state.backend.updatedAt = new Date().toISOString();
      updateSaveIndicator("Saving…","saving");

      try{
        localStorage.setItem(STORAGE_KEY,JSON.stringify(state));
        updateSaveIndicator("Saved on this device","saved");
        if(showMessage){showToast("Draft saved on this device.");}
      }catch(error){
        saveDraftToDevice(cloneState(state)).then(function(){
          updateSaveIndicator("Saved on this device","saved");
          if(showMessage){showToast("Draft saved using expanded device storage.");}
        }).catch(function(){
          var signedIn=window.BluvixaMVP&&typeof window.BluvixaMVP.isSignedIn==="function"&&window.BluvixaMVP.isSignedIn();
          updateSaveIndicator(signedIn?"Use Cloud Save":"Sign in for Cloud Save","error");
          if(showMessage){
            showToast(signedIn
              ? "This device is full. Use Cloud Save in your Dashboard."
              : "This device is full. Sign in to save the project to your account.");
          }
        });
      }

      renderBackendJson();
    }

    async function loadDraft(){
      try{
        var saved = null;
        try{ saved = localStorage.getItem(STORAGE_KEY); }catch(_storageError){}
        var parsed = saved ? JSON.parse(saved) : await loadDraftFromDevice();

        if(!parsed){
          showToast("No saved draft was found on this device.");
          return;
        }

        if(!parsed || !PLAN_CONFIG[parsed.plan]){
          showToast("The saved draft was not valid.");
          return;
        }

        state = parsed;
        state.header = Object.assign({tagline:"",headline:"",image:"",bio:""},state.header || {});
        if(!state.header.bio && Array.isArray(state.header.bios)){
          state.header.bio = state.header.bios.filter(Boolean).join(" ");
        }
        delete state.header.bios;
        state.photos = Array.isArray(state.photos) ? state.photos.map(function(item){
          return {id:item.id || String(Date.now()) + Math.random(),src:item.src || item.image || item.video || "",type:item.type || (item.video ? "video" : "image"),description:item.description || item.bio || item.title || ""};
        }) : [];
        state.gallery = Array.isArray(state.gallery) ? state.gallery.map(function(item){
          return {id:item.id || String(Date.now()) + Math.random(),src:item.src || item.image || item.video || "",type:item.type || (item.video ? "video" : "image"),description:item.description || item.bio || item.title || ""};
        }) : [];
        state.project = Object.assign({
          slug:"summit-auto-care",
          domainMode:"subdomain",
          customDomain:"",
          domainStatus:"not_connected",
          dnsVerified:false
        },state.project || {});
        state.design = Object.assign({
          logo:"",
          themeColor:state.design && state.design.color ? state.design.color : "#1769ff",
          headerColor:"#082b5e",
          buttonColor:state.design && state.design.color ? state.design.color : "#1769ff",
          cardColor:"#ffffff",
          logoOutlineColor:"#61c7ff",
          scroll:["Home","Services","Gallery","Reviews","Contact"],
          aboutHeading:"",
          aboutCover:"",
          mapHeading:"",
          mapCover:"",
          featuredHeading:"",
          featuredDescription:"",
          galleryHeading:"",
          galleryDescription:"",
          featuredCover:"",
          galleryCover:""
        },state.design || {});
        applyToInputs();
        render();
        showToast("Saved draft loaded.");
      }catch(error){
        showToast("The saved draft could not be loaded.");
      }
    }

    function resetBuilder(){
      state = {
        plan:"professional",
        business:{
          name:"",
          bio:"",
          phone:"",
          email:"",
          hours:"",
          address:"",
          callText:""
        },
        header:{
          tagline:"",
          headline:"",
          image:"",
          bio:""
        },
        design:{
          logo:"",
          themeColor:"#1769ff",
          headerColor:"#082b5e",
          buttonColor:"#1769ff",
          cardColor:"#ffffff",
          logoOutlineColor:"#61c7ff",
          scroll:["Home","Services","Gallery","Reviews","Contact"],
          aboutHeading:"",
          aboutCover:"",
          mapHeading:"",
          mapCover:"",
          featuredHeading:"",
          featuredDescription:"",
          galleryHeading:"",
          galleryDescription:"",
          featuredCover:"",
          galleryCover:""
        },
        photos:[],
        gallery:[],
        mapUrl:"",
        billing:{status:"trialing",boughtOut:false},
        project:{slug:"",domainMode:"subdomain",customDomain:"",domainStatus:"not_connected",dnsVerified:false},
        backend:{userId:null,websiteId:null,published:false,updatedAt:null}
      };

      pendingPhotoMedia = {src:"",type:""};
      pendingGalleryMedia = {src:"",type:""};

      try{localStorage.removeItem(STORAGE_KEY);}catch(error){}
       openDraftDatabase().then(function(database){
         var transaction=database.transaction(DRAFT_DB_STORE,"readwrite");
         transaction.objectStore(DRAFT_DB_STORE).delete(DRAFT_DB_KEY);
         transaction.oncomplete=function(){database.close();};
       }).catch(function(){});

      applyToInputs();
      render();
      showToast("Builder reset.");
    }

    function switchTab(name){
      all(".tab").forEach(function(button){
        button.classList.toggle("active",button.getAttribute("data-tab") === name);
      });

      all(".panel").forEach(function(panel){
        panel.classList.toggle("active",panel.getAttribute("data-panel") === name);
      });
    }

    function setDevice(device){
      all(".device").forEach(function(button){
        button.classList.toggle("active",button.getAttribute("data-device") === device);
      });

      var preview = byId("preview");
      preview.classList.remove("tablet","mobile");

      if(device !== "desktop"){
        preview.classList.add(device);
      }

      var mobileNav = byId("previewSiteNav");
      var mobileToggle = byId("previewMenuToggle");
      if(mobileNav){mobileNav.classList.remove("open");}
      if(mobileToggle){
        mobileToggle.classList.remove("open");
        mobileToggle.setAttribute("aria-expanded","false");
        mobileToggle.setAttribute("aria-label","Open website navigation");
      }
    }

    function bindControls(){
      byId("tabs").addEventListener("click",function(event){
        var button = event.target.closest("[data-tab]");
        if(button){switchTab(button.getAttribute("data-tab"));}
      });

      all(".device").forEach(function(button){
        button.addEventListener("click",function(){
          setDevice(button.getAttribute("data-device"));
        });
      });

      [
        "planSelect","businessName","businessBio","phoneNumber","emailAddress",
        "businessHours","callButtonText","businessAddress","headerTagline","headerHeadline","headerBio",
        "scrollItems","aboutHeading","mapHeading","featuredHeading","featuredDescription","galleryHeading","galleryDescription","mapEmbedUrl","subscriptionStatus",
        "projectSlug","customDomain"
      ].forEach(function(id){
        byId(id).addEventListener("input",render);
        byId(id).addEventListener("change",render);
      });

      byId("headerImage").addEventListener("change",function(event){
        readImage(event.target.files[0],function(data){
          state.header.image = data;
          render();
          showToast("Header image selected.");
        });
      });

      byId("photoFile").addEventListener("change",function(event){
        readMedia(event.target.files[0],function(data,type,storagePath){
          pendingPhotoMedia = {src:data,type:type,storagePath:storagePath||""};
          showToast(type === "video" ? "Video selected." : "Photo selected.");
        });
      });

      byId("galleryFile").addEventListener("change",function(event){
        readMedia(event.target.files[0],function(data,type,storagePath){
          pendingGalleryMedia = {src:data,type:type,storagePath:storagePath||""};
          showToast(type === "video" ? "Gallery video selected." : "Gallery photo selected.");
        });
      });

      byId("aboutCoverFile").addEventListener("change",function(event){
        readImage(event.target.files[0],function(data){
          state.design.aboutCover = data;
          render();
          showToast("About background cover selected.");
        });
      });

      byId("mapCoverFile").addEventListener("change",function(event){
        readImage(event.target.files[0],function(data){
          state.design.mapCover = data;
          render();
          showToast("Map background cover selected.");
        });
      });

      byId("removeAboutCoverBtn").addEventListener("click",function(){
        state.design.aboutCover = "";
        byId("aboutCoverFile").value = "";
        render();
        showToast("About cover removed.");
      });

      byId("removeMapCoverBtn").addEventListener("click",function(){
        state.design.mapCover = "";
        byId("mapCoverFile").value = "";
        render();
        showToast("Map cover removed.");
      });

      byId("featuredCoverFile").addEventListener("change",function(event){
        readImage(event.target.files[0],function(data){
          state.design.featuredCover = data;
          render();
          showToast("First section cover photo selected.");
        });
      });

      byId("galleryCoverFile").addEventListener("change",function(event){
        readImage(event.target.files[0],function(data){
          state.design.galleryCover = data;
          render();
          showToast("Second section cover photo selected.");
        });
      });

      byId("removeFeaturedCoverBtn").addEventListener("click",function(){
        state.design.featuredCover = "";
        byId("featuredCoverFile").value = "";
        render();
        showToast("First section cover photo removed.");
      });

      byId("removeGalleryCoverBtn").addEventListener("click",function(){
        state.design.galleryCover = "";
        byId("galleryCoverFile").value = "";
        render();
        showToast("Second section cover photo removed.");
      });

      byId("addPhotoBtn").addEventListener("click",addPhoto);
      byId("addGalleryBtn").addEventListener("click",addGallery);

      byId("photoEditorList").addEventListener("click",function(event){
        var deleteIndex = event.target.getAttribute("data-photo-delete");
        var upIndex = event.target.getAttribute("data-photo-up");

        if(deleteIndex !== null){
          state.photos.splice(Number(deleteIndex),1);
          render();
          saveDraft(false);
        }

        if(upIndex !== null){
          var index = Number(upIndex);

          if(index > 0){
            var temp = state.photos[index - 1];
            state.photos[index - 1] = state.photos[index];
            state.photos[index] = temp;
            render();
            saveDraft(false);
          }
        }
      });

      byId("galleryEditorList").addEventListener("click",function(event){
        var deleteIndex = event.target.getAttribute("data-gallery-delete");
        var upIndex = event.target.getAttribute("data-gallery-up");

        if(deleteIndex !== null){
          state.gallery.splice(Number(deleteIndex),1);
          render();
          saveDraft(false);
        }

        if(upIndex !== null){
          var index = Number(upIndex);

          if(index > 0){
            var temp = state.gallery[index - 1];
            state.gallery[index - 1] = state.gallery[index];
            state.gallery[index] = temp;
            render();
            saveDraft(false);
          }
        }
      });

      ["themeColor","headerColor","buttonColor","cardColor","logoOutlineColor"].forEach(function(id){
        byId(id).addEventListener("input",render);
        byId(id).addEventListener("change",render);
      });

      byId("businessLogo").addEventListener("change",function(event){
        readImage(event.target.files[0],function(data){
          state.design.logo = data;
          render();
          showToast("Business logo selected.");
        });
      });

      byId("removeLogoBtn").addEventListener("click",function(){
        state.design.logo = "";
        byId("businessLogo").value = "";
        render();
        showToast("Business logo removed.");
      });

      byId("themePresets").addEventListener("click",function(event){
        var button = event.target.closest("[data-theme]");
        if(!button){return;}
        var themes = {
          blue:{themeColor:"#1769ff",headerColor:"#082b5e",buttonColor:"#1769ff",logoOutlineColor:"#61c7ff"},
          purple:{themeColor:"#7c3aed",headerColor:"#2e165d",buttonColor:"#7c3aed",logoOutlineColor:"#c4a7ff"},
          red:{themeColor:"#dc2626",headerColor:"#5b1118",buttonColor:"#dc2626",logoOutlineColor:"#ff8b8b"},
          green:{themeColor:"#059669",headerColor:"#06483a",buttonColor:"#059669",logoOutlineColor:"#6ee7b7"},
          orange:{themeColor:"#ea580c",headerColor:"#5b2608",buttonColor:"#ea580c",logoOutlineColor:"#fdba74"}
        };
        var selected = themes[button.getAttribute("data-theme")];
        if(!selected){return;}
        Object.keys(selected).forEach(function(key){state.design[key] = selected[key];});
        applyToInputs();
        render();
        showToast("Theme preset applied.");
      });

      all('input[name="domainMode"]').forEach(function(radio){
        radio.addEventListener("change",function(){
          state.project.domainMode = byId("domainModeCustom").checked ? "custom" : "subdomain";
          render();
        });
      });

      byId("checkSubdomainBtn").addEventListener("click",function(){
        syncFromInputs();
        if(!state.project.slug){
          showToast("Enter a website address first.");
          return;
        }
        showToast(state.project.slug + ".bluvixa.com is available in this prototype.");
      });

      byId("connectDomainBtn").addEventListener("click",function(){
        syncFromInputs();
        if(!isValidDomain(state.project.customDomain)){
          state.project.domainStatus = "not_connected";
          state.project.dnsVerified = false;
          render();
          showToast("Enter a valid domain such as example.com.");
          return;
        }
        state.project.domainStatus = "waiting";
        state.project.dnsVerified = false;
        render();
        saveDraft(false);
        showToast("DNS instructions are ready.");
      });

      byId("verifyDomainBtn").addEventListener("click",function(){
        syncFromInputs();
        if(!isValidDomain(state.project.customDomain)){
          showToast("Enter a valid domain first.");
          return;
        }
        state.project.domainStatus = "connected";
        state.project.dnsVerified = true;
        render();
        saveDraft(false);
        showToast(state.project.customDomain + " is connected in this prototype.");
      });

      byId("saveBtn").addEventListener("click",function(){
        saveDraft(true);
      });

      /*
        Publishing is controlled by /publish-site.js.
        That shared controller handles both Publish and Unpublish and
        prevents duplicate requests from older dashboard handlers.
      */
      if(window.BluvixaPublishing && typeof window.BluvixaPublishing.bind === "function"){
        window.BluvixaPublishing.bind();
      }

      byId("loadDraftBtn").addEventListener("click",loadDraft);
      byId("resetBtn").addEventListener("click",resetBuilder);

      byId("annualCheckoutBtn").addEventListener("click",function(){
        var config = PLAN_CONFIG[state.plan];
        showToast("$0 today, then $" + config.annual + "/year after 7 days.");
      });

      byId("buyoutBtn").addEventListener("click",function(){
        var config = PLAN_CONFIG[state.plan];
        state.billing.boughtOut = true;
        state.billing.status = "bought_out";
        byId("subscriptionStatus").value = "bought_out";
        saveDraft(false);
        showToast(config.name + " website buyout simulation: $" + config.buyout + ".");
      });

      all(".pricingTrial").forEach(function(button){
        button.addEventListener("click",function(){
          var config = PLAN_CONFIG[button.getAttribute("data-plan")];
          showToast("$0 today, then $" + config.annual + "/year after 7 days.");
        });
      });

      var openBackendBtn = byId("openBackendBtn");
      var closeBackendBtn = byId("closeBackendBtn");
      var backendModal = byId("backendModal");
      var refreshJsonBtn = byId("refreshJsonBtn");

      if(openBackendBtn && backendModal){
        openBackendBtn.addEventListener("click",function(){
          renderBackendJson();
          backendModal.classList.remove("hidden");
        });
      }

      if(closeBackendBtn && backendModal){
        closeBackendBtn.addEventListener("click",function(){
          backendModal.classList.add("hidden");
        });
      }

      if(backendModal){
        backendModal.addEventListener("click",function(event){
          if(event.target === backendModal){
            backendModal.classList.add("hidden");
          }
        });
      }

      if(refreshJsonBtn){
        refreshJsonBtn.addEventListener("click",renderBackendJson);
      }
    }

    window.bluvixaExportState = function(){ syncFromInputs(); return cloneState(state); };
    window.bluvixaImportState = function(nextState){
      if(!nextState || typeof nextState !== "object") return;
      state = Object.assign({}, state, nextState);
      applyToInputs();
      enforcePlan();
      render();
      saveDraft(false);
    };

    applyToInputs();
    bindControls();
    render();
    switchTab("business");
    setDevice("desktop");
    byId("saveStatus").textContent = "Autosave and cloud media are on";


/* BLUVIXA FINAL WORKSPACE CONTROLS */
(function(){
  var shell=document.querySelector('.builder-shell');
  var sidebar=document.getElementById('builderSidebar');
  var resizer=document.getElementById('builderResizer');
  var toggle=document.getElementById('editorToggle');
  if(!shell||!sidebar||!resizer||!toggle) return;

  var minWidth=320;
  var maxWidth=620;
  var stored=parseInt(localStorage.getItem('bluvixaEditorWidth')||'420',10);
  if(Number.isFinite(stored)){
    shell.style.setProperty('--editor-width',Math.max(minWidth,Math.min(maxWidth,stored))+'px');
  }

  function setCollapsed(collapsed){
    shell.classList.toggle('editor-collapsed',collapsed);
    toggle.textContent=collapsed?'Show Editor':'Hide Editor';
    toggle.setAttribute('aria-expanded',String(!collapsed));
    localStorage.setItem('bluvixaEditorCollapsed',collapsed?'1':'0');
  }
  setCollapsed(localStorage.getItem('bluvixaEditorCollapsed')==='1');
  toggle.addEventListener('click',function(){setCollapsed(!shell.classList.contains('editor-collapsed'));});

  function resizeFrom(clientX){
    var rect=shell.getBoundingClientRect();
    var width=Math.max(minWidth,Math.min(maxWidth,clientX-rect.left));
    shell.style.setProperty('--editor-width',width+'px');
    localStorage.setItem('bluvixaEditorWidth',String(Math.round(width)));
  }
  resizer.addEventListener('pointerdown',function(event){
    if(shell.classList.contains('editor-collapsed')) return;
    shell.classList.add('is-resizing');
    resizer.setPointerCapture(event.pointerId);
    resizeFrom(event.clientX);
  });
  resizer.addEventListener('pointermove',function(event){
    if(!shell.classList.contains('is-resizing')) return;
    resizeFrom(event.clientX);
  });
  function stopResize(event){
    shell.classList.remove('is-resizing');
    try{resizer.releasePointerCapture(event.pointerId);}catch(_error){}
  }
  resizer.addEventListener('pointerup',stopResize);
  resizer.addEventListener('pointercancel',stopResize);
  resizer.addEventListener('keydown',function(event){
    if(event.key!=='ArrowLeft'&&event.key!=='ArrowRight') return;
    event.preventDefault();
    var current=parseInt(getComputedStyle(shell).getPropertyValue('--editor-width'),10)||420;
    var next=current+(event.key==='ArrowRight'?20:-20);
    next=Math.max(minWidth,Math.min(maxWidth,next));
    shell.style.setProperty('--editor-width',next+'px');
    localStorage.setItem('bluvixaEditorWidth',String(next));
  });
})();
