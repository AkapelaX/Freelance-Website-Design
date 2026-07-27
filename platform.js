(function(){
"use strict";

/* =========================================================
   BLUVIXA 6.0 STABLE PLATFORM CONTROLLER
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
  return {starter:499,professional:599,advanced:699}[String(plan||"professional").toLowerCase()]||599;
}
function projectUrl(project){
  if(project&&project.customDomain)return "https://"+project.customDomain;
  return "https://"+sanitizeSlug(project&&project.slug||project&&project.name||"website")+".bluvixa.com";
}
function getProjects(){
  var value=safeJson(PROJECTS_KEY,[]);
  return Array.isArray(value)?value:[];
}
function setProjects(value){saveJson(PROJECTS_KEY,value);}
function getSnapshots(){
  var value=safeJson(SNAPSHOTS_KEY,[]);
  return Array.isArray(value)?value:[];
}
function setSnapshots(value){saveJson(SNAPSHOTS_KEY,value);}
function activeProjectId(){return localStorage.getItem(ACTIVE_PROJECT_KEY)||"";}
function setActiveProjectId(value){localStorage.setItem(ACTIVE_PROJECT_KEY,value||"");}
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
  if(name==="builder")updateBuilderTitle();

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
    if(["home","top",""].indexOf(routeName())>=0)location.hash="#projects";
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
    var plan=data.plan?titleCase(data.plan):"No active plan";
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
    id:"site_"+Date.now()+"_"+Math.random().toString(16).slice(2),
    name:(name||"Untitled Website").trim()||"Untitled Website",
    plan:builderState.plan||"professional",
    createdAt:now,updatedAt:now,published:false,
    slug:sanitizeSlug((builderState.project&&builderState.project.slug)||name),
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
    window.bluvixaImportState(clone(project.state));
    location.hash="#builder";
    updateBuilderTitle();
    toast("New website created.");
  }
}
function saveActiveProject(showMessage){
  var state=currentBuilderState();
  if(!state){toast("The builder is still loading.");return;}
  var projects=getProjects();
  var project=projects.find(function(item){return item.id===activeProjectId();});
  if(!project){
    var name=(state.business&&state.business.name)?state.business.name+" Website":"Untitled Website";
    project=createProject(name,state);
  }else{
    project.state=clone(state);
    project.name=(state.business&&state.business.name)?state.business.name+" Website":project.name;
    project.plan=state.plan||project.plan;
    project.updatedAt=new Date().toISOString();
    project.published=!!(state.backend&&state.backend.published);
    project.slug=(state.project&&state.project.slug)||project.slug;
    project.customDomain=(state.project&&state.project.customDomain)||project.customDomain;
    project.domainStatus=(state.project&&state.project.domainStatus)||project.domainStatus;
    setProjects(projects);
  }
  if(showMessage)toast("Website saved.");
  renderProjects();renderDrafts();renderPublishing();
}
function loadProject(projectId){
  var project=getProjects().find(function(item){return item.id===projectId;});
  if(!project){toast("Website not found.");return;}
  setActiveProjectId(project.id);
  if(typeof window.bluvixaImportState==="function"){
    window.bluvixaImportState(clone(project.state));
    location.hash="#builder";
    updateBuilderTitle();
    toast(project.name+" loaded.");
  }
}
function duplicateProject(projectId){
  var project=getProjects().find(function(item){return item.id===projectId;});
  if(!project)return;
  createProject(project.name+" Copy",project.state);
  renderProjects();renderDrafts();renderDomainSelectors();renderPublishing();
  toast("Website duplicated.");
}
function deleteProject(projectId){
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
function saveSnapshot(){
  var state=currentBuilderState();
  if(!state){toast("The builder is still loading.");return;}
  var project=getProjects().find(function(item){return item.id===activeProjectId();});
  var snapshots=getSnapshots();
  snapshots.unshift({
    id:"snap_"+Date.now()+"_"+Math.random().toString(16).slice(2),
    projectId:project?project.id:"",
    name:project?project.name+" Snapshot":"Untitled Snapshot",
    plan:state.plan||"professional",
    savedAt:new Date().toISOString(),
    state:clone(state)
  });
  setSnapshots(snapshots.slice(0,60));
  renderDrafts();
  toast("Snapshot saved.");
}
function loadSnapshot(snapshotId){
  var snapshot=getSnapshots().find(function(item){return item.id===snapshotId;});
  if(!snapshot){toast("Snapshot not found.");return;}
  setActiveProjectId(snapshot.projectId||"");
  if(typeof window.bluvixaImportState==="function"){
    window.bluvixaImportState(clone(snapshot.state));
    location.hash="#builder";
    toast("Snapshot loaded.");
  }
}
function deleteSnapshot(snapshotId){
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
  text("subdomainResultMessage","Reserved: https://"+slug+".bluvixa.com. It becomes publicly reachable when the publishing backend deploys it.");
  renderProjects();renderDrafts();renderPublishing();
}
function connectCustomDomain(){
  var projectId=id("customDomainProjectSelect").value;
  var domain=String(id("customDomainWorkspaceInput").value||"").toLowerCase().trim().replace(/^https?:\/\//,"").replace(/^www\./,"").replace(/\/.*$/,"");
  if(!projectId||!/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i.test(domain)){
    toast("Choose a website and enter a valid domain.");
    return;
  }
  var projects=getProjects();
  var project=projects.find(function(item){return item.id===projectId;});
  project.customDomain=domain;project.domainStatus="waiting";project.updatedAt=new Date().toISOString();
  if(project.state&&project.state.project){
    project.state.project.customDomain=domain;
    project.state.project.domainMode="custom";
    project.state.project.domainStatus="waiting";
  }
  setProjects(projects);
  if(id("dnsWorkspace"))id("dnsWorkspace").classList.remove("hidden");
  text("customDomainResultMessage",domain+" is waiting for DNS verification.");
  renderProjects();renderDrafts();renderPublishing();
}
function togglePublish(projectId){
  var projects=getProjects();
  var project=projects.find(function(item){return item.id===projectId;});
  if(!project)return;
  project.published=!project.published;
  project.updatedAt=new Date().toISOString();
  if(project.state&&project.state.backend)project.state.backend.published=project.published;
  setProjects(projects);
  renderProjects();renderDrafts();renderPublishing();
  toast(project.published?"Website marked ready for publishing.":"Website returned to draft.");
}
function renderPublishing(){
  var grid=id("publishingProjectGrid");if(!grid)return;
  var projects=getProjects();
  grid.innerHTML=projects.length?projects.map(function(project){
    return '<article class="publishing-card"><strong>'+escapeHtml(project.name)+'</strong><small>'+escapeHtml(projectUrl(project))+'</small><small>Status: '+(project.published?"Published in project state":"Draft")+' · Domain: '+escapeHtml(project.domainStatus||"not connected")+'</small><div class="publishing-card-actions"><button class="btn btn-primary" data-project-action="load" data-project-id="'+project.id+'">Open</button><button class="btn btn-secondary" data-project-action="publish" data-project-id="'+project.id+'">'+(project.published?"Unpublish":"Publish")+'</button></div></article>';
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
  if(button.id==="saveWebsiteProjectBtn"){event.preventDefault();saveActiveProject(true);return;}
  if(button.id==="saveCurrentDraftBtn"||button.id==="saveSnapshotTopBtn"){event.preventDefault();saveSnapshot();return;}
  if(button.id==="searchDomainsBtn"){event.preventDefault();searchDomains();return;}
  if(button.id==="reserveSubdomainBtn"){event.preventDefault();reserveSubdomain();return;}
  if(button.id==="connectCustomDomainWorkspaceBtn"){event.preventDefault();connectCustomDomain();return;}

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
    if(projectAction==="publish")togglePublish(projectId);
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
})();