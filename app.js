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
      updatePublishButton();

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
          owner_id:state.backend.userId,
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

    function updatePublishButton(){
      var button = byId("publishBtn");
      if(!button){return;}

      button.textContent = state.backend.published
        ? "Unpublish Website"
        : "Publish Website";

      button.setAttribute(
        "aria-label",
        state.backend.published
          ? "Unpublish website"
          : "Publish website"
      );
    }

    async function getPublishingAccessToken(){
      if(
        window.BluvixaMVP &&
        typeof window.BluvixaMVP.getAccessToken === "function"
      ){
        var directToken = await window.BluvixaMVP.getAccessToken();
        if(directToken){return directToken;}
      }

      if(
        window.BluvixaMVP &&
        typeof window.BluvixaMVP.getSession === "function"
      ){
        var mvpSessionResult = await window.BluvixaMVP.getSession();
        var mvpSession =
          mvpSessionResult &&
          mvpSessionResult.data &&
          mvpSessionResult.data.session
            ? mvpSessionResult.data.session
            : mvpSessionResult && mvpSessionResult.session
              ? mvpSessionResult.session
              : mvpSessionResult;

        if(mvpSession && mvpSession.access_token){
          return mvpSession.access_token;
        }
      }

      if(
        window.supabase &&
        window.supabase.auth &&
        typeof window.supabase.auth.getSession === "function"
      ){
        var supabaseSessionResult =
          await window.supabase.auth.getSession();

        var supabaseSession =
          supabaseSessionResult &&
          supabaseSessionResult.data
            ? supabaseSessionResult.data.session
            : null;

        if(supabaseSession && supabaseSession.access_token){
          return supabaseSession.access_token;
        }
      }

      return "";
    }

    async function updateWebsitePublication(shouldPublish){
      syncFromInputs();

      if(
        shouldPublish &&
        state.project.domainMode === "custom" &&
        !state.project.dnsVerified
      ){
        switchTab("project");
        showToast(
          "Connect and verify your custom domain before publishing."
        );
        return;
      }

      if(!state.backend.websiteId){
        showToast(
          "Save this website to your account before publishing."
        );
        return;
      }

      var accessToken = "";

      try{
        accessToken = await getPublishingAccessToken();
      }catch(error){
        console.error("Session lookup failed:",error);
      }

      if(!accessToken){
        showToast("Please sign in again before publishing.");
        return;
      }

      var button = byId("publishBtn");
      var originalText = button ? button.textContent : "";

      if(button){
        button.disabled = true;
        button.textContent = shouldPublish
          ? "Publishing…"
          : "Unpublishing…";
      }

      try{
        var response = await fetch("/api/publish-site",{
          method:"POST",
          headers:{
            "Content-Type":"application/json",
            "Authorization":"Bearer " + accessToken
          },
          body:JSON.stringify({
            projectId:state.backend.websiteId,
            publish:shouldPublish,
            requestedSlug:state.project.slug
          })
        });

        var data = {};

        try{
          data = await response.json();
        }catch(_error){}

        if(!response.ok){
          throw new Error(
            data.error ||
            (shouldPublish
              ? "The website could not be published."
              : "The website could not be unpublished.")
          );
        }

        state.backend.published = data.published === true;
        state.backend.updatedAt = new Date().toISOString();

        if(data.slug){
          state.project.slug = sanitizeSlug(data.slug);
          byId("projectSlug").value = state.project.slug;
        }

        saveDraft(false);
        renderDomainSettings();
        updatePublishButton();

        showToast(
          state.backend.published
            ? "Website published successfully."
            : "Website unpublished successfully."
        );
      }catch(error){
        console.error(
          shouldPublish
            ? "Website publishing failed:"
            : "Website unpublishing failed:",
          error
        );

        showToast(
          error.message ||
          (shouldPublish
            ? "The website could not be published."
            : "The website could not be unpublished.")
        );
      }finally{
        if(button){
          button.disabled = false;

          if(
            button.textContent === "Publishing…" ||
            button.textContent === "Unpublishing…"
          ){
            button.textContent = originalText;
          }

          updatePublishButton();
        }
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

      byId("publishBtn").addEventListener("click",async function(){
        var button = byId("publishBtn");
        var buttonText = String(
          button && button.textContent
            ? button.textContent
            : ""
        ).trim().toLowerCase();

        /*
          Use the action shown on the button as the source of truth.
          The cloud/dashboard script can correctly display
          "Unpublish Website" before this local builder state has
          finished syncing. Relying only on state.backend.published
          caused an Unpublish click to send publish:true.
        */
        var shouldPublish = buttonText.indexOf("unpublish") === -1;

        await updateWebsitePublication(shouldPublish);
      });

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