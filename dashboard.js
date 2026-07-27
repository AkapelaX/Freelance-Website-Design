(function(){
"use strict";
var DRAFTS_KEY="bluvixa_saved_drafts_v1";

function q(s){return document.querySelector(s);}
function qa(s){return Array.prototype.slice.call(document.querySelectorAll(s));}
function byId(id){return document.getElementById(id);}
function toast(message){
  var node=byId("toast");
  if(!node){alert(message);return;}
  node.textContent=message;node.classList.add("show");
  clearTimeout(toast.timer);toast.timer=setTimeout(function(){node.classList.remove("show");},2600);
}
function currentRoute(){
  var route=(location.hash||"#home").slice(1).split("?")[0];
  return ["home","account","drafts","builder","billing","domains","pricing"].indexOf(route)>=0?route:"home";
}
function route(){
  var name=currentRoute();
  qa(".app-page").forEach(function(page){page.classList.toggle("route-active",page.dataset.page===name);});
  qa("[data-route-link]").forEach(function(link){link.classList.toggle("active",link.dataset.routeLink===name);});
  document.body.className="route-"+name;
  window.scrollTo(0,0);
  if(name==="drafts") renderDrafts();
  if(name==="account") renderDashboardDrafts();
  if(name==="builder" && window.BluvixaMVP && window.BluvixaMVP.syncDashboard) window.BluvixaMVP.syncDashboard();
}
function readDrafts(){
  try{
    var parsed=JSON.parse(localStorage.getItem(DRAFTS_KEY)||"[]");
    return Array.isArray(parsed)?parsed:[];
  }catch(_error){return [];}
}
function writeDrafts(items){
  localStorage.setItem(DRAFTS_KEY,JSON.stringify(items));
}
function getCurrentState(){
  return typeof window.bluvixaExportState==="function"?window.bluvixaExportState():null;
}
function draftName(state){
  var business=state&&state.business&&state.business.name;
  return business?business+" Website":"Untitled Website";
}
function saveSnapshot(){
  var state=getCurrentState();
  if(!state){toast("The builder is still loading.");return;}
  var items=readDrafts();
  var now=new Date();
  items.unshift({
    id:String(Date.now())+Math.random().toString(16).slice(2),
    name:draftName(state),
    plan:state.plan||"professional",
    savedAt:now.toISOString(),
    published:!!(state.backend&&state.backend.published),
    state:state
  });
  items=items.slice(0,30);
  try{
    writeDrafts(items);
    toast("Website saved to Saved Drafts.");
    renderDrafts();renderDashboardDrafts();
  }catch(error){
    toast("This draft is too large for browser storage. Use Cloud Save for media-heavy websites.");
  }
}
function formatDate(value){
  var d=new Date(value);return d.toLocaleString("en-US",{month:"short",day:"numeric",year:"numeric",hour:"numeric",minute:"2-digit"});
}
function planName(value){return String(value||"professional").replace(/\b\w/g,function(c){return c.toUpperCase();});}
function cardMarkup(item,compact){
  return '<article class="draft-card" data-draft-id="'+item.id+'">'+
    '<div class="draft-thumb"><strong>'+escapeHtml(item.name)+'</strong></div>'+
    '<div class="draft-card-body"><strong>'+escapeHtml(planName(item.plan))+' Plan</strong>'+
    '<small>Saved '+escapeHtml(formatDate(item.savedAt))+'</small>'+
    (compact?'':'<div class="draft-card-actions"><button class="btn btn-primary btn-small" data-load-draft="'+item.id+'">Load</button><button class="btn btn-secondary btn-small" data-delete-draft="'+item.id+'">Delete</button></div>')+
    '</div></article>';
}
function escapeHtml(v){return String(v||"").replace(/[&<>"']/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c];});}
function renderDrafts(){
  var grid=byId("savedDraftsGrid");if(!grid)return;
  var query=(byId("draftSearchInput")?byId("draftSearchInput").value:"").trim().toLowerCase();
  var items=readDrafts().filter(function(item){return !query||String(item.name).toLowerCase().indexOf(query)>=0||String(item.plan).toLowerCase().indexOf(query)>=0;});
  if(byId("savedDraftCount"))byId("savedDraftCount").textContent=String(readDrafts().length);
  grid.innerHTML=items.length?items.map(function(item){return cardMarkup(item,false);}).join(""):'<div class="empty-state">No matching saved drafts. Open the builder and select “Save to Drafts.”</div>';
}
function renderDashboardDrafts(){
  var grid=byId("dashboardDraftPreview");if(!grid)return;
  var items=readDrafts().slice(0,3);
  grid.innerHTML=items.length?items.map(function(item){return cardMarkup(item,true);}).join(""):'<div class="empty-state">No saved drafts yet. Open the builder and select “Save to Drafts.”</div>';
}
function loadDraft(id){
  var item=readDrafts().find(function(entry){return entry.id===id;});
  if(!item){toast("That saved draft was not found.");return;}
  if(typeof window.bluvixaImportState==="function"){
    window.bluvixaImportState(item.state);
    location.hash="#builder";
    toast("Saved draft loaded into the builder.");
  }
}
function deleteDraft(id){
  var items=readDrafts().filter(function(entry){return entry.id!==id;});
  writeDrafts(items);renderDrafts();renderDashboardDrafts();toast("Saved draft deleted.");
}
function bind(){
  window.addEventListener("hashchange",route);
  var landing=byId("landingStartBtn");if(landing)landing.addEventListener("click",function(){window.BluvixaMVP?window.BluvixaMVP.openAuth("signup"):toast("Authentication is loading.");});
  var avatar=byId("accountNavLink");if(avatar)avatar.addEventListener("click",function(){location.hash="#account";});
  ["saveCurrentDraftBtn","saveSnapshotTopBtn"].forEach(function(id){var b=byId(id);if(b)b.addEventListener("click",saveSnapshot);});
  var search=byId("draftSearchInput");if(search)search.addEventListener("input",renderDrafts);
  document.addEventListener("click",function(event){
    var load=event.target.closest("[data-load-draft]");if(load){loadDraft(load.dataset.loadDraft);return;}
    var del=event.target.closest("[data-delete-draft]");if(del){deleteDraft(del.dataset.deleteDraft);return;}
  });
  qa(".memberPlanCheckout").forEach(function(button){
    button.addEventListener("click",function(){window.BluvixaMVP.checkout(button.dataset.plan,"annual");});
  });
  route();renderDashboardDrafts();
}
document.addEventListener("DOMContentLoaded",bind);
window.BluvixaDraftLibrary={save:saveSnapshot,render:renderDrafts};
})();