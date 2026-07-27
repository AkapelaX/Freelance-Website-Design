(function(){
  "use strict";
  var supabaseClient = null;
  var currentUser = null;
  var accountData = null;
  var authMode = "signin";

  function el(id){ return document.getElementById(id); }
  function each(selector,callback){ document.querySelectorAll(selector).forEach(callback); }
  function safeText(id,value){ var node=el(id); if(node) node.textContent=value; }
  function toast(message){
    var node=el("toast");
    if(!node){ alert(message); return; }
    node.textContent=message; node.classList.add("show");
    clearTimeout(toast.timer); toast.timer=setTimeout(function(){node.classList.remove("show");},2800);
  }
  function setMessage(message,isError){
    var node=el("authMessage");
    if(!node) return;
    node.textContent=message || "";
    node.classList.toggle("hidden",!message);
    node.style.borderColor=isError?"rgba(255,90,90,.55)":"rgba(70,210,145,.45)";
  }
  async function api(path,options){
    var headers={"Content-Type":"application/json"};
    if(currentUser && supabaseClient){
      var session=(await supabaseClient.auth.getSession()).data.session;
      if(session) headers.Authorization="Bearer "+session.access_token;
    }
    var response=await fetch(path,Object.assign({},options||{},{headers:Object.assign(headers,(options&&options.headers)||{})}));
    var data=await response.json().catch(function(){return {};});
    if(!response.ok) throw new Error(data.error||"Request failed.");
    return data;
  }
  async function init(){
    bind();
    initializeDashboard();
    try{
      var config=await api("/api/config");
      if(!config.supabaseUrl || !config.supabaseAnonKey){
        setMessage("Authentication is ready for configuration. Add Supabase environment variables to activate it.",false);
        return;
      }
      if(!window.supabase) throw new Error("Supabase client library did not load.");
      supabaseClient=window.supabase.createClient(config.supabaseUrl,config.supabaseAnonKey);
      var result=await supabaseClient.auth.getSession();
      await applySession(result.data.session);
      supabaseClient.auth.onAuthStateChange(function(_event,session){ applySession(session); });
    }catch(error){ console.warn(error); }
  }
  function openAuth(mode){
    setMode(mode||"signin"); setMessage("");
    var modal=el("authModal"); if(modal) modal.classList.remove("hidden");
  }
  function closeAuth(){var modal=el("authModal");if(modal)modal.classList.add("hidden");}
  function setMode(mode){
    authMode=mode;
    var signup=mode==="signup";
    safeText("authTitle",signup?"Create your Bluvixa account":"Sign in to Bluvixa");
    safeText("authSubmitBtn",signup?"Create Account":"Sign In");
    if(el("fullNameGroup")) el("fullNameGroup").classList.toggle("hidden",!signup);
    if(el("showSignInTab")) el("showSignInTab").classList.toggle("active",!signup);
    if(el("showSignUpTab")) el("showSignUpTab").classList.toggle("active",signup);
    if(el("authPassword")) el("authPassword").autocomplete=signup?"new-password":"current-password";
  }
  async function handleAuth(event){
    event.preventDefault();
    if(!supabaseClient){ setMessage("Connect Supabase first using the included setup guide.",true); return; }
    var email=el("authEmail").value.trim();
    var password=el("authPassword").value;
    var button=el("authSubmitBtn"); button.disabled=true;
    try{
      if(authMode==="signup"){
        var fullName=el("authFullName").value.trim();
        var result=await supabaseClient.auth.signUp({email:email,password:password,options:{data:{full_name:fullName}}});
        if(result.error) throw result.error;
        setMessage(result.data.session?"Account created and signed in.":"Account created. Check your email to verify it.",false); if(result.data.session){closeAuth();location.hash="#account";}
      }else{
        var login=await supabaseClient.auth.signInWithPassword({email:email,password:password});
        if(login.error) throw login.error;
        closeAuth(); location.hash="#account"; toast("Welcome back to Bluvixa.");
      }
    }catch(error){setMessage(error.message||"Authentication failed.",true);}finally{button.disabled=false;}
  }
  async function applySession(session){
    currentUser=session?session.user:null;
    var signedIn=!!currentUser;
    ["signInBtn","startTrialBtn"].forEach(function(id){if(el(id))el(id).classList.toggle("hidden",signedIn);});
    ["signOutBtn","accountNavLink"].forEach(function(id){if(el(id))el(id).classList.toggle("hidden",!signedIn);});
    safeText("accountEmail",signedIn?currentUser.email:"—");
    safeText("dashboardSettingsEmail",signedIn?currentUser.email:"—");
    safeText("accountAuthStatus",signedIn?"Signed in":"Signed out");
    safeText("memberConfirmationTitle",signedIn?"You are a Bluvixa member":"Sign in required");
    safeText("memberConfirmationDetails",signedIn
      ? "Signed in as "+currentUser.email+". Your plan and billing status appear below."
      : "Sign in to access your dashboard, cloud projects, billing, and ownership.");
    var accountSection=el("account"); if(accountSection) accountSection.classList.toggle("hidden",!signedIn);
    ["drafts","billing","domains"].forEach(function(id){var page=el(id);if(page)page.classList.toggle("hidden",!signedIn);});
    var publicNav=el("publicNav"); if(publicNav) publicNav.classList.toggle("hidden",signedIn);
    var memberNav=el("memberNav"); if(memberNav) memberNav.classList.toggle("hidden",!signedIn);
    safeText("sidebarMemberEmail",signedIn?currentUser.email:"—");
    safeText("draftsMemberEmail",signedIn?currentUser.email:"—");
    if(signedIn){ await loadAccount(); }
  }
  async function signOut(){ if(supabaseClient) await supabaseClient.auth.signOut(); location.hash="#top"; toast("Signed out."); }
  async function forgot(){
    if(!supabaseClient){setMessage("Connect Supabase first.",true);return;}
    var email=(el("authEmail")&&el("authEmail").value.trim()) || (currentUser&&currentUser.email) || "";
    if(!email){setMessage("Enter your email first.",true);return;}
    var result=await supabaseClient.auth.resetPasswordForEmail(email,{redirectTo:location.origin+"/#account"});
    if(result.error){setMessage(result.error.message,true);return;}
    setMessage("Password reset email sent.",false); toast("Password reset email sent.");
  }
  async function checkout(plan,purchaseType){
    if(!currentUser){openAuth("signup");setMessage("Create an account or sign in before checkout.",false);return;}
    try{
      var data=await api("/api/create-checkout-session",{method:"POST",body:JSON.stringify({plan:plan,purchaseType:purchaseType||"annual",successUrl:location.origin+"/#account",cancelUrl:location.href})});
      location.href=data.url;
    }catch(error){toast(error.message);}
  }
  async function portal(){
    if(!currentUser){openAuth("signin");return;}
    try{var data=await api("/api/create-portal-session",{method:"POST",body:JSON.stringify({returnUrl:location.origin+"/#account"})});location.href=data.url;}catch(error){toast(error.message);}
  }
  async function saveCloud(){
    if(!currentUser){openAuth("signin");return;}
    if(typeof window.bluvixaExportState!=="function"){toast("Builder state is unavailable.");return;}
    try{await api("/api/project",{method:"POST",body:JSON.stringify({project:window.bluvixaExportState()})});toast("Project saved to your account.");loadAccount();}catch(error){toast(error.message);}
  }
  async function loadCloud(){
    if(!currentUser){openAuth("signin");return;}
    try{var data=await api("/api/project");if(!data.project)throw new Error("No cloud project found.");if(typeof window.bluvixaImportState==="function")window.bluvixaImportState(data.project);toast("Cloud project loaded.");syncBuilderDashboard();}catch(error){toast(error.message);}
  }
  function titleCase(value){
    return String(value||"").replace(/[_-]+/g," ").replace(/\b\w/g,function(letter){return letter.toUpperCase();});
  }
  function accountDate(data){
    var raw=data.trialEnd || data.trialEndsAt || data.currentPeriodEnd || data.renewalDate || data.subscriptionEnd;
    if(!raw) return "Available after checkout";
    var date=new Date(typeof raw==="number" ? raw*1000 : raw);
    return Number.isNaN(date.getTime()) ? String(raw) : date.toLocaleDateString("en-US",{year:"numeric",month:"short",day:"numeric"});
  }
  async function loadAccount(){
    try{
      var data=await api("/api/account");
      accountData=data;
      var plan=data.plan?titleCase(data.plan):"No active plan";
      var billing=data.subscriptionStatus?titleCase(data.subscriptionStatus):"Not subscribed";
      var owned=!!data.websiteBoughtOut;
      var projectName=data.projectName||"No cloud project saved";
      safeText("accountPlan",plan);
      safeText("accountBillingStatus",billing);
      safeText("accountProjectName",projectName);
      safeText("accountOwnershipStatus",owned?"Website buyout completed":"Not purchased");
      safeText("dashboardSubscriptionPlan",plan);
      safeText("dashboardSubscriptionStatus",billing);
      safeText("dashboardSubscriptionDate",accountDate(data));
      var prices={starter:499,professional:599,advanced:699};
      var planKey=String(data.plan||"professional").toLowerCase();
      safeText("dashboardBuyoutPrice","$"+(prices[planKey]||599));
      safeText("buyoutPriceHeading","Buy out your "+(data.plan?plan:"Professional")+" website");
      safeText("dashboardPlanHelp",data.plan?"Your "+plan+" workspace is connected.":"Choose a plan to activate builder service.");
      safeText("dashboardRenewalText",accountDate(data));
      safeText("dashboardOwnershipText",owned?"Raw-code export is unlocked.":"Raw-code export remains locked.");
      safeText("dashboardSettingsEmail",currentUser?currentUser.email:"—");
      safeText("memberConfirmationTitle",owned
        ? "Member account active — website owned"
        : (data.plan ? plan+" member account active" : "Bluvixa member account active"));
      safeText("memberConfirmationDetails",
        "Signed in as "+(currentUser?currentUser.email:"member")+
        ". Subscription status: "+billing+
        (owned?". Website ownership is complete.":"."));
      var exportHelp=owned?"Your raw-code export is unlocked. Export generation requires the connected export API.":"Purchase the website buyout to unlock a complete raw-code ZIP export.";
      safeText("accountExportHelp",exportHelp);
      var exportButton=el("exportWebsiteBtn");
      if(exportButton){
        exportButton.disabled=!owned;
        exportButton.classList.toggle("btn-primary",owned);
        exportButton.classList.toggle("btn-secondary",!owned);
      }
      var ownershipState=el("ownershipDashboardState");
      if(ownershipState){
        ownershipState.innerHTML=owned
          ? '<span class="status-pill connected">Owned</span><strong>This website is eligible for raw-code export.</strong>'
          : '<span class="status-pill offline">Locked</span><strong>Subscription access does not include raw-code ownership.</strong>';
      }
      var buyoutButton=el("dashboardBuyoutBtn");
      if(buyoutButton){
        buyoutButton.classList.toggle("hidden",owned);
        buyoutButton.textContent="Buy This Website";
      }
      syncBuilderDashboard();
    }catch(error){console.warn(error);}
  }
  function builderState(){
    try{return typeof window.bluvixaExportState==="function" ? window.bluvixaExportState() : null;}catch(_error){return null;}
  }
  function syncBuilderDashboard(){
    var state=builderState();
    if(!state) return;
    var published=!!(state.backend&&state.backend.published);
    var slug=(state.project&&state.project.slug)||"website";
    var custom=state.project&&state.project.domainMode==="custom"&&state.project.customDomain;
    var url="https://"+(custom?state.project.customDomain:slug+".bluvixa.com");
    safeText("dashboardPublishStatus",published?"Published":"Draft");
    safeText("dashboardDomainStatus",state.project&&state.project.domainStatus==="connected"?"Connected":(custom?"Waiting for DNS":"Bluvixa address"));
    safeText("dashboardPublishedUrl",url);
    safeText("dashboardPublishingUrl",published?url:"Draft address: "+url);
    safeText("dashboardDomainUrl",url);
    safeText("dashboardPublishingTitle",published?"Website published":"Website draft");
    safeText("dashboardPublishingDescription",published?"Your builder marks this project as published. The public URL becomes live when the publishing API deploys the generated site.":"Finish the design, configure the address, and use the builder Publish control.");
  }
  function openBuilderTab(name){
    location.hash="#builder";
    window.setTimeout(function(){
      var button=document.querySelector('.tab[data-tab="'+name+'"]');
      if(button) button.click();
    },120);
  }
  function initializeDashboard(){
    each(".dashboard-menu-button",function(button){
      button.addEventListener("click",function(){
        var view=button.getAttribute("data-dashboard-panel");
        each(".dashboard-menu-button",function(item){item.classList.toggle("active",item===button);});
        each(".dashboard-panel",function(panel){panel.classList.toggle("active",panel.getAttribute("data-dashboard-view")===view);});
      });
    });
    each("[data-open-builder-tab]",function(link){
      link.addEventListener("click",function(){openBuilderTab(link.getAttribute("data-open-builder-tab"));});
    });
    each(".dashboard-cloud-save",function(button){button.addEventListener("click",saveCloud);});
    each(".dashboard-cloud-load",function(button){button.addEventListener("click",loadCloud);});
    each(".dashboard-manage-billing",function(button){button.addEventListener("click",portal);});
    each(".dashboard-sign-out",function(button){button.addEventListener("click",signOut);});
    var reset=el("dashboardPasswordResetBtn"); if(reset) reset.addEventListener("click",forgot);
    var copy=el("copyPublishedUrlBtn");
    if(copy) copy.addEventListener("click",async function(){
      var state=builderState();
      if(!state){toast("Open the builder and configure a website address first.");return;}
      var slug=(state.project&&state.project.slug)||"website";
      var custom=state.project&&state.project.domainMode==="custom"&&state.project.customDomain;
      var url="https://"+(custom?state.project.customDomain:slug+".bluvixa.com");
      try{await navigator.clipboard.writeText(url);toast("Website URL copied.");}
      catch(_error){toast(url);}
    });
    var buy=el("dashboardBuyoutBtn");
    if(buy) buy.addEventListener("click",function(){
      var state=builderState();
      checkout(state&&state.plan?state.plan:"professional","buyout");
    });
    window.addEventListener("hashchange",function(){if(location.hash==="#account")syncBuilderDashboard();});
  }
  function bind(){
    if(el("signInBtn")) el("signInBtn").addEventListener("click",function(){openAuth("signin");});
    if(el("startTrialBtn")) el("startTrialBtn").addEventListener("click",function(){openAuth("signup");});
    if(el("closeAuthBtn")) el("closeAuthBtn").addEventListener("click",closeAuth);
    if(el("authModal")) el("authModal").addEventListener("click",function(e){if(e.target===el("authModal"))closeAuth();});
    if(el("showSignInTab")) el("showSignInTab").addEventListener("click",function(){setMode("signin");});
    if(el("showSignUpTab")) el("showSignUpTab").addEventListener("click",function(){setMode("signup");});
    if(el("authForm")) el("authForm").addEventListener("submit",handleAuth);
    if(el("forgotPasswordBtn")) el("forgotPasswordBtn").addEventListener("click",forgot);
    if(el("signOutBtn")) el("signOutBtn").addEventListener("click",signOut);
    if(el("accountSignOutBtn")) el("accountSignOutBtn").addEventListener("click",signOut);
    if(el("manageBillingBtn")) el("manageBillingBtn").addEventListener("click",portal);
    if(el("cloudSaveBtn")) el("cloudSaveBtn").addEventListener("click",saveCloud);
    if(el("cloudLoadBtn")) el("cloudLoadBtn").addEventListener("click",loadCloud);
    if(el("exportWebsiteBtn")) el("exportWebsiteBtn").addEventListener("click",async function(){
      if(!currentUser){openAuth("signin");return;}
      if(!accountData || !accountData.websiteBoughtOut){toast("A website buyout is required before raw-code export.");return;}
      try{
        var response=await fetch("/api/export-website",{headers:{Authorization:"Bearer "+(await supabaseClient.auth.getSession()).data.session.access_token}});
        if(response.ok){
          var blob=await response.blob();
          var disposition=response.headers.get("Content-Disposition")||"";
          var match=disposition.match(/filename="?([^"]+)"?/i);
          var filename=match?match[1]:"bluvixa-website.zip";
          var url=URL.createObjectURL(blob);
          var anchor=document.createElement("a"); anchor.href=url; anchor.download=filename; document.body.appendChild(anchor); anchor.click(); anchor.remove();
          setTimeout(function(){URL.revokeObjectURL(url);},1000);
          toast("Website export downloaded.");
          return;
        }
        var data=await response.json().catch(function(){return {};});
        throw new Error(data.error||"Export generation is not connected yet.");
      }catch(error){toast(error.message);}
    });
    each(".pricingTrial",function(button){
      button.addEventListener("click",function(e){e.stopImmediatePropagation();checkout(button.getAttribute("data-plan"),"annual");},true);
    });
    var annual=el("annualCheckoutBtn"); if(annual) annual.addEventListener("click",function(e){e.stopImmediatePropagation();checkout(el("planSelect").value,"annual");},true);
    var buyout=el("buyoutBtn"); if(buyout) buyout.addEventListener("click",function(e){e.stopImmediatePropagation();checkout(el("planSelect").value,"buyout");},true);
  }
  window.BluvixaMVP={openAuth:openAuth,checkout:checkout,refreshAccount:loadAccount,syncDashboard:syncBuilderDashboard,isSignedIn:function(){return !!currentUser;},saveCloud:saveCloud};
  document.addEventListener("DOMContentLoaded",init);
})();