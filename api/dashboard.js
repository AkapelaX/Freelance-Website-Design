(function(){
"use strict";

var PROJECTS_KEY="bluvixa_projects_v2";
var SNAPSHOTS_KEY="bluvixa_saved_drafts_v2";
var ACTIVE_PROJECT_KEY="bluvixa_active_project_id";
var draftFilter="all";

function byId(id){return document.getElementById(id);}
function qa(selector){return Array.prototype.slice.call(document.querySelectorAll(selector));}
function toast(message){
  var node=byId("toast");
  if(!node){alert(message);return;}
  node.textContent=message;node.classList.add("show");
  clearTimeout(toast.timer);toast.timer=setTimeout(function(){node.classList.remove("show");},2700);
}
function escapeHtml(value){
  return String(value||"").replace(/[&<>"']/g,function(c){
    return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c];
  });
}
function readJson(key,fallback){
  try{var value=JSON.parse(localStorage.getItem(key)||"null");return value==null?fallback:value;}
  catch(_error){return fallback;}
}
function writeJson(key,value){localStorage.setItem(key,JSON.stringify(value));}
function clone(value){return JSON.parse(JSON.stringify(value));}
function projects(){var value=readJson(PROJECTS_KEY,[]);return Array.isArray(value)?value:[];}
function snapshots(){var value=readJson(SNAPSHOTS_KEY,[]);return Array.isArray(value)?value:[];}
function activeProjectId(){return localStorage.getItem(ACTIVE_PROJECT_KEY)||"";}
function setActiveProjectId(id){localStorage.setItem(ACTIVE_PROJECT_KEY,id||"");}
function currentBuilderState(){
  try{return typeof window.bluvixaExportState==="function"?window.bluvixaExportState():null;}
  catch(_error){return null;}
}
function formatDate(value){
  var date=new Date(value);
  return Number.isNaN(date.getTime())?"Unknown":date.toLocaleString("en-US",{month:"short",day:"numeric",year:"numeric",hour:"numeric",minute:"2-digit"});
}
function planName(value){return String(value||"professional").replace(/\b\w/g,function(c){return c.toUpperCase();});}
function sanitizeSlug(value){
  return String(value||"website").toLowerCase().trim().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"").slice(0,48)||"website";
}
function buyoutPrice(plan){return {starter:499,professional:599,advanced:699}[String(plan||"professional").toLowerCase()]||599;}
function projectUrl(project){
  if(project.customDomain)return "https://"+project.customDomain;
  return "https://"+(project.slug||sanitizeSlug(project.name))+".bluvixa.com";
}
function createProject(name,state){
  var now=new Date().toISOString();
  var base=state?clone(state):currentBuilderState();
  if(!base){toast("The builder is still loading.");return null;}
  var project={
    id:"site_"+Date.now()+"_"+Math.random().toString(16).slice(2),
    name:(name||"Untitled Website").trim()||"Untitled Website",
    plan:base.plan||"professional",
    createdAt:now,
    updatedAt:now,
    published:false,
    slug:sanitizeSlug((base.project&&base.project.slug)||name),
    customDomain:"",
    domainStatus:"not_connected",
    websiteBoughtOut:false,
    buyoutCompletedAt:null,
    state:base
  };
  var items=projects();items.unshift(project);writeJson(PROJECTS_KEY,items);setActiveProjectId(project.id);
  return project;
}
function saveActiveProject(showMessage){
  var state=currentBuilderState();
  if(!state){toast("The builder is still loading.");return null;}
  var items=projects();
  var id=activeProjectId();
  var project=items.find(function(item){return item.id===id;});
  if(!project){
    var suggested=(state.business&&state.business.name)?state.business.name+" Website":"Untitled Website";
    project=createProject(suggested,state);
    if(showMessage&&project)toast("New website saved.");
    renderAll();
    return project;
  }
  project.state=clone(state);
  project.name=(state.business&&state.business.name)?state.business.name+" Website":project.name;
  project.plan=state.plan||project.plan;
  project.updatedAt=new Date().toISOString();
  project.published=!!(state.backend&&state.backend.published);
  project.slug=(state.project&&state.project.slug)||project.slug;
  project.customDomain=(state.project&&state.project.customDomain)||project.customDomain;
  project.domainStatus=(state.project&&state.project.domainStatus)||project.domainStatus;
  writeJson(PROJECTS_KEY,items);
  if(showMessage)toast("Website saved.");
  renderAll();
  return project;
}
function newWebsite(){
  var state=currentBuilderState();
  if(!state){toast("The builder is still loading.");return;}
  var blank=clone(state);
  blank.business={name:"",bio:"",phone:"",email:"",hours:"",address:"",callText:""};
  blank.header={tagline:"",headline:"",image:"",bio:""};
  blank.photos=[];blank.gallery=[];blank.mapUrl="";
  blank.project={slug:"",domainMode:"subdomain",customDomain:"",domainStatus:"not_connected",dnsVerified:false};
  blank.backend={userId:null,websiteId:null,published:false,updatedAt:null};
  var project=createProject("Untitled Website",blank);
  if(project&&typeof window.bluvixaImportState==="function"){
    window.bluvixaImportState(blank);
    updateBuilderHeading(project);
    location.hash="#builder";
    toast("New website created.");
  }
}
function loadProject(id){
  var project=projects().find(function(item){return item.id===id;});
  if(!project){toast("That website was not found.");return;}
  setActiveProjectId(project.id);
  if(typeof window.bluvixaImportState==="function"){
    window.bluvixaImportState(clone(project.state));
    updateBuilderHeading(project);
    location.hash="#builder";
    toast(project.name+" loaded.");
  }
}
function duplicateProject(id){
  var source=projects().find(function(item){return item.id===id;});
  if(!source)return;
  var copy=createProject(source.name+" Copy",source.state);
  if(copy){toast("Website duplicated.");renderAll();}
}
function deleteProject(id){
  var items=projects().filter(function(item){return item.id!==id;});
  writeJson(PROJECTS_KEY,items);
  if(activeProjectId()===id)setActiveProjectId("");
  renderAll();toast("Website deleted.");
}
function saveSnapshot(){
  var state=currentBuilderState();if(!state){toast("The builder is still loading.");return;}
  var project=projects().find(function(item){return item.id===activeProjectId();});
  var now=new Date().toISOString();
  var item={
    id:"snap_"+Date.now()+"_"+Math.random().toString(16).slice(2),
    projectId:project?project.id:"",
    name:project?project.name+" Snapshot":((state.business&&state.business.name)||"Untitled")+" Snapshot",
    plan:state.plan||"professional",
    savedAt:now,
    state:clone(state)
  };
  var items=snapshots();items.unshift(item);writeJson(SNAPSHOTS_KEY,items.slice(0,60));
  toast("Snapshot saved.");renderAll();
}
function loadSnapshot(id){
  var item=snapshots().find(function(entry){return entry.id===id;});
  if(!item){toast("That snapshot was not found.");return;}
  if(typeof window.bluvixaImportState==="function"){
    setActiveProjectId(item.projectId||"");
    window.bluvixaImportState(clone(item.state));
    location.hash="#builder";toast("Snapshot loaded.");
  }
}
function deleteSnapshot(id){
  writeJson(SNAPSHOTS_KEY,snapshots().filter(function(item){return item.id!==id;}));
  renderAll();toast("Snapshot deleted.");
}
function buyoutProject(id){
  var project=projects().find(function(item){return item.id===id;});
  if(!project)return;
  setActiveProjectId(project.id);
  if(window.BluvixaMVP&&window.BluvixaMVP.checkout){
    window.BluvixaMVP.checkout(project.plan||"professional","buyout",project.id);
  }
}
function exportProject(id){
  var project=projects().find(function(item){return item.id===id;});
  if(!project)return;
  if(!project.websiteBoughtOut){toast("Buy out this website before exporting it.");return;}
  if(window.BluvixaMVP&&window.BluvixaMVP.exportWebsite){
    window.BluvixaMVP.exportWebsite(project.id);
  }else{
    toast("The export API is not connected yet.");
  }
}
function websiteCard(project){
  var url=projectUrl(project);
  return '<article class="website-project-card" data-project-id="'+project.id+'">'+
    '<div class="website-project-preview" style="--project-accent:'+(project.plan==="advanced"?"#673ab7":project.plan==="starter"?"#226d88":"#245f9e")+'"><div><strong>'+escapeHtml(project.name)+'</strong><small>'+escapeHtml(url)+'</small></div></div>'+
    '<div class="website-project-body">'+
    '<div class="project-meta-row"><strong>'+escapeHtml(planName(project.plan))+'</strong><span class="project-status '+(project.websiteBoughtOut?"owned":project.published?"published":"")+'">'+(project.websiteBoughtOut?"Owned":project.published?"Published":"Draft")+'</span></div>'+
    '<div class="project-meta"><div><span>UPDATED</span><strong>'+escapeHtml(formatDate(project.updatedAt))+'</strong></div><div><span>OWNERSHIP</span><strong>'+(project.websiteBoughtOut?"Purchased":"Subscription")+'</strong></div></div>'+
    '<div class="project-actions"><button class="btn btn-primary" data-project-load="'+project.id+'">Edit</button><button class="btn btn-secondary" data-project-duplicate="'+project.id+'">Duplicate</button><button class="btn btn-secondary" data-project-drafts="'+project.id+'">Drafts</button><button class="btn btn-danger" data-project-delete="'+project.id+'">Delete</button></div>'+
    '</div></article>';
}
function renderProjects(){
  var grid=byId("websiteLibraryGrid");if(!grid)return;
  var query=(byId("projectSearchInput")?byId("projectSearchInput").value:"").trim().toLowerCase();
  var items=projects().filter(function(item){return !query||item.name.toLowerCase().indexOf(query)>=0||projectUrl(item).toLowerCase().indexOf(query)>=0;});
  byId("projectCount").textContent=String(projects().length);
  byId("publishedProjectCount").textContent=String(projects().filter(function(p){return p.published;}).length);
  byId("draftProjectCount").textContent=String(projects().filter(function(p){return !p.published;}).length);
  grid.innerHTML=items.length?items.map(websiteCard).join(""):'<div class="empty-state">No websites yet. Select “Create New Website” to begin.</div>';
}
function draftCard(item,type){
  var project=type==="project"?item:projects().find(function(p){return p.id===item.projectId;});
  var owned=project&&project.websiteBoughtOut;
  var status=type==="project"?(item.published?"Published website":"Incomplete website"):"Saved snapshot";
  return '<article class="draft-card '+(type==="project"?"project-draft":"snapshot-draft")+'">'+
    '<div class="draft-thumb"><strong>'+escapeHtml(item.name)+'</strong></div>'+
    '<div class="draft-card-body"><span class="draft-type-label">'+(type==="project"?"WEBSITE PROJECT":"SNAPSHOT")+'</span>'+
    '<strong>'+escapeHtml(status)+'</strong><small>'+escapeHtml(formatDate(type==="project"?item.updatedAt:item.savedAt))+'</small>'+
    '<div class="draft-ownership-row"><small>'+(owned?"Website owned":"Buyout $"+buyoutPrice(item.plan))+'</small><span class="project-status '+(owned?"owned":"")+'">'+(owned?"Export unlocked":"Export locked")+'</span></div>'+
    '<div class="draft-card-actions">'+
    '<button class="btn btn-primary btn-small" data-'+(type==="project"?"project-load":"snapshot-load")+'="'+item.id+'">Load</button>'+
    (type==="project"
      ? '<button class="btn btn-secondary btn-small" data-project-duplicate="'+item.id+'">Duplicate</button>'+
        (owned
          ? '<button class="btn btn-primary btn-small" data-project-export="'+item.id+'">Export ZIP</button>'
          : '<button class="btn btn-secondary btn-small" data-project-buyout="'+item.id+'">Buy Out $'+buyoutPrice(item.plan)+'</button>')
      : '<button class="btn btn-secondary btn-small" data-snapshot-delete="'+item.id+'">Delete</button>')+
    '</div></div></article>';
}
function renderDrafts(){
  var grid=byId("savedDraftsGrid");if(!grid)return;
  var query=(byId("draftSearchInput")?byId("draftSearchInput").value:"").trim().toLowerCase();
  var entries=[];
  projects().forEach(function(item){
    var incomplete=!item.published;
    if(draftFilter==="all"||draftFilter==="project"||(draftFilter==="incomplete"&&incomplete))entries.push({item:item,type:"project",date:item.updatedAt});
  });
  if(draftFilter==="all"||draftFilter==="snapshot"){
    snapshots().forEach(function(item){entries.push({item:item,type:"snapshot",date:item.savedAt});});
  }
  entries=entries.filter(function(entry){return !query||entry.item.name.toLowerCase().indexOf(query)>=0;});
  entries.sort(function(a,b){return new Date(b.date)-new Date(a.date);});
  byId("savedDraftCount").textContent=String(entries.length);
  grid.innerHTML=entries.length?entries.map(function(entry){return draftCard(entry.item,entry.type);}).join(""):'<div class="empty-state">No matching drafts or websites.</div>';
}
function populateDomainProjects(){
  ["subdomainProjectSelect","customDomainProjectSelect"].forEach(function(id){
    var select=byId(id);if(!select)return;
    select.innerHTML=projects().map(function(project){return '<option value="'+project.id+'">'+escapeHtml(project.name)+'</option>';}).join("");
  });
}
function domainSuggestions(term,extension){
  var slug=sanitizeSlug(term).replace(/-/g,"");
  var short=sanitizeSlug(term);
  var year=new Date().getFullYear();
  return [
    short+extension,
    slug+"online"+extension,
    "get"+slug+extension,
    short+year+extension,
    slug+"hq"+extension,
    "my"+slug+extension
  ].filter(function(value,index,array){return value&&array.indexOf(value)===index;});
}
async function searchDomains(){
  var input=(byId("domainSearchInput").value||"").trim();
  var extension=byId("domainExtensionSelect").value||".com";
  if(!input){toast("Enter a business or website name.");return;}
  var results=domainSuggestions(input,extension);
  var live=false;
  try{
    var response=await fetch("/api/domain-search",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({query:input,extension:extension})});
    if(response.ok){
      var data=await response.json();
      if(Array.isArray(data.results)&&data.results.length){results=data.results;live=true;}
    }
  }catch(_error){}
  byId("domainProviderNote").textContent=live?"Live availability returned by the connected domain provider.":"Showing generated suggestions. Connect /api/domain-search for live registrar availability and pricing.";
  byId("domainResultsGrid").innerHTML=results.map(function(result){
    var domain=typeof result==="string"?result:result.domain;
    var available=typeof result==="string"?null:result.available;
    var price=typeof result==="string"?"":result.price;
    return '<article class="domain-result-card"><strong>'+escapeHtml(domain)+'</strong><small>'+(available===true?"Available"+(price?" — "+price:""):available===false?"Unavailable":"Availability requires provider")+'</small><button class="btn btn-secondary" data-use-domain="'+escapeHtml(domain)+'">Use This Domain</button></article>';
  }).join("");
}
function reserveSubdomain(){
  var id=byId("subdomainProjectSelect").value;
  var slug=sanitizeSlug(byId("subdomainSlugInput").value);
  if(!id||!slug){toast("Choose a website and enter an address.");return;}
  var items=projects();
  var duplicate=items.find(function(project){return project.id!==id&&project.slug===slug;});
  if(duplicate){byId("subdomainResultMessage").textContent=slug+".bluvixa.com is already used by another website in this account.";return;}
  var project=items.find(function(item){return item.id===id;});if(!project)return;
  project.slug=slug;project.customDomain="";project.domainStatus="reserved";project.updatedAt=new Date().toISOString();
  if(project.state&&project.state.project){project.state.project.slug=slug;project.state.project.domainMode="subdomain";}
  writeJson(PROJECTS_KEY,items);
  byId("subdomainResultMessage").textContent="Reserved: https://"+slug+".bluvixa.com. It becomes publicly reachable when the publishing backend deploys it.";
  renderPublishing();renderProjects();renderDrafts();
}
function connectCustomDomain(){
  var id=byId("customDomainProjectSelect").value;
  var domain=String(byId("customDomainWorkspaceInput").value||"").toLowerCase().trim().replace(/^https?:\/\//,"").replace(/^www\./,"").replace(/\/.*$/,"");
  if(!id||!/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i.test(domain)){toast("Choose a website and enter a valid domain.");return;}
  var items=projects();var project=items.find(function(item){return item.id===id;});if(!project)return;
  project.customDomain=domain;project.domainStatus="waiting";project.updatedAt=new Date().toISOString();
  if(project.state&&project.state.project){project.state.project.customDomain=domain;project.state.project.domainMode="custom";project.state.project.domainStatus="waiting";}
  writeJson(PROJECTS_KEY,items);
  byId("dnsWorkspace").classList.remove("hidden");
  byId("customDomainResultMessage").textContent=domain+" is waiting for DNS verification.";
  renderPublishing();renderProjects();renderDrafts();
}
function renderPublishing(){
  var grid=byId("publishingProjectGrid");if(!grid)return;
  var items=projects();
  grid.innerHTML=items.length?items.map(function(project){
    return '<article class="publishing-card"><strong>'+escapeHtml(project.name)+'</strong><small>'+escapeHtml(projectUrl(project))+'</small><small>Status: '+(project.published?"Published in project state":"Draft")+' · Domain: '+escapeHtml(project.domainStatus||"not connected")+'</small><div class="publishing-card-actions"><button class="btn btn-primary" data-project-load="'+project.id+'">Open</button><button class="btn btn-secondary" data-project-publish="'+project.id+'">'+(project.published?"Unpublish":"Publish")+'</button></div></article>';
  }).join(""):'<div class="empty-state">Create a website before configuring publishing.</div>';
}
async function getPublishingAccessToken(){
  if(!window.supabase){
    throw new Error("Supabase did not load.");
  }

  var configResponse=await fetch("/api/config",{headers:{Accept:"application/json"}});
  var config={};

  try{
    config=await configResponse.json();
  }catch(_error){}

  if(!configResponse.ok){
    throw new Error(config.error||"Supabase configuration could not be loaded.");
  }

  var supabaseUrl=config.supabaseUrl||config.supabase_url||config.url;
  var supabaseAnonKey=config.supabaseAnonKey||config.supabase_anon_key||config.anonKey||config.anon_key;

  if(!supabaseUrl||!supabaseAnonKey){
    throw new Error("Supabase configuration is incomplete.");
  }

  if(!window.__bluvixaDashboardSupabase){
    window.__bluvixaDashboardSupabase=window.supabase.createClient(supabaseUrl,supabaseAnonKey);
  }

  var sessionResult=await window.__bluvixaDashboardSupabase.auth.getSession();
  var session=sessionResult&&sessionResult.data&&sessionResult.data.session;

  if(!session||!session.access_token){
    throw new Error("Please sign in again.");
  }

  return session.access_token;
}

async function togglePublish(id){
  var items=projects();
  var project=items.find(function(item){return item.id===id;});
  if(!project)return;

  var shouldPublish=!project.published;

  try{
    toast(shouldPublish?"Publishing website…":"Unpublishing website…");

    var accessToken=await getPublishingAccessToken();
    var response=await fetch("/api/publish-site",{
      method:"POST",
      headers:{
        "Content-Type":"application/json",
        Authorization:"Bearer "+accessToken
      },
      body:JSON.stringify({
        projectId:project.id,
        publish:shouldPublish,
        requestedSlug:project.slug||sanitizeSlug(project.name)
      })
    });

    var result={};

    try{
      result=await response.json();
    }catch(_error){}

    if(!response.ok){
      throw new Error(result.error||(shouldPublish
        ?"The website could not be published."
        :"The website could not be unpublished."));
    }

    if(typeof result.published!=="boolean"){
      throw new Error("The server returned an invalid publishing status.");
    }

    project.published=result.published;
    project.slug=result.slug||project.slug||"";
    project.updatedAt=new Date().toISOString();

    if(project.state){
      project.state.backend=project.state.backend||{};
      project.state.project=project.state.project||{};
      project.state.backend.published=project.published;
      project.state.backend.updatedAt=project.updatedAt;
      project.state.project.slug=project.slug;
    }

    writeJson(PROJECTS_KEY,items);

    if(
      activeProjectId()===project.id &&
      typeof window.bluvixaImportState==="function"
    ){
      window.bluvixaImportState(clone(project.state));
    }

    renderAll();
    toast(project.published
      ?"Website published successfully."
      :"Website unpublished successfully.");
  }catch(error){
    console.error("Bluvixa publishing failed:",error);
    toast("Publishing failed: "+(error.message||"Unknown error"));
  }
}
function updateBuilderHeading(project){
  if(byId("builderProjectTitle"))byId("builderProjectTitle").textContent=project?project.name:"Build your website";
  if(byId("builderProjectSubtitle"))byId("builderProjectSubtitle").textContent=project?"Editing website project · "+planName(project.plan)+" plan":"Create or load a website project.";
}
function renderAll(){renderProjects();renderDrafts();populateDomainProjects();renderPublishing();}
function currentRoute(){
  var route=(location.hash||"#home").slice(1).split("?")[0];
  return ["home","projects","drafts","builder","billing","domains","pricing"].indexOf(route)>=0?route:"home";
}
function route(){
  var name=currentRoute();
  if(document.body.classList.contains("member-authenticated")&&name==="home")name="projects";
  if(!document.body.classList.contains("member-authenticated")&&["projects","drafts","billing","domains"].indexOf(name)>=0)name="home";
  qa(".app-page").forEach(function(page){page.classList.toggle("route-active",page.dataset.page===name);});
  qa("[data-route-link]").forEach(function(link){link.classList.toggle("active",link.dataset.routeLink===name);});
  document.body.className=(document.body.classList.contains("member-authenticated")?"member-authenticated ":"")+"route-"+name;
  window.scrollTo(0,0);
  if(name==="projects"||name==="drafts"||name==="domains")renderAll();
  if(name==="builder"){
    var project=projects().find(function(item){return item.id===activeProjectId();});
    updateBuilderHeading(project||null);
  }
}
function bind(){
  window.addEventListener("hashchange",route);
  ["createWebsiteBtn","createWebsiteFromDraftsBtn"].forEach(function(id){var button=byId(id);if(button)button.addEventListener("click",newWebsite);});
  if(byId("saveWebsiteProjectBtn"))byId("saveWebsiteProjectBtn").addEventListener("click",function(){saveActiveProject(true);});
  ["saveCurrentDraftBtn","saveSnapshotTopBtn"].forEach(function(id){var button=byId(id);if(button)button.addEventListener("click",saveSnapshot);});
  if(byId("projectSearchInput"))byId("projectSearchInput").addEventListener("input",renderProjects);
  if(byId("draftSearchInput"))byId("draftSearchInput").addEventListener("input",renderDrafts);
  qa("[data-draft-filter]").forEach(function(button){button.addEventListener("click",function(){draftFilter=button.dataset.draftFilter;qa("[data-draft-filter]").forEach(function(item){item.classList.toggle("active",item===button);});renderDrafts();});});
  if(byId("searchDomainsBtn"))byId("searchDomainsBtn").addEventListener("click",searchDomains);
  if(byId("domainSearchInput"))byId("domainSearchInput").addEventListener("keydown",function(event){if(event.key==="Enter")searchDomains();});
  if(byId("reserveSubdomainBtn"))byId("reserveSubdomainBtn").addEventListener("click",reserveSubdomain);
  if(byId("connectCustomDomainWorkspaceBtn"))byId("connectCustomDomainWorkspaceBtn").addEventListener("click",connectCustomDomain);

  document.addEventListener("click",function(event){
    var node;
    if((node=event.target.closest("[data-project-load]"))){loadProject(node.dataset.projectLoad);return;}
    if((node=event.target.closest("[data-project-duplicate]"))){duplicateProject(node.dataset.projectDuplicate);return;}
    if((node=event.target.closest("[data-project-delete]"))){deleteProject(node.dataset.projectDelete);return;}
    if((node=event.target.closest("[data-project-drafts]"))){location.hash="#drafts";return;}
    if((node=event.target.closest("[data-project-buyout]"))){buyoutProject(node.dataset.projectBuyout);return;}
    if((node=event.target.closest("[data-project-export]"))){exportProject(node.dataset.projectExport);return;}
    if((node=event.target.closest("[data-snapshot-load]"))){loadSnapshot(node.dataset.snapshotLoad);return;}
    if((node=event.target.closest("[data-snapshot-delete]"))){deleteSnapshot(node.dataset.snapshotDelete);return;}
    if((node=event.target.closest("[data-project-publish]"))){togglePublish(node.dataset.projectPublish);return;}
    if((node=event.target.closest("[data-use-domain]"))){byId("customDomainWorkspaceInput").value=node.dataset.useDomain;byId("customDomainWorkspaceInput").scrollIntoView({behavior:"smooth",block:"center"});return;}
  });

  qa(".memberPlanCheckout").forEach(function(button){button.addEventListener("click",function(){if(window.BluvixaMVP)window.BluvixaMVP.checkout(button.dataset.plan,"annual");});});
  route();renderAll();
}
document.addEventListener("DOMContentLoaded",bind);
window.BluvixaWorkspace={
  createProject:createProject,
  saveActiveProject:saveActiveProject,
  markOwned:function(projectId){
    var items=projects();var project=items.find(function(item){return item.id===projectId;});
    if(project){project.websiteBoughtOut=true;project.buyoutCompletedAt=new Date().toISOString();writeJson(PROJECTS_KEY,items);renderAll();}
  },
  getActiveProjectId:activeProjectId
};
})();