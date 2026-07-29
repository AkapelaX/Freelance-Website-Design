/* BLUVIXA 4.0 — CONSOLIDATED APP
   Frontend controller for index.html
   - No secrets belong in this file.
   - Supabase/Stripe/Vercel privileged work stays in /api.
*/
(() => {
  "use strict";

  const APP_VERSION = "2026.07.28";
  const STORAGE_KEY = "bluvixa.local.workspace.v4";
  const SESSION_KEY = "bluvixa.local.session.v4";
  const API_BASE = "/api";

  const $ = (id) => document.getElementById(id);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  const text = (value) => typeof value === "string" ? value.trim() : "";
  const nowIso = () => new Date().toISOString();
  const uid = () => globalThis.crypto?.randomUUID?.() || `bv_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  const clone = (value) => JSON.parse(JSON.stringify(value));

  const DEFAULT_PROJECT = {
    id: "",
    user_id: "",
    name: "Untitled Website",
    slug: "",
    plan: "starter",
    status: "draft",
    published_url: "",
    custom_domain: "",
    domain_status: "not_connected",
    ssl_status: "waiting",
    owned: false,
    created_at: "",
    updated_at: "",
    published_at: "",
    data: {
      businessName: "",
      businessBio: "",
      phoneNumber: "",
      emailAddress: "",
      businessHours: "",
      callButtonText: "Call Now",
      headerTagline: "",
      headerHeadline: "Your headline appears here.",
      headerBio: "",
      headerImage: "",
      businessLogo: "",
      aboutHeading: "About Our Business",
      aboutCover: "",
      featuredHeading: "",
      featuredDescription: "",
      featuredCover: "",
      photos: [],
      galleryHeading: "",
      galleryDescription: "",
      galleryCover: "",
      gallery: [],
      themeColor: "#1769ff",
      headerColor: "#082b5e",
      buttonColor: "#1769ff",
      cardColor: "#ffffff",
      logoOutlineColor: "#61c7ff",
      scrollItems: "Home, Services, Gallery, Reviews, Contact",
      mapHeading: "Find Us",
      mapCover: "",
      businessAddress: "",
      mapEmbedUrl: ""
    },
    snapshots: []
  };

  const state = {
    supabase: null,
    session: null,
    user: null,
    profile: null,
    projects: [],
    activeProjectId: "",
    authMode: "signin",
    currentDraftFilter: "all",
    autosaveTimer: null,
    apiOnline: null,
    domainRefreshTimer: null,
    local: loadLocalState()
  };

  function loadLocalState() {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
      return {
        projects: Array.isArray(parsed.projects) ? parsed.projects : [],
        activeProjectId: text(parsed.activeProjectId),
        previewProject: parsed.previewProject || null
      };
    } catch {
      return { projects: [], activeProjectId: "", previewProject: null };
    }
  }

  function saveLocalState() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      projects: state.projects,
      activeProjectId: state.activeProjectId,
      previewProject: state.local.previewProject || null
    }));
  }

  function safeShow(element, show = true) {
    if (!element) return;
    element.classList.toggle("hidden", !show);
    if ("hidden" in element) element.hidden = !show;
  }

  function toast(message, type = "info") {
    const node = $("toast");
    if (!node) return;
    node.textContent = message;
    node.dataset.type = type;
    node.classList.add("show");
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => node.classList.remove("show"), 3200);
  }

  function setMessage(id, message, type = "info") {
    const node = $(id);
    if (!node) return;
    node.textContent = message;
    node.dataset.type = type;
    safeShow(node, Boolean(message));
  }

  function setBusy(button, busy, busyText = "Working…") {
    if (!button) return;
    if (busy) {
      button.dataset.originalText = button.textContent;
      button.textContent = busyText;
      button.disabled = true;
    } else {
      button.textContent = button.dataset.originalText || button.textContent;
      button.disabled = false;
    }
  }

  async function api(path, options = {}) {
    const headers = new Headers(options.headers || {});
    if (!headers.has("Content-Type") && options.body && !(options.body instanceof FormData)) {
      headers.set("Content-Type", "application/json");
    }
    const token = state.session?.access_token;
    if (token) headers.set("Authorization", `Bearer ${token}`);

    const response = await fetch(`${API_BASE}/${path.replace(/^\/+/, "")}`, {
      ...options,
      headers,
      credentials: "same-origin"
    });

    const contentType = response.headers.get("content-type") || "";
    const payload = contentType.includes("application/json")
      ? await response.json().catch(() => ({}))
      : await response.text();

    if (!response.ok) {
      const message = typeof payload === "string"
        ? payload
        : payload?.error || payload?.message || `Request failed (${response.status})`;
      const error = new Error(message);
      error.status = response.status;
      error.payload = payload;
      throw error;
    }
    return payload;
  }

  async function detectApi() {
    try {
      await api("auth?action=health");
      state.apiOnline = true;
    } catch {
      state.apiOnline = false;
    }
  }

  function createProject(overrides = {}) {
    const project = clone(DEFAULT_PROJECT);
    project.id = uid();
    project.created_at = nowIso();
    project.updated_at = project.created_at;
    project.name = overrides.name || "Untitled Website";
    project.slug = slugify(overrides.slug || project.name);
    project.plan = overrides.plan || currentSelectedPlan();
    project.data.businessName = overrides.businessName || "";
    return Object.assign(project, overrides);
  }

  function normalizeProject(project) {
    const base = createProject();
    const normalized = {
      ...base,
      ...project,
      data: { ...base.data, ...(project?.data || {}) },
      snapshots: Array.isArray(project?.snapshots) ? project.snapshots : []
    };
    normalized.photos = undefined;
    return normalized;
  }

  function slugify(value) {
    return text(value)
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 63) || "my-website";
  }

  function activeProject() {
    return state.projects.find((project) => project.id === state.activeProjectId) || null;
  }

  function ensureProject() {
    let project = activeProject();
    if (!project) {
      project = createProject();
      state.projects.unshift(project);
      state.activeProjectId = project.id;
      saveLocalState();
    }
    return project;
  }

  function currentSelectedPlan() {
    return $("planSelect")?.value || state.profile?.plan || "starter";
  }

  function planLimits(plan) {
    if (plan === "advanced") return { photos: 20, gallery: 12, galleryEnabled: true, fullDesign: true };
    if (plan === "professional") return { photos: 15, gallery: 12, galleryEnabled: true, fullDesign: false };
    return { photos: 10, gallery: 0, galleryEnabled: false, fullDesign: false };
  }

  function routeName() {
    const value = location.hash.replace(/^#/, "").split("?")[0];
    const valid = new Set($$(".app-page").map((page) => page.id));
    return valid.has(value) ? value : "home";
  }

  function navigate(route) {
    const target = route.startsWith("#") ? route : `#${route}`;
    if (location.hash === target) renderRoute();
    else location.hash = target;
  }

  function renderRoute() {
    let route = routeName();
    const protectedRoutes = new Set(["projects", "drafts", "billing", "domains"]);
    if (protectedRoutes.has(route) && !state.user) {
      openAuth("signin");
      route = "home";
      history.replaceState(null, "", "#home");
    }

    $$(".app-page").forEach((page) => {
      const active = page.id === route;
      page.classList.toggle("active", active);
      page.hidden = !active;
    });
    document.body.className = `route-${route}`;
    closeMobileMenu();

    if (route === "projects") renderProjects();
    if (route === "drafts") renderDrafts();
    if (route === "builder") {
      ensureProject();
      loadProjectIntoForm(activeProject());
      renderPreview();
    }
    if (route === "billing") renderAccountStatus();
    if (route === "domains") renderDomainCenter();
  }

  function openMobileMenu() {
    safeShow($("mobileMenu"), true);
    $("mobileMenuButton")?.setAttribute("aria-expanded", "true");
  }

  function closeMobileMenu() {
    safeShow($("mobileMenu"), false);
    $("mobileMenuButton")?.setAttribute("aria-expanded", "false");
  }

  function openAuth(mode = "signin") {
    state.authMode = mode;
    const signup = mode === "signup";
    safeShow($("authModal"), true);
    $("authTitle").textContent = signup ? "Create your Bluvixa account" : "Sign in to Bluvixa";
    $("authSubmitBtn").textContent = signup ? "Create Account" : "Sign In";
    safeShow($("fullNameGroup"), signup);
    $("showSignInTab")?.classList.toggle("active", !signup);
    $("showSignUpTab")?.classList.toggle("active", signup);
    setMessage("authMessage", "");
    setTimeout(() => $("authEmail")?.focus(), 0);
  }

  function closeAuth() {
    safeShow($("authModal"), false);
  }

  async function submitAuth(event) {
    event.preventDefault();
    const email = text($("authEmail")?.value).toLowerCase();
    const password = $("authPassword")?.value || "";
    const fullName = text($("authFullName")?.value);

    if (!email || !email.includes("@")) return setMessage("authMessage", "Enter a valid email address.", "error");
    if (password.length < 8) return setMessage("authMessage", "Password must contain at least 8 characters.", "error");
    if (state.authMode === "signup" && !fullName) return setMessage("authMessage", "Enter your full name.", "error");

    const button = $("authSubmitBtn");
    setBusy(button, true, state.authMode === "signup" ? "Creating account…" : "Signing in…");

    try {
      if (!state.apiOnline) throw new Error("The authentication backend has not been installed yet.");
      const result = await api(`auth?action=${state.authMode === "signup" ? "signup" : "signin"}`, {
        method: "POST",
        body: JSON.stringify({ email, password, full_name: fullName })
      });
      applySession(result.session || result);
      closeAuth();
      toast(state.authMode === "signup" ? "Account created." : "Signed in.", "success");
      navigate("projects");
    } catch (error) {
      setMessage("authMessage", error.message, "error");
    } finally {
      setBusy(button, false);
    }
  }

  function applySession(session) {
    state.session = session?.access_token ? session : null;
    state.user = session?.user || null;
    if (state.session) sessionStorage.setItem(SESSION_KEY, JSON.stringify(state.session));
    else sessionStorage.removeItem(SESSION_KEY);
    renderAuthState();
  }

  async function restoreSession() {
    try {
      const cached = JSON.parse(sessionStorage.getItem(SESSION_KEY) || "null");
      if (cached?.access_token) {
        state.session = cached;
        state.user = cached.user || null;
      }
    } catch {}
    if (state.apiOnline) {
      try {
        const result = await api("auth?action=session");
        if (result?.session) applySession(result.session);
      } catch {}
    }
    renderAuthState();
  }

  async function signOut() {
    try {
      if (state.apiOnline && state.session) await api("auth?action=signout", { method: "POST" });
    } catch {}
    applySession(null);
    state.profile = null;
    toast("Signed out.");
    navigate("home");
  }

  async function forgotPassword() {
    const email = text($("authEmail")?.value).toLowerCase();
    if (!email || !email.includes("@")) return setMessage("authMessage", "Enter your email first.", "error");
    try {
      if (!state.apiOnline) throw new Error("The authentication backend has not been installed yet.");
      await api("auth?action=reset-password", {
        method: "POST",
        body: JSON.stringify({ email, redirect_to: `${location.origin}/#home` })
      });
      setMessage("authMessage", "Password reset email sent.", "success");
    } catch (error) {
      setMessage("authMessage", error.message, "error");
    }
  }

  function renderAuthState() {
    const signedIn = Boolean(state.user);
    safeShow($("publicNav"), !signedIn);
    safeShow($("memberNav"), signedIn);
    safeShow($("mobileMenuPublic"), !signedIn);
    safeShow($("mobileMenuMember"), signedIn);
    ["signInBtn", "startTrialBtn"].forEach((id) => safeShow($(id), !signedIn));
    ["accountNavLink", "signOutBtn", "mobileSignOutBtn"].forEach((id) => safeShow($(id), signedIn));
    $$(".backend-only").forEach((node) => safeShow(node, signedIn));

    const email = state.user?.email || "Your account";
    ["sidebarMemberEmail", "draftsMemberEmail"].forEach((id) => {
      if ($(id)) $(id).textContent = email;
    });
    if ($("accountNavLink")) $("accountNavLink").textContent = email.charAt(0).toUpperCase() || "B";
    if ($("projectsGreeting")) $("projectsGreeting").textContent = signedIn ? `Welcome, ${email.split("@")[0]}` : "Welcome home";
    safeShow($("sessionLoadingScreen"), false);
    renderAccountStatus();
  }

  function renderAccountStatus() {
    const plan = state.profile?.plan || "No active plan";
    const status = state.profile?.subscription_status || "Not subscribed";
    const planLabel = plan === "No active plan" ? plan : capitalize(plan);

    [
      "accountPlan", "dashboardSubscriptionPlan", "mobileMemberPlan"
    ].forEach((id) => { if ($(id)) $(id).textContent = planLabel; });

    [
      "accountBillingStatus", "dashboardSubscriptionStatus", "mobileMemberStatus"
    ].forEach((id) => { if ($(id)) $(id).textContent = capitalize(status.replaceAll("_", " ")); });

    if ($("trialHomeTitle")) $("trialHomeTitle").textContent =
      status === "trialing" ? "Your free trial is active" :
      status === "active" ? `${planLabel} membership active` :
      "Choose a membership to publish";
    if ($("trialHomeMessage")) $("trialHomeMessage").textContent =
      status === "trialing" ? "Build, save, and test your website during your trial." :
      status === "active" ? "Your account has access to the Bluvixa workspace." :
      "You can preview the builder now. A membership is required for cloud publishing.";
  }

  async function loadProfile() {
    if (!state.user || !state.apiOnline) return;
    try {
      const result = await api("auth?action=profile");
      state.profile = result.profile || result;
      renderAccountStatus();
    } catch {}
  }

  async function loadProjects() {
    if (state.user && state.apiOnline) {
      try {
        const result = await api("projects?action=list");
        state.projects = (result.projects || result || []).map(normalizeProject);
        state.activeProjectId = state.activeProjectId || state.projects[0]?.id || "";
        saveLocalState();
        return;
      } catch (error) {
        toast(`Cloud projects unavailable: ${error.message}`, "error");
      }
    }
    state.projects = (state.local.projects || []).map(normalizeProject);
    state.activeProjectId = state.local.activeProjectId || state.projects[0]?.id || "";
  }

  function projectCard(project) {
    const data = project.data || {};
    const cover = data.headerImage || data.featuredCover || data.aboutCover || "";
    const url = project.published_url || "";
    const card = document.createElement("article");
    card.className = "website-library-card";
    card.dataset.projectId = project.id;
    card.innerHTML = `
      <div class="website-card-preview"${cover ? ` style="background-image:url('${escapeAttr(cover)}')"` : ""}>
        ${cover ? "" : `<span>${escapeHtml((data.businessName || project.name || "Website").charAt(0).toUpperCase())}</span>`}
        <small>${escapeHtml(capitalize(project.status || "draft"))}</small>
      </div>
      <div class="website-card-body">
        <div><small>${escapeHtml(capitalize(project.plan || "starter"))}</small><h3>${escapeHtml(data.businessName || project.name || "Untitled Website")}</h3></div>
        <p>Updated ${escapeHtml(formatDate(project.updated_at))}</p>
        ${url ? `<a href="${escapeAttr(url)}" target="_blank" rel="noopener">${escapeHtml(url)}</a>` : ""}
        <div class="website-card-actions">
          <button class="btn btn-primary btn-small" data-project-action="edit">Edit</button>
          <button class="btn btn-secondary btn-small" data-project-action="duplicate">Duplicate</button>
          <button class="btn btn-danger btn-small" data-project-action="delete">Delete</button>
        </div>
      </div>`;
    return card;
  }

  function renderProjects() {
    const grid = $("websiteLibraryGrid");
    if (!grid) return;
    const query = text($("projectSearchInput")?.value).toLowerCase();
    const filtered = state.projects.filter((project) => {
      const haystack = `${project.name} ${project.slug} ${project.data?.businessName || ""}`.toLowerCase();
      return !query || haystack.includes(query);
    });
    grid.replaceChildren(...filtered.map(projectCard));
    if (!filtered.length) grid.innerHTML = `<div class="empty-state">No websites found. Select Create New Website to begin.</div>`;
    if ($("projectCount")) $("projectCount").textContent = state.projects.length;
    if ($("publishedProjectCount")) $("publishedProjectCount").textContent = state.projects.filter((p) => p.status === "published").length;
    if ($("draftProjectCount")) $("draftProjectCount").textContent = state.projects.filter((p) => p.status !== "published").length;
  }

  async function newProject() {
    const project = createProject({ plan: state.profile?.plan || "starter" });
    state.projects.unshift(project);
    state.activeProjectId = project.id;
    saveLocalState();
    if (state.user && state.apiOnline) {
      try {
        const result = await api("projects?action=create", {
          method: "POST",
          body: JSON.stringify({ project })
        });
        const saved = normalizeProject(result.project || result);
        state.projects[0] = saved;
        state.activeProjectId = saved.id;
        saveLocalState();
      } catch (error) {
        toast(`Created locally. Cloud save failed: ${error.message}`, "error");
      }
    }
    navigate("builder");
  }

  async function handleProjectAction(event) {
    const button = event.target.closest("[data-project-action]");
    if (!button) return;
    const card = button.closest("[data-project-id]");
    const project = state.projects.find((item) => item.id === card?.dataset.projectId);
    if (!project) return;
    const action = button.dataset.projectAction;

    if (action === "edit") {
      state.activeProjectId = project.id;
      saveLocalState();
      navigate("builder");
      return;
    }
    if (action === "duplicate") {
      const copy = normalizeProject(clone(project));
      copy.id = uid();
      copy.name = `${project.name || "Website"} Copy`;
      copy.slug = `${slugify(copy.name)}-${Math.random().toString(36).slice(2, 6)}`;
      copy.status = "draft";
      copy.published_url = "";
      copy.custom_domain = "";
      copy.owned = false;
      copy.created_at = nowIso();
      copy.updated_at = copy.created_at;
      state.projects.unshift(copy);
      saveLocalState();
      renderProjects();
      toast("Website duplicated.", "success");
      return;
    }
    if (action === "delete") {
      if (!confirm(`Delete "${project.data?.businessName || project.name}"? This cannot be undone.`)) return;
      if (state.user && state.apiOnline) {
        try {
          await api(`projects?action=delete&id=${encodeURIComponent(project.id)}`, { method: "DELETE" });
        } catch (error) {
          return toast(error.message, "error");
        }
      }
      state.projects = state.projects.filter((item) => item.id !== project.id);
      if (state.activeProjectId === project.id) state.activeProjectId = state.projects[0]?.id || "";
      saveLocalState();
      renderProjects();
      toast("Website deleted.");
    }
  }

  function readFormIntoProject(project = ensureProject()) {
    const d = project.data;
    const mappings = {
      businessName: "businessName", businessBio: "businessBio", phoneNumber: "phoneNumber",
      emailAddress: "emailAddress", businessHours: "businessHours", callButtonText: "callButtonText",
      headerTagline: "headerTagline", headerHeadline: "headerHeadline", headerBio: "headerBio",
      aboutHeading: "aboutHeading", featuredHeading: "featuredHeading",
      featuredDescription: "featuredDescription", galleryHeading: "galleryHeading",
      galleryDescription: "galleryDescription", themeColor: "themeColor",
      headerColor: "headerColor", buttonColor: "buttonColor", cardColor: "cardColor",
      logoOutlineColor: "logoOutlineColor", scrollItems: "scrollItems",
      mapHeading: "mapHeading", businessAddress: "businessAddress", mapEmbedUrl: "mapEmbedUrl"
    };
    Object.entries(mappings).forEach(([key, id]) => {
      if ($(id)) d[key] = $(id).value;
    });
    project.plan = currentSelectedPlan();
    project.name = text(d.businessName) || project.name || "Untitled Website";
    project.slug = slugify($("projectSlug")?.value || project.slug || project.name);
    project.custom_domain = normalizeDomain($("customDomain")?.value || project.custom_domain);
    project.updated_at = nowIso();
    return project;
  }

  function loadProjectIntoForm(project) {
    if (!project) return;
    const d = project.data || {};
    const mappings = {
      businessName: "businessName", businessBio: "businessBio", phoneNumber: "phoneNumber",
      emailAddress: "emailAddress", businessHours: "businessHours", callButtonText: "callButtonText",
      headerTagline: "headerTagline", headerHeadline: "headerHeadline", headerBio: "headerBio",
      aboutHeading: "aboutHeading", featuredHeading: "featuredHeading",
      featuredDescription: "featuredDescription", galleryHeading: "galleryHeading",
      galleryDescription: "galleryDescription", themeColor: "themeColor",
      headerColor: "headerColor", buttonColor: "buttonColor", cardColor: "cardColor",
      logoOutlineColor: "logoOutlineColor", scrollItems: "scrollItems",
      mapHeading: "mapHeading", businessAddress: "businessAddress", mapEmbedUrl: "mapEmbedUrl"
    };
    Object.entries(mappings).forEach(([key, id]) => { if ($(id)) $(id).value = d[key] ?? ""; });
    if ($("planSelect")) {
      $("planSelect").innerHTML = `<option value="${escapeAttr(project.plan || "starter")}">${escapeHtml(capitalize(project.plan || "starter"))}</option>`;
      $("planSelect").value = project.plan || "starter";
    }
    if ($("projectSlug")) $("projectSlug").value = project.slug || slugify(project.name);
    if ($("customDomain")) $("customDomain").value = project.custom_domain || "";
    if ($("builderProjectTitle")) $("builderProjectTitle").textContent = d.businessName || project.name || "Build your website";
    updateColorLabels();
    renderUploadEditors();
    updateDomainPreview();
  }

  function queueAutosave() {
    clearTimeout(state.autosaveTimer);
    if ($("saveStatus")) $("saveStatus").textContent = "Saving changes…";
    state.autosaveTimer = setTimeout(async () => {
      readFormIntoProject();
      saveLocalState();
      if ($("saveStatus")) $("saveStatus").textContent = "Saved locally";
      renderPreview();
      if (state.user && state.apiOnline) {
        try {
          await saveProject({ silent: true });
          if ($("saveStatus")) $("saveStatus").textContent = "Saved to cloud";
        } catch {
          if ($("saveStatus")) $("saveStatus").textContent = "Saved locally; cloud unavailable";
        }
      }
    }, 650);
  }

  async function saveProject({ silent = false } = {}) {
    const project = readFormIntoProject();
    saveLocalState();
    if (state.user && state.apiOnline) {
      const result = await api("projects?action=save", {
        method: "POST",
        body: JSON.stringify({ project })
      });
      const saved = normalizeProject(result.project || result);
      const index = state.projects.findIndex((item) => item.id === project.id);
      if (index >= 0) state.projects[index] = saved;
      state.activeProjectId = saved.id;
      saveLocalState();
    }
    if (!silent) toast(state.user && state.apiOnline ? "Website saved to your account." : "Website saved on this device.", "success");
    renderProjects();
    return project;
  }

  async function saveSnapshot() {
    const project = readFormIntoProject();
    const snapshot = {
      id: uid(),
      project_id: project.id,
      name: `${project.data.businessName || project.name} — ${new Date().toLocaleString()}`,
      type: "snapshot",
      created_at: nowIso(),
      data: clone(project.data)
    };
    project.snapshots.unshift(snapshot);
    saveLocalState();
    if (state.user && state.apiOnline) {
      try {
        await api("projects?action=snapshot", {
          method: "POST",
          body: JSON.stringify({ project_id: project.id, snapshot })
        });
      } catch (error) {
        toast(`Snapshot saved locally. Cloud save failed: ${error.message}`, "error");
        return;
      }
    }
    toast("Snapshot saved.", "success");
    renderDrafts();
  }

  function renderDrafts() {
    const grid = $("savedDraftsGrid");
    if (!grid) return;
    const query = text($("draftSearchInput")?.value).toLowerCase();
    const items = [];
    state.projects.forEach((project) => {
      items.push({ ...project, itemType: "project", projectId: project.id });
      (project.snapshots || []).forEach((snapshot) => items.push({
        ...snapshot,
        plan: project.plan,
        status: "snapshot",
        itemType: "snapshot",
        projectId: project.id
      }));
    });
    const filtered = items.filter((item) => {
      if (state.currentDraftFilter === "project" && item.itemType !== "project") return false;
      if (state.currentDraftFilter === "snapshot" && item.itemType !== "snapshot") return false;
      if (state.currentDraftFilter === "incomplete" && item.status === "published") return false;
      const haystack = `${item.name || ""} ${item.data?.businessName || ""}`.toLowerCase();
      return !query || haystack.includes(query);
    });

    grid.innerHTML = filtered.map((item) => `
      <article class="saved-draft-card" data-item-type="${item.itemType}" data-project-id="${escapeAttr(item.projectId)}" data-item-id="${escapeAttr(item.id)}">
        <div><small>${item.itemType === "snapshot" ? "SNAPSHOT" : "WEBSITE"}</small>
        <h3>${escapeHtml(item.data?.businessName || item.name || "Untitled Website")}</h3>
        <p>${escapeHtml(formatDate(item.updated_at || item.created_at))}</p></div>
        <div class="saved-draft-actions">
          <button class="btn btn-primary btn-small" data-draft-action="load">Load</button>
          ${item.itemType === "project" ? `<button class="btn btn-secondary btn-small" data-draft-action="buyout">Buy Out</button>` : ""}
          ${item.itemType === "project" && item.owned ? `<button class="btn btn-secondary btn-small" data-draft-action="export">Download ZIP</button>` : ""}
        </div>
      </article>`).join("");
    if (!filtered.length) grid.innerHTML = `<div class="empty-state">No saved drafts match this view.</div>`;
    if ($("savedDraftCount")) $("savedDraftCount").textContent = filtered.length;
  }

  function handleDraftAction(event) {
    const button = event.target.closest("[data-draft-action]");
    if (!button) return;
    const card = button.closest("[data-project-id]");
    const project = state.projects.find((p) => p.id === card?.dataset.projectId);
    if (!project) return;
    const action = button.dataset.draftAction;
    if (action === "load") {
      if (card.dataset.itemType === "snapshot") {
        const snapshot = project.snapshots.find((s) => s.id === card.dataset.itemId);
        if (snapshot) project.data = clone(snapshot.data);
      }
      state.activeProjectId = project.id;
      saveLocalState();
      navigate("builder");
    } else if (action === "buyout") {
      startCheckout(project.plan, "buyout", project.id);
    } else if (action === "export") {
      exportProject(project.id);
    }
  }

  function updateColorLabels() {
    ["themeColor", "headerColor", "buttonColor", "cardColor", "logoOutlineColor"].forEach((id) => {
      const label = $(`${id}Value`);
      if (label && $(id)) label.textContent = $(id).value;
    });
  }

  function renderPreview() {
    const project = readFormIntoProject();
    const d = project.data;
    const preview = $("preview");
    if (!preview) return;

    setText("previewBusinessName", d.businessName || "YOUR BUSINESS");
    setText("previewTagline", d.headerTagline);
    setText("previewHeadline", d.headerHeadline || "Your headline appears here.");
    setText("previewBusinessBio", d.businessBio);
    setText("previewPhone", d.phoneNumber);
    setText("previewEmail", d.emailAddress);
    setText("previewHours", d.businessHours);
    setText("previewAddress", d.businessAddress);
    setText("previewAboutHeading", d.aboutHeading || "About Our Business");
    setText("previewFeaturedHeading", d.featuredHeading);
    setText("previewFeaturedDescription", d.featuredDescription);
    setText("previewGalleryHeading", d.galleryHeading);
    setText("previewGalleryDescription", d.galleryDescription);
    setText("previewMapHeading", d.mapHeading || "Find Us");
    setText("previewMapAddress", d.businessAddress);
    setText("previewFooter", d.businessName || "Your Business");

    const callText = d.callButtonText || "Call Now";
    const tel = `tel:${String(d.phoneNumber || "").replace(/[^\d+]/g, "")}`;
    ["previewCallButton", "previewHeroCall", "previewMapCall"].forEach((id) => {
      const node = $(id);
      if (node) { node.textContent = callText; node.href = tel; }
    });

    const bios = $("previewHeaderBios");
    if (bios) bios.innerHTML = d.headerBio ? `<p>${escapeHtml(d.headerBio)}</p>` : "";

    applyBackground($("previewHero"), d.headerImage);
    applyBackground($("previewAboutSection"), d.aboutCover);
    applyBackground($("previewFeaturedSection"), d.featuredCover);
    applyBackground($("previewGallerySection"), d.galleryCover);
    applyBackground($("previewMapSection"), d.mapCover);

    const logo = $("previewLogoImage");
    const placeholder = $("previewLogoPlaceholder");
    if (logo) {
      logo.src = d.businessLogo || "";
      safeShow(logo, Boolean(d.businessLogo));
    }
    safeShow(placeholder, !d.businessLogo);

    preview.style.setProperty("--theme-color", d.themeColor);
    preview.style.setProperty("--header-color", d.headerColor);
    preview.style.setProperty("--button-color", d.buttonColor);
    preview.style.setProperty("--card-color", d.cardColor);
    preview.style.setProperty("--logo-outline-color", d.logoOutlineColor);

    const header = preview.querySelector(".site-header");
    const footer = preview.querySelector(".site-footer");
    if (header) header.style.backgroundColor = d.headerColor;
    if (footer) footer.style.backgroundColor = d.headerColor;
    preview.querySelectorAll(".site-call,.hero-cta").forEach((button) => button.style.backgroundColor = d.buttonColor);
    preview.querySelectorAll(".card,.gallery-card").forEach((card) => card.style.backgroundColor = d.cardColor);
    if ($("previewLogoFrame")) $("previewLogoFrame").style.borderColor = d.logoOutlineColor;

    const scroll = $("previewScroll");
    if (scroll) scroll.innerHTML = text(d.scrollItems).split(",").map((item) => text(item)).filter(Boolean)
      .map((item) => `<span>${escapeHtml(item)}</span>`).join("");

    renderMediaGrid("previewPhotoGrid", d.photos, "card");
    renderMediaGrid("previewGalleryGrid", d.gallery, "gallery-card");
    if ($("previewPhotoCount")) $("previewPhotoCount").textContent = `${d.photos.length} uploads`;
    if ($("previewGalleryCount")) $("previewGalleryCount").textContent = `${d.gallery.length} uploads`;

    const locationValue = text(d.mapEmbedUrl) || text(d.businessAddress);
    const frame = $("previewMapFrame");
    if (frame) frame.src = locationValue
      ? `https://www.google.com/maps?q=${encodeURIComponent(locationValue)}&output=embed`
      : "about:blank";

    if ($("builderProjectTitle")) $("builderProjectTitle").textContent = d.businessName || project.name;
    updateDomainPreview();
  }

  function setText(id, value) {
    const node = $(id);
    if (node) node.textContent = value || "";
  }

  function applyBackground(node, url) {
    if (!node) return;
    node.style.backgroundImage = url
      ? `linear-gradient(rgba(0,0,0,.42),rgba(0,0,0,.42)),url("${String(url).replaceAll('"', '\\"')}")`
      : "";
    node.classList.toggle("has-cover", Boolean(url));
  }

  function renderMediaGrid(id, items = [], cardClass) {
    const grid = $(id);
    if (!grid) return;
    grid.innerHTML = items.map((item) => {
      const media = item.type?.startsWith("video")
        ? `<video src="${escapeAttr(item.url)}" controls preload="metadata"></video>`
        : `<img src="${escapeAttr(item.url)}" alt="${escapeAttr(item.description || "Website upload")}">`;
      return `<article class="${cardClass}">${media}${item.description ? `<p>${escapeHtml(item.description)}</p>` : ""}</article>`;
    }).join("");
  }

  async function fileToDataUrl(file) {
    if (!file) return "";
    const max = file.type.startsWith("video/") ? 25 * 1024 * 1024 : 8 * 1024 * 1024;
    if (file.size > max) throw new Error(`File is too large. Maximum size is ${Math.round(max / 1024 / 1024)} MB.`);
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(new Error("Could not read the selected file."));
      reader.readAsDataURL(file);
    });
  }

  async function setSingleImage(inputId, dataKey) {
    const input = $(inputId);
    const file = input?.files?.[0];
    if (!file) return;
    try {
      const url = await fileToDataUrl(file);
      ensureProject().data[dataKey] = url;
      saveLocalState();
      renderPreview();
      queueAutosave();
      input.value = "";
    } catch (error) {
      toast(error.message, "error");
    }
  }

  function removeSingleImage(dataKey) {
    ensureProject().data[dataKey] = "";
    saveLocalState();
    renderPreview();
    queueAutosave();
  }

  async function addMedia(collectionKey, fileInputId, descriptionInputId) {
    const project = ensureProject();
    const fileInput = $(fileInputId);
    const file = fileInput?.files?.[0];
    const description = text($(descriptionInputId)?.value);
    if (!file) return toast("Choose a photo or video first.", "error");

    const limits = planLimits(project.plan);
    const limit = collectionKey === "gallery" ? limits.gallery : limits.photos;
    if (collectionKey === "gallery" && !limits.galleryEnabled) return toast("Gallery uploads require the Professional or Advanced plan.", "error");
    if (project.data[collectionKey].length >= limit) return toast(`Your ${capitalize(project.plan)} plan allows ${limit} uploads in this section.`, "error");

    try {
      const url = await fileToDataUrl(file);
      project.data[collectionKey].push({
        id: uid(), url, type: file.type || "image/*", name: file.name, description, created_at: nowIso()
      });
      fileInput.value = "";
      if ($(descriptionInputId)) $(descriptionInputId).value = "";
      saveLocalState();
      renderUploadEditors();
      renderPreview();
      queueAutosave();
    } catch (error) {
      toast(error.message, "error");
    }
  }

  function renderUploadEditors() {
    const project = ensureProject();
    const render = (id, collection) => {
      const root = $(id);
      if (!root) return;
      root.innerHTML = project.data[collection].map((item) => `
        <div class="editor-list-item" data-media-id="${escapeAttr(item.id)}" data-collection="${collection}">
          <span>${item.type.startsWith("video") ? "Video" : "Photo"}</span>
          <p>${escapeHtml(item.description || item.name || "Upload")}</p>
          <button class="btn btn-danger btn-small" type="button" data-remove-media>Remove</button>
        </div>`).join("");
    };
    render("photoEditorList", "photos");
    render("galleryEditorList", "gallery");
  }

  function removeMedia(event) {
    const button = event.target.closest("[data-remove-media]");
    if (!button) return;
    const row = button.closest("[data-media-id]");
    const project = ensureProject();
    const collection = row.dataset.collection;
    project.data[collection] = project.data[collection].filter((item) => item.id !== row.dataset.mediaId);
    saveLocalState();
    renderUploadEditors();
    renderPreview();
    queueAutosave();
  }

  function setupTabs() {
    $$("#tabs .tab").forEach((tab) => tab.addEventListener("click", () => {
      $$("#tabs .tab").forEach((node) => node.classList.toggle("active", node === tab));
      $$(".sidebar .panel").forEach((panel) => panel.classList.toggle("active", panel.dataset.panel === tab.dataset.tab));
    }));
  }

  function setupDevices() {
    $$(".device").forEach((button) => button.addEventListener("click", () => {
      $$(".device").forEach((node) => node.classList.toggle("active", node === button));
      const workspace = $("preview")?.parentElement;
      if (!workspace) return;
      workspace.dataset.device = button.dataset.device;
      $("preview").classList.remove("desktop", "tablet", "mobile");
      $("preview").classList.add(button.dataset.device);
    }));
  }

  function setupThemePresets() {
    const presets = {
      blue: ["#1769ff", "#082b5e", "#1769ff", "#ffffff", "#61c7ff"],
      purple: ["#7c3aed", "#2e1065", "#7c3aed", "#ffffff", "#c4b5fd"],
      red: ["#dc2626", "#450a0a", "#dc2626", "#ffffff", "#fca5a5"],
      green: ["#059669", "#022c22", "#059669", "#ffffff", "#6ee7b7"],
      orange: ["#ea580c", "#431407", "#ea580c", "#ffffff", "#fdba74"]
    };
    $$(".theme-preset").forEach((button) => button.addEventListener("click", () => {
      const values = presets[button.dataset.theme];
      if (!values) return;
      ["themeColor", "headerColor", "buttonColor", "cardColor", "logoOutlineColor"].forEach((id, index) => {
        if ($(id)) $(id).value = values[index];
      });
      $$(".theme-preset").forEach((node) => node.classList.toggle("active", node === button));
      updateColorLabels();
      queueAutosave();
    }));
  }

  function updateDomainPreview() {
    const project = activeProject();
    if (!project) return;
    const slug = slugify($("projectSlug")?.value || project.slug || project.name);
    const base = `${location.origin}/site/${slug}`;
    if ($("subdomainPreview")) $("subdomainPreview").textContent = base;
    if ($("publishedAddress")) $("publishedAddress").textContent = project.custom_domain ? `https://${project.custom_domain}` : base;
  }

  function normalizeDomain(value) {
    return text(value).toLowerCase()
      .replace(/^https?:\/\//, "")
      .replace(/^www\./, "")
      .split("/")[0]
      .replace(/\.+$/, "");
  }

  async function checkSlug() {
    const slug = slugify($("projectSlug")?.value);
    if ($("projectSlug")) $("projectSlug").value = slug;
    updateDomainPreview();
    if (!state.apiOnline) return toast("Address format is valid. Backend availability checking will activate after the API is installed.", "success");
    try {
      const result = await api(`domains?action=check-slug&slug=${encodeURIComponent(slug)}`);
      toast(result.available ? "Address is available." : "That address is already reserved.", result.available ? "success" : "error");
    } catch (error) {
      toast(error.message, "error");
    }
  }

  async function connectDomain() {
    const project = readFormIntoProject();
    const domain = normalizeDomain($("customDomain")?.value);
    if (!domain || !domain.includes(".")) return toast("Enter a valid domain such as example.com.", "error");
    if (!state.user) return openAuth("signin");
    if (!state.apiOnline) return toast("The domain backend has not been installed yet.", "error");
    const button = $("connectDomainBtn") || $("dmConnectBtn");
    setBusy(button, true, "Connecting…");
    try {
      const result = await api("domains?action=connect", {
        method: "POST",
        body: JSON.stringify({ project_id: project.id, domain })
      });
      Object.assign(project, result.project || { custom_domain: domain, domain_status: result.status || "pending" });
      saveLocalState();
      renderDomainCenter();
      toast("Domain added. Complete the DNS records shown.", "success");
    } catch (error) {
      toast(error.message, "error");
    } finally {
      setBusy(button, false);
    }
  }

  function renderDomainCenter() {
    const project = activeProject() || state.projects[0];
    const selects = [$("dmProjectSelect"), $("publishingCenterProjectSelect")].filter(Boolean);
    selects.forEach((select) => {
      const previous = select.value;
      select.innerHTML = state.projects.map((p) => `<option value="${escapeAttr(p.id)}">${escapeHtml(p.data?.businessName || p.name)}</option>`).join("");
      select.value = project?.id || previous;
    });
    if (!project) return;

    const slug = project.slug || slugify(project.name);
    const bluvixaUrl = `${location.origin}/site/${slug}`;
    if ($("dmSlugInput")) $("dmSlugInput").value = slug;
    if ($("dmDomainInput")) $("dmDomainInput").value = project.custom_domain || "";
    setLink("dmBluvixaAddress", bluvixaUrl, bluvixaUrl);
    setText("dmOverviewBluvixa", slug ? "Reserved" : "Not reserved");
    setText("dmOverviewBluvixaDetail", bluvixaUrl);
    setText("dmOverviewDomain", project.custom_domain || "Not connected");
    setText("dmOverviewDomainDetail", capitalize((project.domain_status || "not_connected").replaceAll("_", " ")));
    setText("dmOverviewSsl", capitalize(project.ssl_status || "waiting"));
    setText("dmSideDomain", project.custom_domain || "No custom domain");
    setText("dmDetailBluvixa", bluvixaUrl);
    setText("dmDetailDomainStatus", capitalize((project.domain_status || "not_connected").replaceAll("_", " ")));
    setText("dmDetailDnsStatus", project.domain_status === "verified" ? "Yes" : "No");
    setText("dmDetailSslStatus", capitalize(project.ssl_status || "waiting"));
    setText("dmDetailVerifiedAt", project.domain_verified_at ? formatDate(project.domain_verified_at) : "—");
    setText("dmDetailLastChecked", project.domain_checked_at ? formatDate(project.domain_checked_at) : "—");
    setText("publishingCenterProjectName", project.data?.businessName || project.name);
    setText("publishingMetricStatus", capitalize(project.status));
    setText("publishingMetricDate", project.published_at ? formatDate(project.published_at) : "Never");
    setText("publishingMetricDomain", project.custom_domain || "Bluvixa address");
    setText("publishingMetricDomainDetail", project.custom_domain ? capitalize(project.domain_status) : bluvixaUrl);
    setText("publishingMetricSsl", capitalize(project.ssl_status || "waiting"));
    setText("publishingStatusText", capitalize(project.status));
    setText("publishingCenterMessage", project.status === "published" ? "This website is live." : "This website has not been published yet.");

    const liveUrl = project.published_url || (project.status === "published" ? bluvixaUrl : "");
    setLink("publishingLiveUrl", liveUrl || "#", liveUrl || "Not published");
    if ($("publishingShareUrl")) $("publishingShareUrl").value = liveUrl || "Publish the website to create a public link";
    safeShow($("publishingViewLiveBtn"), Boolean(liveUrl));
    if ($("publishingViewLiveBtn")) $("publishingViewLiveBtn").href = liveUrl || "#";
    if ($("publishingPrimaryBtn")) $("publishingPrimaryBtn").textContent = project.status === "published" ? "Publish Updates" : "Publish Now";
    renderVersionHistory(project);
  }

  function setLink(id, href, label) {
    const node = $(id);
    if (!node) return;
    node.href = href || "#";
    node.textContent = label || href || "";
  }

  function renderVersionHistory(project) {
    const root = $("publishingVersionHistory");
    if (!root) return;
    const snapshots = project.snapshots || [];
    root.innerHTML = snapshots.length ? snapshots.slice(0, 8).map((snapshot) => `
      <div class="publishing-version-row"><div><strong>${escapeHtml(snapshot.name)}</strong><small>${escapeHtml(formatDate(snapshot.created_at))}</small></div></div>`
    ).join("") : `<div class="empty-state">No saved versions yet.</div>`;
  }

  async function verifyDomain() {
    const project = activeProject();
    if (!project?.custom_domain) return toast("Connect a custom domain first.", "error");
    if (!state.apiOnline) return toast("The domain verification backend has not been installed yet.", "error");
    try {
      const result = await api("domains?action=verify", {
        method: "POST",
        body: JSON.stringify({ project_id: project.id })
      });
      Object.assign(project, result.project || result);
      saveLocalState();
      renderDomainCenter();
      toast(project.domain_status === "verified" ? "Domain verified." : "DNS is still propagating.", project.domain_status === "verified" ? "success" : "info");
    } catch (error) {
      toast(error.message, "error");
    }
  }

  async function removeDomain() {
    const project = activeProject();
    if (!project?.custom_domain) return;
    if (!confirm(`Remove ${project.custom_domain} from this website?`)) return;
    if (state.apiOnline && state.user) {
      try {
        await api("domains?action=remove", {
          method: "POST",
          body: JSON.stringify({ project_id: project.id })
        });
      } catch (error) {
        return toast(error.message, "error");
      }
    }
    project.custom_domain = "";
    project.domain_status = "not_connected";
    project.ssl_status = "waiting";
    saveLocalState();
    renderDomainCenter();
  }

  async function publishProject() {
    const project = await saveProject({ silent: true });
    if (!state.user) return openAuth("signin");
    if (!state.apiOnline) return toast("The publishing backend has not been installed yet.", "error");
    const button = $("publishingPrimaryBtn") || $("publishBtn");
    setBusy(button, true, "Publishing…");
    updatePublishProgress(10, "save", "Complete");
    try {
      updatePublishProgress(35, "media", "Checking");
      const result = await api("publish?action=publish", {
        method: "POST",
        body: JSON.stringify({ project_id: project.id })
      });
      updatePublishProgress(75, "build", "Complete");
      Object.assign(project, result.project || result);
      project.status = "published";
      project.published_at = project.published_at || nowIso();
      updatePublishProgress(100, "deploy", "Complete");
      saveLocalState();
      renderDomainCenter();
      toast("Website published successfully.", "success");
    } catch (error) {
      toast(error.message, "error");
      updatePublishProgress(0);
    } finally {
      setBusy(button, false);
    }
  }

  function updatePublishProgress(percent, step, label) {
    if ($("publishingProgressPercent")) $("publishingProgressPercent").textContent = `${percent}%`;
    if ($("publishingProgressBar")) $("publishingProgressBar").style.width = `${percent}%`;
    if (step) {
      const row = document.querySelector(`[data-publish-step="${step}"]`);
      if (row) {
        row.classList.add("complete");
        const small = row.querySelector("small");
        if (small) small.textContent = label || "Complete";
      }
    }
  }

  async function startCheckout(plan, type = "subscription", projectId = "") {
    const normalizedPlan = String(plan || "starter").trim().toLowerCase();
    const allowedPlans = new Set(["starter", "professional", "advanced"]);
    const selectedPlan = allowedPlans.has(normalizedPlan) ? normalizedPlan : "starter";

    if (type === "buyout" && !state.user) {
      return openAuth("signin");
    }

    try {
      const result = await api(
        `billing?action=${type === "buyout" ? "buyout-checkout" : "subscription-checkout"}`,
        {
          method: "POST",
          body: JSON.stringify({
            plan: selectedPlan,
            project_id: projectId || undefined,
            success_url: `${location.origin}/#${type === "buyout" ? "drafts" : "billing"}?checkout=success`,
            cancel_url: `${location.origin}/#pricing?checkout=canceled`
          })
        }
      );

      if (!result.url) {
        throw new Error("Stripe did not return a checkout URL.");
      }

      state.apiOnline = true;
      window.location.href = result.url;
    } catch (error) {
      toast(error.message || "Stripe checkout could not be opened.", "error");
    }
  }

  async function manageBilling() {
    if (!state.user) return openAuth("signin");
    if (!state.apiOnline) return toast("The Stripe backend has not been installed yet.", "error");
    try {
      const result = await api("billing?action=portal", {
        method: "POST",
        body: JSON.stringify({ return_url: `${location.origin}/#billing` })
      });
      if (!result.url) throw new Error("Stripe did not return a billing portal URL.");
      location.assign(result.url);
    } catch (error) {
      toast(error.message, "error");
    }
  }

  async function exportProject(projectId) {
    const project = state.projects.find((item) => item.id === projectId);
    if (!project?.owned) return toast("This website must be bought out before ZIP export is unlocked.", "error");
    if (!state.apiOnline) return toast("The secure ZIP export backend has not been installed yet.", "error");
    try {
      const response = await fetch(`${API_BASE}/export?action=download&project_id=${encodeURIComponent(projectId)}`, {
        headers: state.session?.access_token ? { Authorization: `Bearer ${state.session.access_token}` } : {}
      });
      if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || "Export failed.");
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${slugify(project.data?.businessName || project.name)}.zip`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      toast(error.message, "error");
    }
  }

  function copyText(value, success = "Copied.") {
    navigator.clipboard?.writeText(value).then(() => toast(success, "success")).catch(() => toast("Copy failed.", "error"));
  }

  function sharePublished() {
    const project = activeProject();
    const url = project?.published_url;
    if (!url) return toast("Publish this website first.", "error");
    if (navigator.share) navigator.share({ title: project.data?.businessName || project.name, url }).catch(() => {});
    else copyText(url, "Website link copied.");
  }

  function setupPreviewNavigation() {
    $("previewMenuToggle")?.addEventListener("click", () => {
      const nav = $("previewSiteNav");
      nav?.classList.toggle("open");
      $("previewMenuToggle").setAttribute("aria-expanded", nav?.classList.contains("open") ? "true" : "false");
    });
    $$("[data-preview-target]").forEach((button) => button.addEventListener("click", () => {
      $(button.dataset.previewTarget)?.scrollIntoView({ behavior: "smooth", block: "start" });
      $("previewSiteNav")?.classList.remove("open");
    }));
  }

  function resetBuilder() {
    if (!confirm("Reset this website to a blank design?")) return;
    const current = activeProject();
    const replacement = createProject({ id: current?.id || uid(), plan: current?.plan || "starter", name: current?.name || "Untitled Website" });
    const index = state.projects.findIndex((p) => p.id === replacement.id);
    if (index >= 0) state.projects[index] = replacement;
    else state.projects.unshift(replacement);
    state.activeProjectId = replacement.id;
    saveLocalState();
    loadProjectIntoForm(replacement);
    renderPreview();
    toast("Builder reset.");
  }

  function setupEvents() {
    window.addEventListener("hashchange", renderRoute);
    document.addEventListener("click", (event) => {
      const modal = event.target.closest(".modal");
      if (modal && event.target === modal) safeShow(modal, false);
    });

    $("mobileMenuButton")?.addEventListener("click", () => $("mobileMenu")?.classList.contains("hidden") ? openMobileMenu() : closeMobileMenu());
    ["signInBtn", "mobileSignInBtn"].forEach((id) => $(id)?.addEventListener("click", () => openAuth("signin")));
    ["startTrialBtn", "mobileStartTrialBtn", "landingStartBtn"].forEach((id) => {
      $(id)?.addEventListener("click", (event) => {
        event.preventDefault();
        navigate("pricing");

        requestAnimationFrame(() => {
          const pricingSection = $("pricing");
          pricingSection?.scrollIntoView({
            behavior: "smooth",
            block: "start"
          });
        });
      });
    });
    $("closeAuthBtn")?.addEventListener("click", closeAuth);
    $("showSignInTab")?.addEventListener("click", () => openAuth("signin"));
    $("showSignUpTab")?.addEventListener("click", () => openAuth("signup"));
    $("authForm")?.addEventListener("submit", submitAuth);
    $("forgotPasswordBtn")?.addEventListener("click", forgotPassword);
    ["signOutBtn", "mobileSignOutBtn", "accountSignOutBtn"].forEach((id) => $(id)?.addEventListener("click", signOut));
    $("accountNavLink")?.addEventListener("click", () => navigate("projects"));

    ["createWebsiteBtn", "createWebsiteFromDraftsBtn"].forEach((id) => $(id)?.addEventListener("click", newProject));
    $("websiteLibraryGrid")?.addEventListener("click", handleProjectAction);
    $("projectSearchInput")?.addEventListener("input", renderProjects);
    $("draftSearchInput")?.addEventListener("input", renderDrafts);
    $("savedDraftsGrid")?.addEventListener("click", handleDraftAction);
    $$("[data-draft-filter]").forEach((button) => button.addEventListener("click", () => {
      state.currentDraftFilter = button.dataset.draftFilter;
      $$("[data-draft-filter]").forEach((node) => node.classList.toggle("active", node === button));
      renderDrafts();
    }));

    ["saveWebsiteProjectBtn", "saveBtn"].forEach((id) => $(id)?.addEventListener("click", () => saveProject()));
    ["saveSnapshotTopBtn", "saveCurrentDraftBtn"].forEach((id) => $(id)?.addEventListener("click", saveSnapshot));
    $("loadDraftBtn")?.addEventListener("click", () => navigate("drafts"));
    $("resetBtn")?.addEventListener("click", resetBuilder);

    const formIds = [
      "businessName","businessBio","phoneNumber","emailAddress","businessHours","callButtonText",
      "headerTagline","headerHeadline","headerBio","aboutHeading","featuredHeading","featuredDescription",
      "galleryHeading","galleryDescription","themeColor","headerColor","buttonColor","cardColor",
      "logoOutlineColor","scrollItems","mapHeading","businessAddress","mapEmbedUrl","projectSlug","customDomain"
    ];
    formIds.forEach((id) => {
      $(id)?.addEventListener("input", () => { updateColorLabels(); renderPreview(); queueAutosave(); });
      $(id)?.addEventListener("change", () => { updateColorLabels(); renderPreview(); queueAutosave(); });
    });

    const imageBindings = [
      ["headerImage", "headerImage"], ["businessLogo", "businessLogo"], ["aboutCoverFile", "aboutCover"],
      ["featuredCoverFile", "featuredCover"], ["galleryCoverFile", "galleryCover"], ["mapCoverFile", "mapCover"]
    ];
    imageBindings.forEach(([id, key]) => $(id)?.addEventListener("change", () => setSingleImage(id, key)));
    $("removeLogoBtn")?.addEventListener("click", () => removeSingleImage("businessLogo"));
    $("removeAboutCoverBtn")?.addEventListener("click", () => removeSingleImage("aboutCover"));
    $("removeFeaturedCoverBtn")?.addEventListener("click", () => removeSingleImage("featuredCover"));
    $("removeGalleryCoverBtn")?.addEventListener("click", () => removeSingleImage("galleryCover"));
    $("removeMapCoverBtn")?.addEventListener("click", () => removeSingleImage("mapCover"));
    $("addPhotoBtn")?.addEventListener("click", () => addMedia("photos", "photoFile", "photoDescription"));
    $("addGalleryBtn")?.addEventListener("click", () => addMedia("gallery", "galleryFile", "galleryUploadDescription"));
    $("photoEditorList")?.addEventListener("click", removeMedia);
    $("galleryEditorList")?.addEventListener("click", removeMedia);

    $("domainModeSubdomain")?.addEventListener("change", () => {
      safeShow($("subdomainSettings"), true); safeShow($("customDomainSettings"), false);
    });
    $("domainModeCustom")?.addEventListener("change", () => {
      safeShow($("subdomainSettings"), false); safeShow($("customDomainSettings"), true);
    });
    ["checkSubdomainBtn", "dmCheckSlugBtn"].forEach((id) => $(id)?.addEventListener("click", checkSlug));
    ["connectDomainBtn", "dmConnectBtn"].forEach((id) => $(id)?.addEventListener("click", connectDomain));
    ["verifyDomainBtn", "dmVerifyBtn", "dmRetryBtn"].forEach((id) => $(id)?.addEventListener("click", verifyDomain));
    $("dmRemoveBtn")?.addEventListener("click", removeDomain);
    $("dmRefreshAllBtn")?.addEventListener("click", verifyDomain);
    $("dmProjectSelect")?.addEventListener("change", (event) => {
      state.activeProjectId = event.target.value; saveLocalState(); renderDomainCenter();
    });
    $("publishingCenterProjectSelect")?.addEventListener("change", (event) => {
      state.activeProjectId = event.target.value; saveLocalState(); renderDomainCenter();
    });

    ["publishBtn", "publishingPrimaryBtn"].forEach((id) => $(id)?.addEventListener("click", publishProject));
    $("copyPublishedLinkBtn")?.addEventListener("click", () => {
      const url = activeProject()?.published_url;
      if (url) copyText(url, "Website link copied.");
      else toast("Publish this website first.", "error");
    });
    $("sharePublishedSiteBtn")?.addEventListener("click", sharePublished);
    $("openDomainForPublishingBtn")?.addEventListener("click", () => navigate("domains"));

    $$(".pricingTrial,.memberPlanCheckout").forEach((button) => button.addEventListener("click", () => startCheckout(button.dataset.plan, "subscription")));
    $("annualCheckoutBtn")?.addEventListener("click", () => startCheckout(currentSelectedPlan(), "subscription"));
    $("buyoutBtn")?.addEventListener("click", () => startCheckout(currentSelectedPlan(), "buyout", activeProject()?.id));
    $("manageBillingBtn")?.addEventListener("click", manageBilling);

    $$("[data-copy-target]").forEach((button) => button.addEventListener("click", () => {
      copyText($(button.dataset.copyTarget)?.textContent || "");
    }));

    $("closeBackendBtn")?.addEventListener("click", () => safeShow($("backendModal"), false));
    $("refreshJsonBtn")?.addEventListener("click", () => {
      if ($("backendJson")) $("backendJson").textContent = JSON.stringify({
        version: APP_VERSION,
        apiOnline: state.apiOnline,
        signedIn: Boolean(state.user),
        projectCount: state.projects.length,
        activeProjectId: state.activeProjectId
      }, null, 2);
    });

    setupTabs();
    setupDevices();
    setupThemePresets();
    setupPreviewNavigation();
  }

  function formatDate(value) {
    if (!value) return "Unknown";
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "Unknown" : new Intl.DateTimeFormat("en-US", {
      month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit"
    }).format(date);
  }

  function capitalize(value) {
    return text(value).replace(/\b\w/g, (letter) => letter.toUpperCase());
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (char) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
    })[char]);
  }

  function escapeAttr(value) {
    return escapeHtml(value).replace(/`/g, "&#096;");
  }

  async function init() {
    setupEvents();
    await detectApi();
    await restoreSession();
    await loadProfile();
    await loadProjects();
    if (!state.projects.length) {
      const project = createProject();
      state.projects.push(project);
      state.activeProjectId = project.id;
      saveLocalState();
    }
    renderAuthState();
    renderProjects();
    renderDrafts();
    renderRoute();
    loadProjectIntoForm(activeProject());
    renderPreview();

    const params = new URLSearchParams(location.hash.split("?")[1] || location.search);
    if (params.get("checkout") === "success") toast("Payment confirmed. Your account is refreshing.", "success");
  }

  document.readyState === "loading"
    ? document.addEventListener("DOMContentLoaded", init, { once: true })
    : init();

  window.Bluvixa = {
    version: APP_VERSION,
    getState: () => clone({
      user: state.user,
      profile: state.profile,
      projects: state.projects,
      activeProjectId: state.activeProjectId,
      apiOnline: state.apiOnline
    }),
    save: saveProject,
    publish: publishProject
  };
})();