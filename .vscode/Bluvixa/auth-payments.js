(function(){
  "use strict";
  var supabaseClient = null;
  var currentUser = null;
  var accountData = null;
  var authMode = "signin";

  function el(id){ return document.getElementById(id); }
  function toast(message){
    var node=el("toast");
    if(!node){ alert(message); return; }
    node.textContent=message; node.classList.add("show");
    clearTimeout(toast.timer); toast.timer=setTimeout(function(){node.classList.remove("show");},2800);
  }
  function setMessage(message,isError){
    var node=el("authMessage");
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
    try{
      var config=await api("/api/config");
      if(!config.supabaseUrl || !config.supabaseAnonKey){
        setMessage("Authentication is ready for configuration. Add Supabase environment variables to activate it.",false);
        return;
      }
      supabaseClient=window.supabase.createClient(config.supabaseUrl,config.supabaseAnonKey);
      var result=await supabaseClient.auth.getSession();
      await applySession(result.data.session);
      supabaseClient.auth.onAuthStateChange(function(_event,session){ applySession(session); });
    }catch(error){ console.warn(error); }
  }
  function openAuth(mode){
    setMode(mode||"signin"); setMessage(""); el("authModal").classList.remove("hidden");
  }
  function closeAuth(){el("authModal").classList.add("hidden");}
  function setMode(mode){
    authMode=mode;
    var signup=mode==="signup";
    el("authTitle").textContent=signup?"Create your Bluvixa account":"Sign in to Bluvixa";
    el("authSubmitBtn").textContent=signup?"Create Account":"Sign In";
    el("fullNameGroup").classList.toggle("hidden",!signup);
    el("showSignInTab").classList.toggle("active",!signup);
    el("showSignUpTab").classList.toggle("active",signup);
    el("authPassword").autocomplete=signup?"new-password":"current-password";
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
        setMessage(result.data.session?"Account created and signed in.":"Account created. Check your email to verify it.",false);
      }else{
        var login=await supabaseClient.auth.signInWithPassword({email:email,password:password});
        if(login.error) throw login.error;
        closeAuth(); toast("Welcome back to Bluvixa.");
      }
    }catch(error){setMessage(error.message||"Authentication failed.",true);}finally{button.disabled=false;}
  }
  async function applySession(session){
    currentUser=session?session.user:null;
    var signedIn=!!currentUser;
    ["signInBtn","startTrialBtn"].forEach(function(id){el(id).classList.toggle("hidden",signedIn);});
    ["signOutBtn","accountNavLink"].forEach(function(id){el(id).classList.toggle("hidden",!signedIn);});
    el("accountEmail").textContent=signedIn?currentUser.email:"—";
    el("accountAuthStatus").textContent=signedIn?"Signed in":"Signed out";
    var accountSection=el("account"); if(accountSection) accountSection.classList.toggle("hidden",!signedIn);
    if(signedIn){ await loadAccount(); }
  }
  async function signOut(){ if(supabaseClient) await supabaseClient.auth.signOut(); location.hash="#top"; toast("Signed out."); }
  async function forgot(){
    if(!supabaseClient){setMessage("Connect Supabase first.",true);return;}
    var email=el("authEmail").value.trim();
    if(!email){setMessage("Enter your email first.",true);return;}
    var result=await supabaseClient.auth.resetPasswordForEmail(email,{redirectTo:location.origin+"/#account"});
    if(result.error){setMessage(result.error.message,true);return;}
    setMessage("Password reset email sent.",false);
  }
  async function checkout(plan,purchaseType){
    if(!currentUser){openAuth("signup");setMessage("Create an account or sign in before checkout.",false);return;}
    try{
      var data=await api("/api/create-checkout-session",{method:"POST",body:JSON.stringify({plan:plan,purchaseType:purchaseType||"annual",successUrl:location.origin+"/#account",cancelUrl:location.href})});
      location.href=data.url;
    }catch(error){toast(error.message);}
  }
  async function portal(){
    try{var data=await api("/api/create-portal-session",{method:"POST",body:JSON.stringify({returnUrl:location.origin+"/#account"})});location.href=data.url;}catch(error){toast(error.message);}
  }
  async function saveCloud(){
    if(!currentUser){openAuth("signin");return;}
    if(typeof window.bluvixaExportState!=="function"){toast("Builder state is unavailable.");return;}
    try{await api("/api/project",{method:"POST",body:JSON.stringify({project:window.bluvixaExportState()})});toast("Project saved to your account.");loadAccount();}catch(error){toast(error.message);}
  }
  async function loadCloud(){
    try{var data=await api("/api/project");if(!data.project)throw new Error("No cloud project found.");if(typeof window.bluvixaImportState==="function")window.bluvixaImportState(data.project);toast("Cloud project loaded.");}catch(error){toast(error.message);}
  }
  async function loadAccount(){
    try{
      var data=await api("/api/account");
      accountData=data;
      el("accountPlan").textContent=data.plan||"No active plan";
      el("accountBillingStatus").textContent=data.subscriptionStatus||"Not subscribed";
      el("accountProjectName").textContent=data.projectName||"No cloud project saved";
      var owned=!!data.websiteBoughtOut;
      el("accountOwnershipStatus").textContent=owned?"Website buyout completed":"Not purchased";
      el("accountExportHelp").textContent=owned?"Your raw-code export is unlocked. Export generation activates with the publishing backend.":"Purchase the website buyout to unlock a complete raw-code ZIP export.";
      el("exportWebsiteBtn").disabled=!owned;
      el("exportWebsiteBtn").classList.toggle("btn-primary",owned);
      el("exportWebsiteBtn").classList.toggle("btn-secondary",!owned);
    }catch(error){console.warn(error);}
  }
  function bind(){
    el("signInBtn").addEventListener("click",function(){openAuth("signin");});
    el("startTrialBtn").addEventListener("click",function(){openAuth("signup");});
    el("closeAuthBtn").addEventListener("click",closeAuth);
    el("authModal").addEventListener("click",function(e){if(e.target===el("authModal"))closeAuth();});
    el("showSignInTab").addEventListener("click",function(){setMode("signin");});
    el("showSignUpTab").addEventListener("click",function(){setMode("signup");});
    el("authForm").addEventListener("submit",handleAuth);
    el("forgotPasswordBtn").addEventListener("click",forgot);
    el("signOutBtn").addEventListener("click",signOut);
    el("accountSignOutBtn").addEventListener("click",signOut);
    el("manageBillingBtn").addEventListener("click",portal);
    el("cloudSaveBtn").addEventListener("click",saveCloud);
    el("cloudLoadBtn").addEventListener("click",loadCloud);
    el("exportWebsiteBtn").addEventListener("click",async function(){
      if(!currentUser){openAuth("signin");return;}
      if(!accountData || !accountData.websiteBoughtOut){toast("A website buyout is required before raw-code export.");return;}
      toast("Export is unlocked. The ZIP generator will activate with the publishing backend.");
    });
    document.querySelectorAll(".pricingTrial").forEach(function(button){
      button.addEventListener("click",function(e){e.stopImmediatePropagation();checkout(button.getAttribute("data-plan"),"annual");},true);
    });
    var annual=el("annualCheckoutBtn"); if(annual) annual.addEventListener("click",function(e){e.stopImmediatePropagation();checkout(el("planSelect").value,"annual");},true);
    var buyout=el("buyoutBtn"); if(buyout) buyout.addEventListener("click",function(e){e.stopImmediatePropagation();checkout(el("planSelect").value,"buyout");},true);
  }
  window.BluvixaMVP={openAuth:openAuth,checkout:checkout};
  document.addEventListener("DOMContentLoaded",init);
})();
