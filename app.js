/* =========================================================
   BLUVIXA — PRODUCTION FRONTEND CONTROLLER
   Matches the 12-file Bluvixa API backend package.
   Preserves local builder operation when the API is unavailable.
   ========================================================= */
(() => {
  "use strict";

  const STORAGE_KEY = "bluvixa_frontend_workspace_v1";
  const SESSION_KEY = "bluvixa_session_v1";
  const API_BASE = "/api";

  const $ = (id) => document.getElementById(id);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  const trim = (value) => typeof value === "string" ? value.trim() : "";
  const now = () => new Date().toISOString();
  const makeId = () =>
    globalThis.crypto?.randomUUID?.() ||
    `bv_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

  const DEFAULT_DATA = {
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
    featuredHeading: "Featured Services",
    featuredDescription: "",
    featuredCover: "",
    photos: [],
    galleryHeading: "Gallery",
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
  };

  const state = {
    projects: [],
    activeProjectId: "",
    draftFilter: "all",
    saveTimer: null,
    authMode: "signin",
    apiOnline: false,
    session: null,
    user: null,
    profile: null,
    loadingCloud: false
  };

  const formMap = {
    businessName: "businessName",
    businessBio: "businessBio",
    phoneNumber: "phoneNumber",
    emailAddress: "emailAddress",
    businessHours: "businessHours",
    callButtonText: "callButtonText",
    headerTagline: "headerTagline",
    headerHeadline: "headerHeadline",
    headerBio: "headerBio",
    aboutHeading: "aboutHeading",
    featuredHeading: "featuredHeading",
    featuredDescription: "featuredDescription",
    galleryHeading: "galleryHeading",
    galleryDescription: "galleryDescription",
    themeColor: "themeColor",
    headerColor: "headerColor",
    buttonColor: "buttonColor",
    cardColor: "cardColor",
    logoOutlineColor: "logoOutlineColor",
    scrollItems: "scrollItems",
    mapHeading: "mapHeading",
    businessAddress: "businessAddress",
    mapEmbedUrl: "mapEmbedUrl"
  };

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function slugify(value) {
    return trim(value)
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 63) || "my-website";
  }

  function normalizeDomain(value) {
    return trim(value)
      .toLowerCase()
      .replace(/^https?:\/\//, "")
      .replace(/^www\./, "")
      .split("/")[0]
      .replace(/\.+$/, "");
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (character) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;"
    })[character]);
  }

  function formatDate(value) {
    const date = new Date(value);
    return Number.isNaN(date.getTime())
      ? "Just now"
      : date.toLocaleString([], {
          month: "short",
          day: "numeric",
          year: "numeric",
          hour: "numeric",
          minute: "2-digit"
        });
  }

  function show(element, visible = true) {
    if (!element) return;
    element.hidden = !visible;
    element.classList.toggle("hidden", !visible);
    element.style.display = visible ? "" : "none";
  }

  function toast(message, type = "info") {
    const node = $("toast");
    if (!node) {
      console.log(message);
      return;
    }

    node.textContent = message;
    node.dataset.type = type;
    node.classList.add("show");
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => node.classList.remove("show"), 3400);
  }

  function setBusy(button, busy, label = "Working…") {
    if (!button) return;
    if (busy) {
      button.dataset.originalText = button.textContent;
      button.textContent = label;
      button.disabled = true;
    } else {
      button.textContent = button.dataset.originalText || button.textContent;
      button.disabled = false;
    }
  }

  function authMessage(message, type = "info") {
    const node = $("authMessage");
    if (!node) return;
    node.textContent = message;
    node.dataset.type = type;
    show(node, Boolean(message));
  }

  async function api(path, options = {}) {
    const headers = new Headers(options.headers || {});
    const isForm = options.body instanceof FormData;

    if (options.body && !isForm && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }

    if (state.session?.access_token) {
      headers.set("Authorization", `Bearer ${state.session.access_token}`);
    }

    const response = await fetch(`${API_BASE}/${path.replace(/^\/+/, "")}`, {
      ...options,
      headers,
      credentials: "same-origin"
    });

    const type = response.headers.get("content-type") || "";
    const payload = type.includes("application/json")
      ? await response.json().catch(() => ({}))
      : await response.text();

    if (!response.ok) {
      const message =
        typeof payload === "string"
          ? payload
          : payload.error || payload.message || `Request failed (${response.status})`;
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
    return state.apiOnline;
  }

  function saveSession(session) {
    state.session = session?.access_token ? session : null;
    state.user = session?.user || state.user || null;

    if (state.session) {
      localStorage.setItem(SESSION_KEY, JSON.stringify(state.session));
    } else {
      localStorage.removeItem(SESSION_KEY);
      state.user = null;
      state.profile = null;
    }

    renderAuthState();
  }

  function restoreCachedSession() {
    try {
      const cached = JSON.parse(localStorage.getItem(SESSION_KEY) || "null");
      if (cached?.access_token) {
        state.session = cached;
        state.user = cached.user || null;
      }
    } catch {
      localStorage.removeItem(SESSION_KEY);
    }
  }

  function newProject(name = "Untitled Website") {
    const created = now();
    return {
      id: makeId(),
      name,
      slug: slugify(name),
      plan: "starter",
      status: "draft",
      createdAt: created,
      updatedAt: created,
      customDomain: "",
      custom_domain: "",
      domain_status: "not_connected",
      ssl_status: "waiting",
      published_url: "",
      published_at: "",
      owned: false,
      snapshots: [],
      data: clone(DEFAULT_DATA)
    };
  }

  function normalizeProject(project) {
    const base = newProject();
    const data = project?.data || project?.project_data || {};
    const snapshots = project?.snapshots || project?.project_snapshots || [];

    return {
      ...base,
      ...project,
      id: project?.id || base.id,
      createdAt: project?.createdAt || project?.created_at || base.createdAt,
      updatedAt: project?.updatedAt || project?.updated_at || base.updatedAt,
      customDomain:
        project?.customDomain || project?.custom_domain || "",
      custom_domain:
        project?.custom_domain || project?.customDomain || "",
      data: { ...base.data, ...data },
      snapshots: Array.isArray(snapshots)
        ? snapshots.map((snapshot) => ({
            ...snapshot,
            id: snapshot.id || makeId(),
            name: snapshot.name || "Snapshot",
            createdAt: snapshot.createdAt || snapshot.created_at || now(),
            data: snapshot.data || snapshot.snapshot_data || {}
          }))
        : []
    };
  }

  function loadWorkspace() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
      state.projects = Array.isArray(saved.projects)
        ? saved.projects.map(normalizeProject)
        : [];
      state.activeProjectId = trim(saved.activeProjectId);
    } catch {
      state.projects = [];
      state.activeProjectId = "";
    }

    if (!state.projects.length) {
      const project = newProject();
      state.projects.push(project);
      state.activeProjectId = project.id;
    }

    if (!state.projects.some((project) => project.id === state.activeProjectId)) {
      state.activeProjectId = state.projects[0]?.id || "";
    }

    saveWorkspace();
  }

  function saveWorkspace() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      projects: state.projects,
      activeProjectId: state.activeProjectId
    }));
  }

  function activeProject() {
    return (
      state.projects.find((project) => project.id === state.activeProjectId) ||
      state.projects[0] ||
      null
    );
  }

  function replaceProject(project) {
    const normalized = normalizeProject(project);
    const index = state.projects.findIndex((item) => item.id === normalized.id);

    if (index >= 0) state.projects[index] = normalized;
    else state.projects.unshift(normalized);

    state.activeProjectId = normalized.id;
    saveWorkspace();
    return normalized;
  }

  function currentRoute() {
    const requested = location.hash.replace(/^#/, "").split("?")[0];
    return $(requested)?.classList.contains("app-page") ? requested : "home";
  }

  function navigate(page) {
    const target = page.startsWith("#") ? page : `#${page}`;
    if (location.hash === target) renderRoute();
    else location.hash = target;
  }

  function renderRoute() {
    const current = currentRoute();

    $$(".app-page").forEach((page) => {
      const active = page.id === current;
      page.hidden = !active;
      page.classList.toggle("route-active", active);
      page.classList.toggle("active", active);
      page.classList.toggle("hidden", !active);
      page.style.display = active ? "" : "none";
    });

    document.body.className = `${state.user ? "member-authenticated " : ""}route-${current}`;
    show($("mobileMenu"), false);

    if (current === "builder") {
      loadProjectIntoBuilder(activeProject());
      renderPreview();
    }
    if (current === "projects") renderProjects();
    if (current === "drafts") renderDrafts();
    if (current === "billing") renderBilling();
    if (current === "domains") renderDomainPage();

    window.scrollTo(0, 0);
  }

  function renderAuthState() {
    const signedIn = Boolean(state.user);

    show($("publicNav"), !signedIn);
    show($("memberNav"), signedIn);
    show($("mobileMenuPublic"), !signedIn);
    show($("mobileMenuMember"), signedIn);
    show($("signInBtn"), !signedIn);
    show($("startTrialBtn"), !signedIn);
    show($("accountNavLink"), signedIn);
    show($("signOutBtn"), signedIn);
    show($("mobileSignOutBtn"), signedIn);

    $$(".backend-only").forEach((element) => show(element, signedIn));

    const email = state.user?.email || "Your account";
    if ($("sidebarMemberEmail")) $("sidebarMemberEmail").textContent = email;
    if ($("draftsMemberEmail")) $("draftsMemberEmail").textContent = email;
    if ($("accountNavLink")) {
      $("accountNavLink").textContent = email.charAt(0).toUpperCase() || "B";
    }

    if ($("projectsGreeting")) {
      $("projectsGreeting").textContent = signedIn
        ? `Welcome, ${email.split("@")[0]}`
        : "Welcome home";
    }

    show($("sessionLoadingScreen"), false);
    renderBilling();
  }

  function openAuth(mode = "signin") {
    state.authMode = mode;
    const signingUp = mode === "signup";

    show($("authModal"), true);
    show($("fullNameGroup"), signingUp);

    if ($("authTitle")) {
      $("authTitle").textContent = signingUp
        ? "Create your Bluvixa account"
        : "Sign in to Bluvixa";
    }

    if ($("authSubmitBtn")) {
      $("authSubmitBtn").textContent = signingUp ? "Create Account" : "Sign In";
    }

    $("showSignInTab")?.classList.toggle("active", !signingUp);
    $("showSignUpTab")?.classList.toggle("active", signingUp);
    authMessage("");
    setTimeout(() => $("authEmail")?.focus(), 20);
  }

  function closeAuth() {
    show($("authModal"), false);
  }

  async function submitAuth(event) {
    event.preventDefault();

    const email = trim($("authEmail")?.value).toLowerCase();
    const password = $("authPassword")?.value || "";
    const fullName = trim($("authFullName")?.value);

    if (!email.includes("@")) return authMessage("Enter a valid email address.", "error");
    if (password.length < 8) {
      return authMessage("Password must contain at least 8 characters.", "error");
    }
    if (state.authMode === "signup" && !fullName) {
      return authMessage("Enter your full name.", "error");
    }
    if (!state.apiOnline) {
      return authMessage("The API is not running. Start the project with npx vercel dev.", "error");
    }

    const button = $("authSubmitBtn");
    setBusy(button, true, state.authMode === "signup" ? "Creating Account…" : "Signing In…");

    try {
      const result = await api(
        `auth?action=${state.authMode === "signup" ? "signup" : "signin"}`,
        {
          method: "POST",
          body: JSON.stringify({
            email,
            password,
            full_name: fullName
          })
        }
      );

      if (result.session) {
        saveSession(result.session);
        closeAuth();
        await loadProfile();
        await loadCloudProjects();
        toast(state.authMode === "signup" ? "Account created." : "Signed in.", "success");
        navigate("projects");
      } else if (result.requires_email_confirmation) {
        authMessage("Account created. Check your email to confirm it, then sign in.", "success");
      }
    } catch (error) {
      authMessage(error.message, "error");
    } finally {
      setBusy(button, false);
    }
  }

  async function forgotPassword() {
    const email = trim($("authEmail")?.value).toLowerCase();
    if (!email.includes("@")) return authMessage("Enter your email first.", "error");
    if (!state.apiOnline) return authMessage("The API is not running.", "error");

    try {
      await api("auth?action=reset-password", {
        method: "POST",
        body: JSON.stringify({
          email,
          redirect_to: `${location.origin}/#home`
        })
      });
      authMessage("Password reset email sent.", "success");
    } catch (error) {
      authMessage(error.message, "error");
    }
  }

  async function signOut() {
    saveSession(null);
    toast("Signed out.", "success");
    navigate("home");
  }

  async function loadProfile() {
    if (!state.user || !state.apiOnline) return;

    try {
      const result = await api("auth?action=profile");
      state.profile = result.profile || null;
      renderBilling();
    } catch (error) {
      if (error.status === 401) saveSession(null);
    }
  }

  async function loadCloudProjects() {
    if (!state.user || !state.apiOnline || state.loadingCloud) return;
    state.loadingCloud = true;

    try {
      const result = await api("projects?action=list");
      const cloudProjects = (result.projects || []).map(normalizeProject);

      if (cloudProjects.length) {
        state.projects = cloudProjects;
        if (!state.projects.some((project) => project.id === state.activeProjectId)) {
          state.activeProjectId = state.projects[0].id;
        }
      } else {
        const local = activeProject();
        if (local) {
          const created = await api("projects?action=create", {
            method: "POST",
            body: JSON.stringify({ project: local })
          });
          state.projects = [normalizeProject(created.project)];
          state.activeProjectId = state.projects[0].id;
        }
      }

      saveWorkspace();
      renderProjects();
      renderDrafts();
    } catch (error) {
      toast(`Cloud projects unavailable: ${error.message}`, "error");
    } finally {
      state.loadingCloud = false;
    }
  }

  async function createProject() {
    const local = newProject();
    state.projects.unshift(local);
    state.activeProjectId = local.id;
    saveWorkspace();

    if (state.user && state.apiOnline) {
      try {
        const result = await api("projects?action=create", {
          method: "POST",
          body: JSON.stringify({ project: local })
        });
        replaceProject(result.project);
      } catch (error) {
        toast(`Created locally. Cloud create failed: ${error.message}`, "error");
      }
    }

    navigate("builder");
    toast("New website created.", "success");
  }

  function renderProjects() {
    const grid = $("websiteLibraryGrid");
    if (!grid) return;

    const query = trim($("projectSearchInput")?.value).toLowerCase();
    const filtered = state.projects.filter((project) => {
      const searchable =
        `${project.name} ${project.slug} ${project.data.businessName}`.toLowerCase();
      return !query || searchable.includes(query);
    });

    grid.innerHTML = filtered.map((project) => {
      const title = project.data.businessName || project.name;
      const cover = project.data.headerImage || project.data.featuredCover || "";
      return `
        <article class="website-library-card" data-project-id="${escapeHtml(project.id)}">
          <div class="website-card-preview"${cover ? ` style="background-image:url('${cover}')"` : ""}>
            ${cover ? "" : `<span>${escapeHtml(title.charAt(0).toUpperCase())}</span>`}
            <small>${escapeHtml(project.status || "draft")}</small>
          </div>
          <div class="website-card-body">
            <small>${escapeHtml((project.plan || "starter").toUpperCase())}</small>
            <h3>${escapeHtml(title)}</h3>
            <p>Updated ${escapeHtml(formatDate(project.updatedAt))}</p>
            ${project.published_url ? `<a href="${escapeHtml(project.published_url)}" target="_blank" rel="noopener">View website</a>` : ""}
            <div class="website-card-actions">
              <button class="btn btn-primary btn-small" data-project-action="edit">Edit</button>
              <button class="btn btn-secondary btn-small" data-project-action="duplicate">Duplicate</button>
              <button class="btn btn-danger btn-small" data-project-action="delete">Delete</button>
            </div>
          </div>
        </article>`;
    }).join("");

    if (!filtered.length) {
      grid.innerHTML = `<div class="empty-state">No websites found.</div>`;
    }

    if ($("projectCount")) $("projectCount").textContent = state.projects.length;
    if ($("publishedProjectCount")) {
      $("publishedProjectCount").textContent =
        state.projects.filter((project) => project.status === "published").length;
    }
    if ($("draftProjectCount")) {
      $("draftProjectCount").textContent =
        state.projects.filter((project) => project.status !== "published").length;
    }
  }

  async function handleProjectAction(event) {
    const button = event.target.closest("[data-project-action]");
    if (!button) return;

    const card = button.closest("[data-project-id]");
    const project = state.projects.find((item) => item.id === card?.dataset.projectId);
    if (!project) return;

    const actionName = button.dataset.projectAction;

    if (actionName === "edit") {
      state.activeProjectId = project.id;
      saveWorkspace();
      navigate("builder");
      return;
    }

    if (actionName === "duplicate") {
      const copy = normalizeProject(clone(project));
      copy.id = makeId();
      copy.name = `${project.name} Copy`;
      copy.slug = `${slugify(copy.name)}-${Math.random().toString(36).slice(2, 6)}`;
      copy.status = "draft";
      copy.published_url = "";
      copy.customDomain = "";
      copy.custom_domain = "";
      copy.owned = false;
      copy.createdAt = now();
      copy.updatedAt = copy.createdAt;

      state.projects.unshift(copy);
      saveWorkspace();

      if (state.user && state.apiOnline) {
        try {
          const result = await api("projects?action=create", {
            method: "POST",
            body: JSON.stringify({ project: copy })
          });
          replaceProject(result.project);
        } catch (error) {
          toast(`Duplicated locally. Cloud copy failed: ${error.message}`, "error");
        }
      }

      renderProjects();
      toast("Website duplicated.", "success");
      return;
    }

    if (actionName === "delete") {
      if (!confirm(`Delete "${project.data.businessName || project.name}"?`)) return;

      if (state.user && state.apiOnline && !String(project.id).startsWith("bv_")) {
        try {
          await api(`projects?action=delete&id=${encodeURIComponent(project.id)}`, {
            method: "DELETE"
          });
        } catch (error) {
          return toast(error.message, "error");
        }
      }

      state.projects = state.projects.filter((item) => item.id !== project.id);
      if (!state.projects.length) state.projects.push(newProject());
      if (state.activeProjectId === project.id) {
        state.activeProjectId = state.projects[0].id;
      }

      saveWorkspace();
      renderProjects();
      toast("Website deleted.", "success");
    }
  }

  function loadProjectIntoBuilder(project) {
    if (!project) return;

    Object.entries(formMap).forEach(([key, id]) => {
      if ($(id)) $(id).value = project.data[key] ?? "";
    });

    if ($("planSelect")) {
      const desired = project.plan || "starter";
      const option = Array.from($("planSelect").options).find((item) => item.value === desired);
      if (option) $("planSelect").value = desired;
    }

    if ($("projectSlug")) $("projectSlug").value = project.slug || slugify(project.name);
    if ($("customDomain")) {
      $("customDomain").value = project.customDomain || project.custom_domain || "";
    }
    if ($("builderProjectTitle")) {
      $("builderProjectTitle").textContent = project.data.businessName || project.name;
    }

    updateColorLabels();
    renderUploadEditors();
    updateAddressPreview();
  }

  function readBuilderIntoProject() {
    const project = activeProject();
    if (!project) return null;

    Object.entries(formMap).forEach(([key, id]) => {
      if ($(id)) project.data[key] = $(id).value;
    });

    project.name = trim(project.data.businessName) || project.name || "Untitled Website";
    project.slug = slugify($("projectSlug")?.value || project.slug || project.name);
    project.customDomain = normalizeDomain(
      $("customDomain")?.value || project.customDomain || project.custom_domain
    );
    project.custom_domain = project.customDomain;
    project.updatedAt = now();
    project.updated_at = project.updatedAt;

    return project;
  }

  async function saveProject(showToast = true) {
    const project = readBuilderIntoProject();
    if (!project) return null;

    saveWorkspace();
    renderProjects();
    if ($("saveStatus")) $("saveStatus").textContent = "Saved on this device";

    if (state.user && state.apiOnline) {
      try {
        const result = await api("projects?action=save", {
          method: "POST",
          body: JSON.stringify({ project })
        });
        const saved = replaceProject(result.project);
        if ($("saveStatus")) $("saveStatus").textContent = "Saved to cloud";
        if (showToast) toast("Website saved to your account.", "success");
        return saved;
      } catch (error) {
        if ($("saveStatus")) $("saveStatus").textContent = "Saved locally; cloud failed";
        if (showToast) toast(error.message, "error");
        return project;
      }
    }

    if (showToast) {
      toast(
        state.apiOnline
          ? "Website saved locally. Sign in to save it to your account."
          : "Website saved on this device.",
        "success"
      );
    }

    return project;
  }

  function queueSave() {
    clearTimeout(state.saveTimer);
    if ($("saveStatus")) $("saveStatus").textContent = "Saving…";

    state.saveTimer = setTimeout(async () => {
      await saveProject(false);
      renderPreview();
    }, 650);
  }

  async function saveSnapshot() {
    let project = readBuilderIntoProject();
    if (!project) return;

    const snapshot = {
      id: makeId(),
      name: `${project.data.businessName || project.name} — ${new Date().toLocaleString()}`,
      createdAt: now(),
      data: clone(project.data)
    };

    project.snapshots.unshift(snapshot);
    saveWorkspace();

    if (state.user && state.apiOnline) {
      try {
        if (String(project.id).startsWith("bv_")) {
          project = await saveProject(false);
        }

        const result = await api("projects?action=snapshot", {
          method: "POST",
          body: JSON.stringify({
            project_id: project.id,
            snapshot
          })
        });

        project.snapshots[0] = {
          ...snapshot,
          ...(result.snapshot || {}),
          data: result.snapshot?.data || snapshot.data
        };
        saveWorkspace();
      } catch (error) {
        toast(`Snapshot saved locally. Cloud snapshot failed: ${error.message}`, "error");
      }
    }

    renderDrafts();
    toast("Snapshot saved.", "success");
  }

  function renderDrafts() {
    const grid = $("savedDraftsGrid");
    if (!grid) return;

    const query = trim($("draftSearchInput")?.value).toLowerCase();
    const items = [];

    state.projects.forEach((project) => {
      items.push({
        id: project.id,
        projectId: project.id,
        type: "project",
        name: project.data.businessName || project.name,
        date: project.updatedAt,
        owned: project.owned
      });

      project.snapshots.forEach((snapshot) => {
        items.push({
          id: snapshot.id,
          projectId: project.id,
          type: "snapshot",
          name: snapshot.name,
          date: snapshot.createdAt
        });
      });
    });

    const filtered = items.filter((item) => {
      if (
        state.draftFilter !== "all" &&
        state.draftFilter !== "incomplete" &&
        item.type !== state.draftFilter
      ) {
        return false;
      }
      return !query || item.name.toLowerCase().includes(query);
    });

    grid.innerHTML = filtered.map((item) => `
      <article class="saved-draft-card"
        data-project-id="${escapeHtml(item.projectId)}"
        data-item-id="${escapeHtml(item.id)}"
        data-item-type="${escapeHtml(item.type)}">
        <div>
          <small>${item.type === "snapshot" ? "SNAPSHOT" : "WEBSITE"}</small>
          <h3>${escapeHtml(item.name)}</h3>
          <p>${escapeHtml(formatDate(item.date))}</p>
        </div>
        <div class="saved-draft-actions">
          <button class="btn btn-primary btn-small" data-draft-action="load">Load</button>
          ${item.type === "project" ? `<button class="btn btn-secondary btn-small" data-draft-action="buyout">Buy Out</button>` : ""}
          ${item.type === "project" && item.owned ? `<button class="btn btn-secondary btn-small" data-draft-action="export">Download ZIP</button>` : ""}
        </div>
      </article>
    `).join("");

    if (!filtered.length) {
      grid.innerHTML = `<div class="empty-state">No saved drafts match this view.</div>`;
    }

    if ($("savedDraftCount")) $("savedDraftCount").textContent = filtered.length;
  }

  async function handleDraftAction(event) {
    const button = event.target.closest("[data-draft-action]");
    if (!button) return;

    const card = button.closest("[data-project-id]");
    const project = state.projects.find((item) => item.id === card?.dataset.projectId);
    if (!project) return;

    const actionName = button.dataset.draftAction;

    if (actionName === "load") {
      if (card.dataset.itemType === "snapshot") {
        const snapshot = project.snapshots.find((item) => item.id === card.dataset.itemId);
        if (snapshot) project.data = clone(snapshot.data);
      }
      state.activeProjectId = project.id;
      saveWorkspace();
      navigate("builder");
      toast("Draft loaded.", "success");
      return;
    }

    if (actionName === "buyout") {
      return startCheckout(project.plan || "starter", "buyout", project.id);
    }

    if (actionName === "export") {
      return exportProject(project.id);
    }
  }

  function renderPreview() {
    const project = readBuilderIntoProject();
    if (!project) return;

    const data = project.data;
    const preview = $("preview");
    if (!preview) return;

    setText("previewBusinessName", data.businessName || "YOUR BUSINESS");
    setText("previewTagline", data.headerTagline);
    setText("previewHeadline", data.headerHeadline || "Your headline appears here.");
    setText("previewBusinessBio", data.businessBio);
    setText("previewPhone", data.phoneNumber);
    setText("previewEmail", data.emailAddress);
    setText("previewHours", data.businessHours);
    setText("previewAddress", data.businessAddress);
    setText("previewAboutHeading", data.aboutHeading || "About Our Business");
    setText("previewFeaturedHeading", data.featuredHeading);
    setText("previewFeaturedDescription", data.featuredDescription);
    setText("previewGalleryHeading", data.galleryHeading);
    setText("previewGalleryDescription", data.galleryDescription);
    setText("previewMapHeading", data.mapHeading || "Find Us");
    setText("previewMapAddress", data.businessAddress);
    setText("previewFooter", data.businessName || "Your Business");

    const callText = trim(data.callButtonText) || "Call Now";
    const phone = String(data.phoneNumber || "").replace(/[^\d+]/g, "");
    ["previewCallButton", "previewHeroCall", "previewMapCall"].forEach((id) => {
      if ($(id)) {
        $(id).textContent = callText;
        $(id).href = phone ? `tel:${phone}` : "#";
      }
    });

    if ($("previewHeaderBios")) {
      $("previewHeaderBios").innerHTML = data.headerBio
        ? `<p class="hero-bio">${escapeHtml(data.headerBio)}</p>`
        : "";
    }

    setBackground($("previewHero"), data.headerImage);
    setBackground($("previewAboutSection"), data.aboutCover);
    setBackground($("previewFeaturedSection"), data.featuredCover);
    setBackground($("previewGallerySection"), data.galleryCover);
    setBackground($("previewMapSection"), data.mapCover);

    if ($("previewFeaturedCover")) {
      $("previewFeaturedCover").style.backgroundImage =
        data.featuredCover ? `url("${data.featuredCover}")` : "";
    }
    if ($("previewGalleryCover")) {
      $("previewGalleryCover").style.backgroundImage =
        data.galleryCover ? `url("${data.galleryCover}")` : "";
    }

    const logo = $("previewLogoImage");
    const frame = $("previewLogoFrame");
    if (logo) {
      logo.src = data.businessLogo || "";
      show(logo, Boolean(data.businessLogo));
    }
    show($("previewLogoPlaceholder"), !data.businessLogo);
    frame?.classList.toggle("has-logo", Boolean(data.businessLogo));

    preview.style.setProperty("--theme-color", data.themeColor);
    preview.style.setProperty("--header-color", data.headerColor);
    preview.style.setProperty("--button-color", data.buttonColor);
    preview.style.setProperty("--card-color", data.cardColor);
    preview.style.setProperty("--logo-outline-color", data.logoOutlineColor);

    if (frame) frame.style.borderColor = data.logoOutlineColor;

    if ($("previewScroll")) {
      $("previewScroll").innerHTML = String(data.scrollItems || "")
        .split(",")
        .map(trim)
        .filter(Boolean)
        .map((item) => `<span>${escapeHtml(item)}</span>`)
        .join("");
    }

    renderMedia("previewPhotoGrid", data.photos);
    renderMedia("previewGalleryGrid", data.gallery);
    setText("previewPhotoCount", `${data.photos.length} uploads`);
    setText("previewGalleryCount", `${data.gallery.length} uploads`);

    if ($("previewMapFrame")) {
      const mapValue = trim(data.mapEmbedUrl) || trim(data.businessAddress);
      $("previewMapFrame").src = mapValue
        ? `https://www.google.com/maps?q=${encodeURIComponent(mapValue)}&output=embed`
        : "about:blank";
    }

    if ($("builderProjectTitle")) {
      $("builderProjectTitle").textContent = data.businessName || project.name;
    }

    updateAddressPreview();
  }

  function setText(id, value) {
    if ($(id)) $(id).textContent = value || "";
  }

  function setBackground(element, url) {
    if (!element) return;
    element.style.backgroundImage = url
      ? `linear-gradient(rgba(0,0,0,.42),rgba(0,0,0,.42)),url("${url}")`
      : "";
    element.classList.toggle("has-cover", Boolean(url));
  }

  function renderMedia(id, items = []) {
    const grid = $(id);
    if (!grid) return;

    grid.innerHTML = items.map((item) => {
      const source = item.url || item.public_url || "";
      const media = String(item.type || item.mime_type || "").startsWith("video/")
        ? `<video src="${source}" controls preload="metadata"></video>`
        : `<img src="${source}" alt="${escapeHtml(item.description || "Website upload")}">`;

      return `
        <article class="${id === "previewGalleryGrid" ? "gallery-item" : "content-card"}">
          ${media}
          ${item.description ? `<div class="content-body"><p>${escapeHtml(item.description)}</p></div>` : ""}
        </article>`;
    }).join("");
  }

  function fileToDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(new Error("The selected file could not be read."));
      reader.readAsDataURL(file);
    });
  }

  async function uploadFile(file, project) {
    const dataUrl = await fileToDataUrl(file);

    if (!state.user || !state.apiOnline) {
      return {
        id: makeId(),
        url: dataUrl,
        type: file.type || "image/*",
        name: file.name,
        local: true
      };
    }

    if (String(project.id).startsWith("bv_")) {
      project = await saveProject(false);
    }

    const extension = file.name.includes(".")
      ? file.name.split(".").pop()
      : (file.type.split("/")[1] || "bin");

    const result = await api("media?action=upload", {
      method: "POST",
      body: JSON.stringify({
        project_id: project.id,
        filename: file.name,
        extension,
        data_url: dataUrl
      })
    });

    return {
      id: result.id || makeId(),
      url: result.url,
      type: result.mime_type || file.type,
      name: file.name,
      storage_path: result.path,
      local: false
    };
  }

  async function setSingleImage(inputId, key) {
    const input = $(inputId);
    const file = input?.files?.[0];
    if (!file) return;

    const maxSize = file.type.startsWith("video/") ? 25 : 8;
    if (file.size > maxSize * 1024 * 1024) {
      toast(`Please choose a file smaller than ${maxSize} MB.`, "error");
      input.value = "";
      return;
    }

    try {
      const uploaded = await uploadFile(file, activeProject());
      activeProject().data[key] = uploaded.url;
      input.value = "";
      await saveProject(false);
      renderPreview();
      toast("Image added.", "success");
    } catch (error) {
      toast(error.message, "error");
    }
  }

  async function removeImage(key) {
    activeProject().data[key] = "";
    await saveProject(false);
    renderPreview();
    toast("Image removed.", "success");
  }

  async function addMedia(collection, fileInputId, descriptionInputId) {
    const fileInput = $(fileInputId);
    const file = fileInput?.files?.[0];

    if (!file) return toast("Choose a photo or video first.", "error");

    const maxSize = file.type.startsWith("video/") ? 25 : 8;
    if (file.size > maxSize * 1024 * 1024) {
      return toast(`Please choose a file smaller than ${maxSize} MB.`, "error");
    }

    try {
      const uploaded = await uploadFile(file, activeProject());
      activeProject().data[collection].push({
        ...uploaded,
        description: trim($(descriptionInputId)?.value)
      });

      fileInput.value = "";
      if ($(descriptionInputId)) $(descriptionInputId).value = "";

      await saveProject(false);
      renderUploadEditors();
      renderPreview();
      toast("Upload added.", "success");
    } catch (error) {
      toast(error.message, "error");
    }
  }

  function renderUploadEditors() {
    renderEditorList("photoEditorList", "photos");
    renderEditorList("galleryEditorList", "gallery");
  }

  function renderEditorList(id, collection) {
    const list = $(id);
    if (!list) return;

    list.innerHTML = activeProject().data[collection].map((item) => `
      <div class="editor-list-item"
        data-collection="${collection}"
        data-media-id="${escapeHtml(item.id)}">
        <span>${String(item.type || "").startsWith("video/") ? "Video" : "Photo"}</span>
        <p>${escapeHtml(item.description || item.name || "Upload")}</p>
        <button class="btn btn-danger btn-small" type="button" data-remove-media>Remove</button>
      </div>
    `).join("");
  }

  async function removeMedia(event) {
    const button = event.target.closest("[data-remove-media]");
    if (!button) return;

    const row = button.closest("[data-media-id]");
    const collection = row.dataset.collection;
    const item = activeProject().data[collection]
      .find((media) => media.id === row.dataset.mediaId);

    if (item && state.user && state.apiOnline && !item.local && item.id) {
      try {
        await api(`media?action=delete&id=${encodeURIComponent(item.id)}`, {
          method: "DELETE"
        });
      } catch {
        // Continue removing it from the website even if storage cleanup fails.
      }
    }

    activeProject().data[collection] = activeProject().data[collection]
      .filter((media) => media.id !== row.dataset.mediaId);

    await saveProject(false);
    renderUploadEditors();
    renderPreview();
    toast("Upload removed.", "success");
  }

  function updateColorLabels() {
    ["themeColor", "headerColor", "buttonColor", "cardColor", "logoOutlineColor"]
      .forEach((id) => {
        if ($(`${id}Value`) && $(id)) {
          $(`${id}Value`).textContent = $(id).value;
        }
      });
  }

  function setupTabs() {
    $$("#tabs .tab").forEach((tab) => {
      tab.addEventListener("click", () => {
        $$("#tabs .tab").forEach((item) => item.classList.toggle("active", item === tab));
        $$(".sidebar .panel").forEach((panel) => {
          const active = panel.dataset.panel === tab.dataset.tab;
          panel.classList.toggle("active", active);
          panel.hidden = !active;
          panel.style.display = active ? "" : "none";
        });
      });
    });
  }

  function setupDevices() {
    $$(".device").forEach((button) => {
      button.addEventListener("click", () => {
        $$(".device").forEach((item) => item.classList.toggle("active", item === button));
        $("preview")?.classList.remove("desktop", "tablet", "mobile");
        $("preview")?.classList.add(button.dataset.device);
      });
    });
  }

  function setupThemes() {
    const presets = {
      blue: ["#1769ff", "#082b5e", "#1769ff", "#ffffff", "#61c7ff"],
      purple: ["#7c3aed", "#2e1065", "#7c3aed", "#ffffff", "#c4b5fd"],
      red: ["#dc2626", "#450a0a", "#dc2626", "#ffffff", "#fca5a5"],
      green: ["#059669", "#022c22", "#059669", "#ffffff", "#6ee7b7"],
      orange: ["#ea580c", "#431407", "#ea580c", "#ffffff", "#fdba74"]
    };

    $$(".theme-preset").forEach((button) => {
      button.addEventListener("click", () => {
        const colors = presets[button.dataset.theme];
        if (!colors) return;

        ["themeColor", "headerColor", "buttonColor", "cardColor", "logoOutlineColor"]
          .forEach((id, index) => {
            if ($(id)) $(id).value = colors[index];
          });

        $$(".theme-preset").forEach((item) =>
          item.classList.toggle("active", item === button)
        );

        updateColorLabels();
        renderPreview();
        queueSave();
      });
    });
  }

  function setupPreviewNavigation() {
    $("previewMenuToggle")?.addEventListener("click", () => {
      $("previewSiteNav")?.classList.toggle("open");
    });

    $$("[data-preview-target]").forEach((button) => {
      button.addEventListener("click", () => {
        $(button.dataset.previewTarget)?.scrollIntoView({
          behavior: "smooth",
          block: "start"
        });
        $("previewSiteNav")?.classList.remove("open");
      });
    });
  }

  function updateAddressPreview() {
    const project = activeProject();
    if (!project) return;

    const slug = slugify($("projectSlug")?.value || project.slug || project.name);
    const address = `${location.origin}/public-site.html?slug=${encodeURIComponent(slug)}`;

    if ($("projectSlug")) $("projectSlug").value = slug;
    if ($("subdomainPreview")) $("subdomainPreview").textContent = address;
    if ($("publishedAddress")) {
      $("publishedAddress").textContent =
        project.customDomain || project.custom_domain
          ? `https://${project.customDomain || project.custom_domain}`
          : address;
    }
  }

  async function checkAddress() {
    const slug = slugify($("projectSlug")?.value || $("dmSlugInput")?.value);

    if ($("projectSlug")) $("projectSlug").value = slug;
    if ($("dmSlugInput")) $("dmSlugInput").value = slug;

    activeProject().slug = slug;
    saveWorkspace();
    updateAddressPreview();

    if (!state.apiOnline) {
      return toast("Address format is valid locally.", "success");
    }

    try {
      const result = await api(
        `domains?action=check-slug&slug=${encodeURIComponent(slug)}`
      );
      toast(
        result.available ? "Address is available." : "That address is already in use.",
        result.available ? "success" : "error"
      );
    } catch (error) {
      toast(error.message, "error");
    }
  }

  async function connectDomain() {
    const project = await saveProject(false);
    const domain = normalizeDomain($("customDomain")?.value || $("dmDomainInput")?.value);

    if (!domain.includes(".")) {
      return toast("Enter a valid domain such as example.com.", "error");
    }
    if (!state.user) return openAuth("signin");
    if (!state.apiOnline) return toast("The API is not running.", "error");

    try {
      const result = await api("domains?action=connect", {
        method: "POST",
        body: JSON.stringify({
          project_id: project.id,
          domain
        })
      });

      replaceProject({
        ...project,
        ...(result.project || {}),
        customDomain: domain,
        custom_domain: domain
      });

      if ($("customDomain")) $("customDomain").value = domain;
      if ($("dmDomainInput")) $("dmDomainInput").value = domain;

      renderDomainPage();
      toast("Domain connected. Add the displayed DNS records.", "success");
    } catch (error) {
      toast(error.message, "error");
    }
  }

  async function verifyDomain() {
    const project = activeProject();
    if (!project?.customDomain && !project?.custom_domain) {
      return toast("Connect a custom domain first.", "error");
    }
    if (!state.apiOnline) return toast("The API is not running.", "error");

    try {
      const result = await api("domains?action=verify", {
        method: "POST",
        body: JSON.stringify({ project_id: project.id })
      });

      replaceProject({
        ...project,
        ...(result.project || {})
      });
      renderDomainPage();

      toast(
        result.verified ? "Domain verified." : "DNS is still propagating.",
        result.verified ? "success" : "info"
      );
    } catch (error) {
      toast(error.message, "error");
    }
  }

  async function removeDomain() {
    const project = activeProject();
    if (!project) return;

    if (state.user && state.apiOnline && !String(project.id).startsWith("bv_")) {
      try {
        await api("domains?action=remove", {
          method: "POST",
          body: JSON.stringify({ project_id: project.id })
        });
      } catch (error) {
        return toast(error.message, "error");
      }
    }

    project.customDomain = "";
    project.custom_domain = "";
    project.domain_status = "not_connected";
    project.ssl_status = "waiting";
    saveWorkspace();
    renderDomainPage();
    toast("Custom domain removed.", "success");
  }

  function renderDomainPage() {
    const project = activeProject();
    if (!project) return;

    const selects = [
      $("dmProjectSelect"),
      $("publishingCenterProjectSelect")
    ].filter(Boolean);

    selects.forEach((select) => {
      select.innerHTML = state.projects.map((item) => `
        <option value="${escapeHtml(item.id)}">
          ${escapeHtml(item.data.businessName || item.name)}
        </option>
      `).join("");
      select.value = project.id;
    });

    const publicAddress =
      project.published_url ||
      `${location.origin}/public-site.html?slug=${encodeURIComponent(project.slug)}`;
    const domain = project.customDomain || project.custom_domain || "";

    if ($("dmSlugInput")) $("dmSlugInput").value = project.slug;
    if ($("dmDomainInput")) $("dmDomainInput").value = domain;

    setText("dmOverviewBluvixa", project.slug ? "Reserved" : "Not reserved");
    setText("dmOverviewBluvixaDetail", publicAddress);
    setText("dmOverviewDomain", domain || "Not connected");
    setText(
      "dmOverviewDomainDetail",
      domain
        ? String(project.domain_status || "pending").replaceAll("_", " ")
        : "No custom domain"
    );
    setText("dmOverviewSsl", project.ssl_status || "waiting");
    setText("dmSideDomain", domain || "No custom domain");
    setText("dmDetailBluvixa", publicAddress);
    setText(
      "dmDetailDomainStatus",
      String(project.domain_status || "not_connected").replaceAll("_", " ")
    );
    setText("dmDetailDnsStatus", project.domain_status === "verified" ? "Verified" : "Pending");
    setText("dmDetailSslStatus", project.ssl_status || "waiting");
    setText("dmDetailVerifiedAt", project.domain_verified_at ? formatDate(project.domain_verified_at) : "—");
    setText("dmDetailLastChecked", project.domain_checked_at ? formatDate(project.domain_checked_at) : "—");

    if ($("dmBluvixaAddress")) {
      $("dmBluvixaAddress").textContent = publicAddress;
      $("dmBluvixaAddress").href = publicAddress;
    }

    setText("publishingCenterProjectName", project.data.businessName || project.name);
    setText("publishingStatusText", project.status || "draft");
    setText(
      "publishingCenterMessage",
      project.status === "published"
        ? "This website is live."
        : "This website has not been published yet."
    );
    setText("publishingMetricStatus", project.status || "draft");
    setText(
      "publishingMetricDate",
      project.published_at ? formatDate(project.published_at) : "Not published"
    );
    setText("publishingMetricDomain", domain || "Bluvixa address");
    setText("publishingMetricDomainDetail", domain || publicAddress);
    setText("publishingMetricSsl", project.ssl_status || "waiting");

    if ($("publishingShareUrl")) {
      $("publishingShareUrl").value =
        project.published_url || "Publish the website to create a public link";
    }
    if ($("publishingLiveUrl")) {
      $("publishingLiveUrl").textContent = project.published_url || "Not published";
      $("publishingLiveUrl").href = project.published_url || "#";
    }
    if ($("publishingViewLiveBtn")) {
      show($("publishingViewLiveBtn"), Boolean(project.published_url));
      $("publishingViewLiveBtn").href = project.published_url || "#";
    }
    if ($("publishingPrimaryBtn")) {
      $("publishingPrimaryBtn").textContent =
        project.status === "published" ? "Publish Updates" : "Publish Now";
    }
  }

  function renderBilling() {
    const plan = state.profile?.plan || "starter";
    const status = state.profile?.subscription_status || "inactive";

    ["accountPlan", "dashboardSubscriptionPlan", "mobileMemberPlan"].forEach((id) => {
      if ($(id)) $(id).textContent = plan.charAt(0).toUpperCase() + plan.slice(1);
    });

    ["accountBillingStatus", "dashboardSubscriptionStatus", "mobileMemberStatus"]
      .forEach((id) => {
        if ($(id)) $(id).textContent = status.replaceAll("_", " ");
      });

    if ($("trialHomeTitle")) {
      $("trialHomeTitle").textContent =
        status === "active"
          ? `${plan.charAt(0).toUpperCase() + plan.slice(1)} membership active`
          : "Choose a membership to publish";
    }
  }

  async function startCheckout(plan, type = "subscription", projectId = "") {
    if (!state.user) return openAuth("signin");
    if (!state.apiOnline) return toast("The API is not running.", "error");

    try {
      const result = await api(
        `billing?action=${type === "buyout" ? "buyout-checkout" : "subscription-checkout"}`,
        {
          method: "POST",
          body: JSON.stringify({
            plan,
            project_id: projectId || undefined,
            success_url: `${location.origin}/#${type === "buyout" ? "drafts" : "billing"}?checkout=success`,
            cancel_url: `${location.origin}/#billing?checkout=canceled`
          })
        }
      );

      if (!result.url) throw new Error("Stripe did not return a checkout URL.");
      location.assign(result.url);
    } catch (error) {
      toast(error.message, "error");
    }
  }

  async function manageBilling() {
    if (!state.user) return openAuth("signin");
    if (!state.apiOnline) return toast("The API is not running.", "error");

    try {
      const result = await api("billing?action=portal", {
        method: "POST",
        body: JSON.stringify({
          return_url: `${location.origin}/#billing`
        })
      });
      location.assign(result.url);
    } catch (error) {
      toast(error.message, "error");
    }
  }

  async function publishProject() {
    const project = await saveProject(false);

    if (!state.user) return openAuth("signin");
    if (!state.apiOnline) return toast("The API is not running.", "error");

    const button = $("publishingPrimaryBtn") || $("publishBtn");
    setBusy(button, true, "Publishing…");

    try {
      const result = await api("publish?action=publish", {
        method: "POST",
        body: JSON.stringify({ project_id: project.id })
      });

      replaceProject(result.project || {
        ...project,
        status: "published",
        published_url: result.url,
        published_at: now()
      });

      renderDomainPage();
      toast("Website published successfully.", "success");
    } catch (error) {
      toast(error.message, "error");
    } finally {
      setBusy(button, false);
    }
  }

  async function exportProject(projectId) {
    if (!state.user) return openAuth("signin");
    if (!state.apiOnline) return toast("The API is not running.", "error");

    try {
      const response = await fetch(
        `${API_BASE}/export?project_id=${encodeURIComponent(projectId)}`,
        {
          headers: {
            Authorization: `Bearer ${state.session.access_token}`
          }
        }
      );

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error || "Export failed.");
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${slugify(activeProject()?.name || "website")}.zip`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      toast(error.message, "error");
    }
  }

  function copyPublishedLink() {
    const url = activeProject()?.published_url;
    if (!url) return toast("Publish this website first.", "error");

    navigator.clipboard
      ?.writeText(url)
      .then(() => toast("Website link copied.", "success"))
      .catch(() => toast("Copy failed.", "error"));
  }

  async function sharePublishedSite() {
    const project = activeProject();
    const url = project?.published_url;
    if (!url) return toast("Publish this website first.", "error");

    if (navigator.share) {
      try {
        await navigator.share({
          title: project.data.businessName || project.name,
          url
        });
      } catch {}
    } else {
      copyPublishedLink();
    }
  }

  function resetBuilder() {
    if (!confirm("Reset this website to a blank design?")) return;

    const project = activeProject();
    project.data = clone(DEFAULT_DATA);
    project.name = "Untitled Website";
    project.slug = "my-website";
    project.customDomain = "";
    project.custom_domain = "";
    project.updatedAt = now();

    saveWorkspace();
    loadProjectIntoBuilder(project);
    renderPreview();
    queueSave();
    toast("Builder reset.", "success");
  }

  function setupEvents() {
    window.addEventListener("hashchange", renderRoute);

    $("mobileMenuButton")?.addEventListener("click", () => {
      const menu = $("mobileMenu");
      show(menu, menu?.classList.contains("hidden"));
    });

    ["signInBtn", "mobileSignInBtn"].forEach((id) => {
      $(id)?.addEventListener("click", () => openAuth("signin"));
    });

    ["startTrialBtn", "mobileStartTrialBtn", "landingStartBtn"].forEach((id) => {
      $(id)?.addEventListener("click", () => openAuth("signup"));
    });

    $("closeAuthBtn")?.addEventListener("click", closeAuth);
    $("showSignInTab")?.addEventListener("click", () => openAuth("signin"));
    $("showSignUpTab")?.addEventListener("click", () => openAuth("signup"));
    $("authForm")?.addEventListener("submit", submitAuth);
    $("forgotPasswordBtn")?.addEventListener("click", forgotPassword);

    $("authModal")?.addEventListener("click", (event) => {
      if (event.target === $("authModal")) closeAuth();
    });

    ["signOutBtn", "mobileSignOutBtn", "accountSignOutBtn"].forEach((id) => {
      $(id)?.addEventListener("click", signOut);
    });

    $("accountNavLink")?.addEventListener("click", () => navigate("projects"));

    ["createWebsiteBtn", "createWebsiteFromDraftsBtn"].forEach((id) => {
      $(id)?.addEventListener("click", createProject);
    });

    $("websiteLibraryGrid")?.addEventListener("click", handleProjectAction);
    $("projectSearchInput")?.addEventListener("input", renderProjects);

    $("savedDraftsGrid")?.addEventListener("click", handleDraftAction);
    $("draftSearchInput")?.addEventListener("input", renderDrafts);

    $$("[data-draft-filter]").forEach((button) => {
      button.addEventListener("click", () => {
        state.draftFilter = button.dataset.draftFilter;
        $$("[data-draft-filter]").forEach((item) =>
          item.classList.toggle("active", item === button)
        );
        renderDrafts();
      });
    });

    ["saveWebsiteProjectBtn", "saveBtn"].forEach((id) => {
      $(id)?.addEventListener("click", () => saveProject(true));
    });

    ["saveSnapshotTopBtn", "saveCurrentDraftBtn"].forEach((id) => {
      $(id)?.addEventListener("click", saveSnapshot);
    });

    $("loadDraftBtn")?.addEventListener("click", () => navigate("drafts"));
    $("resetBtn")?.addEventListener("click", resetBuilder);

    Object.values(formMap).forEach((id) => {
      $(id)?.addEventListener("input", () => {
        updateColorLabels();
        renderPreview();
        queueSave();
      });
      $(id)?.addEventListener("change", () => {
        updateColorLabels();
        renderPreview();
        queueSave();
      });
    });

    $("projectSlug")?.addEventListener("input", updateAddressPreview);

    [
      ["headerImage", "headerImage"],
      ["businessLogo", "businessLogo"],
      ["aboutCoverFile", "aboutCover"],
      ["featuredCoverFile", "featuredCover"],
      ["galleryCoverFile", "galleryCover"],
      ["mapCoverFile", "mapCover"]
    ].forEach(([input, key]) => {
      $(input)?.addEventListener("change", () => setSingleImage(input, key));
    });

    $("removeLogoBtn")?.addEventListener("click", () => removeImage("businessLogo"));
    $("removeAboutCoverBtn")?.addEventListener("click", () => removeImage("aboutCover"));
    $("removeFeaturedCoverBtn")?.addEventListener("click", () => removeImage("featuredCover"));
    $("removeGalleryCoverBtn")?.addEventListener("click", () => removeImage("galleryCover"));
    $("removeMapCoverBtn")?.addEventListener("click", () => removeImage("mapCover"));

    $("addPhotoBtn")?.addEventListener("click", () => {
      addMedia("photos", "photoFile", "photoDescription");
    });

    $("addGalleryBtn")?.addEventListener("click", () => {
      addMedia("gallery", "galleryFile", "galleryUploadDescription");
    });

    $("photoEditorList")?.addEventListener("click", removeMedia);
    $("galleryEditorList")?.addEventListener("click", removeMedia);

    $("domainModeSubdomain")?.addEventListener("change", () => {
      show($("subdomainSettings"), true);
      show($("customDomainSettings"), false);
    });

    $("domainModeCustom")?.addEventListener("change", () => {
      show($("subdomainSettings"), false);
      show($("customDomainSettings"), true);
    });

    ["checkSubdomainBtn", "dmCheckSlugBtn", "dmReserveSlugBtn"].forEach((id) => {
      $(id)?.addEventListener("click", checkAddress);
    });

    ["connectDomainBtn", "dmConnectBtn"].forEach((id) => {
      $(id)?.addEventListener("click", connectDomain);
    });

    ["verifyDomainBtn", "dmVerifyBtn", "dmRetryBtn", "dmRefreshAllBtn"].forEach((id) => {
      $(id)?.addEventListener("click", verifyDomain);
    });

    $("dmRemoveBtn")?.addEventListener("click", removeDomain);

    ["dmProjectSelect", "publishingCenterProjectSelect"].forEach((id) => {
      $(id)?.addEventListener("change", (event) => {
        state.activeProjectId = event.target.value;
        saveWorkspace();
        renderDomainPage();
      });
    });

    $$(".pricingTrial,.memberPlanCheckout").forEach((button) => {
      button.addEventListener("click", () =>
        startCheckout(button.dataset.plan || "starter", "subscription")
      );
    });

    $("annualCheckoutBtn")?.addEventListener("click", () =>
      startCheckout($("planSelect")?.value || "starter", "subscription")
    );

    $("buyoutBtn")?.addEventListener("click", () =>
      startCheckout(
        $("planSelect")?.value || activeProject()?.plan || "starter",
        "buyout",
        activeProject()?.id
      )
    );

    $("manageBillingBtn")?.addEventListener("click", manageBilling);

    ["publishBtn", "publishingPrimaryBtn"].forEach((id) => {
      $(id)?.addEventListener("click", publishProject);
    });

    $("copyPublishedLinkBtn")?.addEventListener("click", copyPublishedLink);
    $("sharePublishedSiteBtn")?.addEventListener("click", sharePublishedSite);
    $("openDomainForPublishingBtn")?.addEventListener("click", () => navigate("domains"));

    $("refreshJsonBtn")?.addEventListener("click", () => {
      if ($("backendJson")) {
        $("backendJson").textContent = JSON.stringify({
          apiOnline: state.apiOnline,
          signedIn: Boolean(state.user),
          user: state.user?.email || null,
          plan: state.profile?.plan || null,
          projectCount: state.projects.length,
          activeProjectId: state.activeProjectId
        }, null, 2);
      }
    });

    $("closeBackendBtn")?.addEventListener("click", () =>
      show($("backendModal"), false)
    );

    setupTabs();
    setupDevices();
    setupThemes();
    setupPreviewNavigation();
  }

  async function init() {
    try {
      restoreCachedSession();
      loadWorkspace();
      setupEvents();

      show($("sessionLoadingScreen"), false);
      renderAuthState();
      renderProjects();
      renderDrafts();
      loadProjectIntoBuilder(activeProject());
      renderPreview();
      renderDomainPage();
      renderRoute();

      await detectApi();

      if (state.session?.access_token && state.apiOnline) {
        try {
          const sessionResult = await api("auth?action=session");
          state.user = sessionResult.user || state.user;
          renderAuthState();
          await loadProfile();
          await loadCloudProjects();
        } catch {
          saveSession(null);
        }
      }

      const parameters = new URLSearchParams(
        location.hash.includes("?")
          ? location.hash.split("?")[1]
          : location.search
      );

      if (parameters.get("checkout") === "success") {
        toast("Payment completed. Refreshing your account status.", "success");
        await loadProfile();
        await loadCloudProjects();
      }
    } catch (error) {
      console.error("Bluvixa startup error:", error);
      show($("sessionLoadingScreen"), false);
      renderRoute();
      toast(`Startup error: ${error.message}`, "error");
    }
  }

  window.Bluvixa = {
    api,
    saveProject,
    publishProject,
    loadCloudProjects,
    getState: () => clone({
      apiOnline: state.apiOnline,
      user: state.user,
      profile: state.profile,
      projects: state.projects,
      activeProjectId: state.activeProjectId
    })
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();