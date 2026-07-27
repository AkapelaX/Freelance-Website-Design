(function(){
"use strict";

/* =========================================================
   BLUVIXA 10.0 ONE-CLICK PUBLISHING CONTROLLER
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
var MEDIA_BUCKET="website-assets";
var MEDIA_SIGNED_URL_SECONDS=315360000;
var mediaUploadInFlight=0;

function id(name){return document.getElementById(name);}
function all(selector){return Array.prototype.slice.call(document.querySelectorAll(selector));}
function text(name,value){var node=id(name);if(node)node.textContent=value==null?"":String(value);}
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
    owner_id:currentUser.id,
    name:project.name||"Untitled Website",
    slug:(project.published||project.domainStatus==="reserved"||project.customDomain)?(project.slug||uniquePublishedSlug(project)):null,
    plan:project.plan||"starter",
    project_data:state,
    status:project.published?"published":"draft",
    custom_domain:project.customDomain||null,
    domain_status:project.domainStatus||"not_connected",
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
    owner_id:currentUser.id,
    name:snapshot.name||"Untitled Snapshot",
    slug:null,
    plan:snapshot.plan||"starter",
    project_data:state,
    status:"draft",
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
    published:row.status==="published",
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
    .from("website_projects")
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
      .from("website_projects")
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
    .from("website_projects")
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

  if(signedIn){
    await loadAccount();
    await loadCloudWorkspace();

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
  closeLoading();
}
async function initAuth(){
  try{
    var config=await api("/api/config");
    if(!config.supabaseUrl||!config.supabaseAnonKey){
      closeLoading();
      return;
    }
    if(!window.supabase)throw new Error("Supabase client did not load.");
    supabaseClient=window.supabase.createClient(config.supabaseUrl,config.supabaseAnonKey);
    var sessionResult=await supabaseClient.auth.getSession();
    await applySession(sessionResult.data.session);
    supabaseClient.auth.onAuthStateChange(function(_event,session){
      applySession(session);
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
    var data=await api("/api/account");
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
    text("trialHomeMessage","You are signed in. Account details will appear when /api/account responds.");
  }
}
async function checkout(plan,purchaseType,websiteId){
  if(!currentUser){openAuth("signup");return;}
  try{
    var data=await api("/api/create-checkout-session",{
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
    var data=await api("/api/create-portal-session",{
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
    var response=await fetch("/api/export-website?websiteId="+encodeURIComponent(projectId||""),{
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
    var response=await fetch("/api/domain-search",{
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({query:term,extension:extension})
    });
    if(response.ok){
      var data=await response.json();
      if(Array.isArray(data.results)&&data.results.length){results=data.results;live=true;}
    }
  }catch(_error){}
  text("domainProviderNote",live?"Live availability returned by the connected domain provider.":"Showing generated suggestions. Connect /api/domain-search for live availability and registrar pricing.");
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
    var result=await authenticatedApi("/api/connect-domain",{projectId:projectId,domain:domain});
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

async function togglePublish(projectId){
  var projects=getProjects();
  var project=projects.find(function(item){return item.id===projectId;});
  if(!project)return;

  try{
    if(activeProjectId()===projectId&&typeof window.bluvixaExportState==="function"){
      var saved=await saveActiveProject(false);
      if(!saved)throw new Error(lastCloudError||"Save the website before publishing.");
      projects=getProjects();
      project=projects.find(function(item){return item.id===projectId;});
    }

    var shouldPublish=!project.published;
    toast(shouldPublish?"Publishing website…":"Unpublishing website…");
    var result=await authenticatedApi("/api/publish-site",{
      projectId:projectId,
      publish:shouldPublish,
      requestedSlug:project.slug||sanitizeSlug(project.name)
    });

    project.published=!!result.published;
    project.slug=result.slug||project.slug||"";
    project.updatedAt=new Date().toISOString();
    if(project.state&&project.state.backend)project.state.backend.published=project.published;
    if(project.state&&project.state.project){
      project.state.project.slug=project.slug;
      project.state.project.domainStatus=project.domainStatus;
    }
    setProjects(projects);
    await saveProjectToCloud(project);
    renderProjects();renderDrafts();renderPublishing();

    if(project.published){
      toast("Website published successfully.");
      window.open(result.url||projectUrl(project),"_blank","noopener");
    }else{
      toast("Website unpublished.");
    }
  }catch(error){
    console.error("Bluvixa publishing failed:",error);
    toast("Publishing failed: "+(error.message||"Unknown error"));
  }
}
function renderPublishing(){
  var grid=id("publishingProjectGrid");if(!grid)return;
  var projects=getProjects();
  grid.innerHTML=projects.length?projects.map(function(project){
    var liveUrl=projectUrl(project);
    return '<article class="publishing-card"><strong>'+escapeHtml(project.name)+'</strong>'+
      '<small>'+escapeHtml(liveUrl)+'</small>'+
      '<small>Status: '+(project.published?"Live":"Draft")+' · Domain: '+escapeHtml(project.domainStatus||"not connected")+'</small>'+
      '<div class="publishing-card-actions">'+
      '<button class="btn btn-primary" data-project-action="load" data-project-id="'+project.id+'">Edit</button>'+
      '<button class="btn btn-secondary" data-project-action="publish" data-project-id="'+project.id+'">'+(project.published?"Unpublish":"Publish Now")+'</button>'+
      (project.published?'<a class="btn btn-secondary" href="'+escapeHtml(liveUrl)+'" target="_blank" rel="noopener">View Live</a>':"")+
      '</div></article>';
  }).join(""):'<div class="empty-state">Create a website before configuring publishing.</div>';
}

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
})()
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

;