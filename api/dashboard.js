(function () {
  "use strict";

  var SNAPSHOTS_KEY = "bluvixa_saved_drafts_v3";
  var ACTIVE_PROJECT_KEY = "bluvixa_active_project_id";
  var draftFilter = "all";
  var projectCache = [];
  var accountCache = null;
  var loadingProjects = false;

  var API = {
    accountStatus: "/api/account-status",
    projects: "/api/projects",
    saveProject: "/api/projects/save",
    deleteProject: "/api/projects/delete"
  };

  function byId(id) {
    return document.getElementById(id);
  }

  function qa(selector) {
    return Array.prototype.slice.call(document.querySelectorAll(selector));
  }

  function toast(message) {
    var node = byId("toast");

    if (!node) {
      window.alert(message);
      return;
    }

    node.textContent = message;
    node.classList.add("show");

    window.clearTimeout(toast.timer);

    toast.timer = window.setTimeout(function () {
      node.classList.remove("show");
    }, 2700);
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (character) {
      return {
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
      }[character];
    });
  }

  function readJson(key, fallback) {
    try {
      var value = JSON.parse(localStorage.getItem(key) || "null");
      return value == null ? fallback : value;
    } catch (_error) {
      return fallback;
    }
  }

  function writeJson(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function snapshots() {
    var value = readJson(SNAPSHOTS_KEY, []);
    return Array.isArray(value) ? value : [];
  }

  function activeProjectId() {
    return localStorage.getItem(ACTIVE_PROJECT_KEY) || "";
  }

  function setActiveProjectId(id) {
    localStorage.setItem(ACTIVE_PROJECT_KEY, id || "");
  }

  function currentBuilderState() {
    try {
      return typeof window.bluvixaExportState === "function"
        ? window.bluvixaExportState()
        : null;
    } catch (_error) {
      return null;
    }
  }

  function formatDate(value) {
    var date = new Date(value);

    return Number.isNaN(date.getTime())
      ? "Unknown"
      : date.toLocaleString("en-US", {
          month: "short",
          day: "numeric",
          year: "numeric",
          hour: "numeric",
          minute: "2-digit"
        });
  }

  function planName(value) {
    return String(value || "professional").replace(/\b\w/g, function (character) {
      return character.toUpperCase();
    });
  }

  function sanitizeSlug(value) {
    return (
      String(value || "website")
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 48) || "website"
    );
  }

  function buyoutPrice(plan) {
    return {
      starter: 499,
      professional: 599,
      advanced: 699
    }[String(plan || "professional").toLowerCase()] || 599;
  }

  function cleanDomain(value) {
    return String(value || "")
      .trim()
      .toLowerCase()
      .replace(/^https?:\/\//, "")
      .replace(/\/.*$/, "")
      .replace(/\.$/, "");
  }

  function projectUrl(project) {
    if (!project || typeof project !== "object") {
      return "";
    }

    var customDomain = cleanDomain(project.custom_domain);

    if (customDomain) {
      return "https://" + customDomain;
    }

    if (project.published_url) {
      return String(project.published_url);
    }

    var slug = project.slug || sanitizeSlug(project.name || "website");
    return "https://bluvixa.com/site/" + slug;
  }

  function normalizeProject(raw) {
    raw = raw && typeof raw === "object" ? raw : {};

    return {
      id: String(raw.id || ""),
      user_id: raw.user_id || null,
      name: String(raw.name || "Untitled Website"),
      slug: String(raw.slug || ""),
      plan: String(raw.plan || "professional").toLowerCase(),
      project_data:
        raw.project_data && typeof raw.project_data === "object"
          ? raw.project_data
          : {},
      published: raw.published === true,
      published_url: raw.published_url || null,
      custom_domain: raw.custom_domain || null,
      domain_status: raw.domain_status || "not_connected",
      ssl_status: raw.ssl_status || "waiting",
      verified_at: raw.verified_at || null,
      dns_verified: raw.dns_verified === true,
      domain_last_checked_at: raw.domain_last_checked_at || null,
      domain_error: raw.domain_error || null,
      dns_records: Array.isArray(raw.dns_records) ? raw.dns_records : [],
      verification_record:
        raw.verification_record && typeof raw.verification_record === "object"
          ? raw.verification_record
          : null,
      created_at: raw.created_at || new Date().toISOString(),
      updated_at: raw.updated_at || raw.created_at || new Date().toISOString()
    };
  }

  function projectState(project) {
    var state = clone(project.project_data || {});

    state.plan = project.plan || state.plan || "professional";

    state.project = Object.assign({}, state.project || {}, {
      slug: project.slug || "",
      domainMode: project.custom_domain ? "custom" : "subdomain",
      customDomain: project.custom_domain || "",
      domainStatus: project.domain_status || "not_connected",
      sslStatus: project.ssl_status || "waiting",
      dnsVerified: project.dns_verified === true,
      dnsRecords: clone(project.dns_records || []),
      verificationRecord: project.verification_record
        ? clone(project.verification_record)
        : null
    });

    state.backend = Object.assign({}, state.backend || {}, {
      userId: project.user_id || null,
      websiteId: project.id,
      published: project.published === true,
      publishedUrl: project.published_url || null,
      updatedAt: project.updated_at || null
    });

    return state;
  }

  async function getAccessToken() {
    if (
      window.BluvixaMVP &&
      typeof window.BluvixaMVP.getAccessToken === "function"
    ) {
      return (await window.BluvixaMVP.getAccessToken()) || "";
    }

    if (
      window.supabaseClient &&
      window.supabaseClient.auth &&
      typeof window.supabaseClient.auth.getSession === "function"
    ) {
      var result = await window.supabaseClient.auth.getSession();
      return result?.data?.session?.access_token || "";
    }

    if (
      window.supabase &&
      window.supabase.auth &&
      typeof window.supabase.auth.getSession === "function"
    ) {
      var fallbackResult = await window.supabase.auth.getSession();
      return fallbackResult?.data?.session?.access_token || "";
    }

    return "";
  }

  async function apiRequest(url, options) {
    options = options || {};

    var token = await getAccessToken();
    var headers = Object.assign(
      {
        Accept: "application/json"
      },
      options.headers || {}
    );

    if (options.body !== undefined && !headers["Content-Type"]) {
      headers["Content-Type"] = "application/json; charset=utf-8";
    }

    if (token) {
      headers.Authorization = "Bearer " + token;
    }

    var response = await fetch(url, {
      method: options.method || "GET",
      headers: headers,
      body:
        options.body === undefined
          ? undefined
          : typeof options.body === "string"
            ? options.body
            : JSON.stringify(options.body),
      cache: "no-store"
    });

    var payload = null;

    try {
      payload = await response.json();
    } catch (_error) {
      payload = null;
    }

    if (!response.ok) {
      var error = new Error(
        payload?.error ||
          payload?.message ||
          "The request could not be completed."
      );

      error.status = response.status;
      error.payload = payload;
      throw error;
    }

    return payload || {};
  }

  async function loadAccountStatus(force) {
    if (accountCache && !force) {
      return accountCache;
    }

    try {
      accountCache = await apiRequest(API.accountStatus);
      return accountCache;
    } catch (error) {
      if (error.status === 401) {
        accountCache = {
          signedIn: false,
          subscribed: false,
          websiteBoughtOut: false
        };

        return accountCache;
      }

      throw error;
    }
  }

  async function loadProjects(force) {
    if (loadingProjects && !force) {
      return projectCache;
    }

    loadingProjects = true;

    try {
      var payload = await apiRequest(API.projects);
      var rows = Array.isArray(payload)
        ? payload
        : Array.isArray(payload.projects)
          ? payload.projects
          : [];

      projectCache = rows.map(normalizeProject);
      return projectCache;
    } finally {
      loadingProjects = false;
    }
  }

  function findProject(id) {
    return projectCache.find(function (project) {
      return project.id === id;
    }) || null;
  }

  async function saveProjectRequest(projectId, state, nameOverride) {
    var normalizedState = clone(state || {});
    var existing = projectId ? findProject(projectId) : null;

    var businessName =
      normalizedState.business && normalizedState.business.name
        ? String(normalizedState.business.name).trim()
        : "";

    var name =
      String(
        nameOverride ||
          (businessName ? businessName + " Website" : "") ||
          existing?.name ||
          "Untitled Website"
      ).trim() || "Untitled Website";

    var slug =
      String(normalizedState.project?.slug || existing?.slug || "").trim() ||
      sanitizeSlug(name);

    var plan =
      String(normalizedState.plan || existing?.plan || "professional")
        .trim()
        .toLowerCase();

    var payload = await apiRequest(API.saveProject, {
      method: "POST",
      body: {
        projectId: projectId || null,
        name: name,
        slug: slug,
        plan: plan,
        projectData: normalizedState
      }
    });

    var saved = normalizeProject(payload.project || payload.data || payload);

    if (!saved.id) {
      throw new Error("The project was saved, but no project ID was returned.");
    }

    var index = projectCache.findIndex(function (project) {
      return project.id === saved.id;
    });

    if (index >= 0) {
      projectCache[index] = saved;
    } else {
      projectCache.unshift(saved);
    }

    setActiveProjectId(saved.id);
    notifyProjectsUpdated(saved.id);

    return saved;
  }

  async function createProject(name, state) {
    var base = state ? clone(state) : currentBuilderState();

    if (!base) {
      toast("The builder is still loading.");
      return null;
    }

    try {
      var project = await saveProjectRequest(null, base, name);
      renderAll();
      return project;
    } catch (error) {
      console.error("Create project error:", error);
      toast(error.message || "The website could not be created.");
      return null;
    }
  }

  async function saveActiveProject(showMessage) {
    var state = currentBuilderState();

    if (!state) {
      toast("The builder is still loading.");
      return null;
    }

    try {
      var project = await saveProjectRequest(
        activeProjectId() || null,
        state,
        null
      );

      if (showMessage) {
        toast("Website saved.");
      }

      renderAll();
      updateBuilderHeading(project);

      return project;
    } catch (error) {
      console.error("Save project error:", error);
      toast(error.message || "The website could not be saved.");
      return null;
    }
  }

  async function newWebsite() {
    var state = currentBuilderState();

    if (!state) {
      toast("The builder is still loading.");
      return;
    }

    var blank = clone(state);

    blank.business = {
      name: "",
      bio: "",
      phone: "",
      email: "",
      hours: "",
      address: "",
      callText: ""
    };

    blank.header = {
      tagline: "",
      headline: "",
      image: "",
      bio: ""
    };

    blank.photos = [];
    blank.gallery = [];
    blank.mapUrl = "";

    blank.project = {
      slug: "",
      domainMode: "subdomain",
      customDomain: "",
      domainStatus: "not_connected",
      sslStatus: "waiting",
      dnsVerified: false,
      dnsRecords: [],
      verificationRecord: null
    };

    blank.backend = {
      userId: null,
      websiteId: null,
      published: false,
      publishedUrl: null,
      updatedAt: null
    };

    var project = await createProject("Untitled Website", blank);

    if (
      project &&
      typeof window.bluvixaImportState === "function"
    ) {
      window.bluvixaImportState(projectState(project));
      updateBuilderHeading(project);
      location.hash = "#builder";
      toast("New website created.");
    }
  }

  function loadProject(id) {
    var project = findProject(id);

    if (!project) {
      toast("That website was not found.");
      return;
    }

    setActiveProjectId(project.id);

    if (typeof window.bluvixaImportState === "function") {
      window.bluvixaImportState(projectState(project));
      updateBuilderHeading(project);
      location.hash = "#builder";
      toast(project.name + " loaded.");
    }
  }

  async function duplicateProject(id) {
    var source = findProject(id);

    if (!source) {
      toast("That website was not found.");
      return;
    }

    var duplicateState = projectState(source);

    duplicateState.project = Object.assign({}, duplicateState.project || {}, {
      slug: ""
    });

    duplicateState.backend = Object.assign({}, duplicateState.backend || {}, {
      userId: null,
      websiteId: null,
      published: false,
      publishedUrl: null,
      updatedAt: null
    });

    try {
      var copy = await saveProjectRequest(
        null,
        duplicateState,
        source.name + " Copy"
      );

      if (copy) {
        toast("Website duplicated.");
        renderAll();
      }
    } catch (error) {
      console.error("Duplicate project error:", error);
      toast(error.message || "The website could not be duplicated.");
    }
  }

  async function deleteProject(id) {
    var project = findProject(id);

    if (!project) {
      toast("That website was not found.");
      return;
    }

    if (
      !window.confirm(
        'Delete "' + project.name + '"? This cannot be undone.'
      )
    ) {
      return;
    }

    try {
      await apiRequest(API.deleteProject, {
        method: "POST",
        body: {
          projectId: id
        }
      });

      projectCache = projectCache.filter(function (item) {
        return item.id !== id;
      });

      if (activeProjectId() === id) {
        setActiveProjectId("");
      }

      renderAll();
      notifyProjectsUpdated(id);
      toast("Website deleted.");
    } catch (error) {
      console.error("Delete project error:", error);
      toast(error.message || "The website could not be deleted.");
    }
  }

  function saveSnapshot() {
    var state = currentBuilderState();

    if (!state) {
      toast("The builder is still loading.");
      return;
    }

    var project = findProject(activeProjectId());
    var now = new Date().toISOString();

    var item = {
      id: "snap_" + Date.now() + "_" + Math.random().toString(16).slice(2),
      projectId: project ? project.id : "",
      name: project
        ? project.name + " Snapshot"
        : ((state.business && state.business.name) || "Untitled") + " Snapshot",
      plan: state.plan || project?.plan || "professional",
      savedAt: now,
      state: clone(state)
    };

    var items = snapshots();
    items.unshift(item);
    writeJson(SNAPSHOTS_KEY, items.slice(0, 60));

    toast("Snapshot saved.");
    renderAll();
  }

  function loadSnapshot(id) {
    var item = snapshots().find(function (entry) {
      return entry.id === id;
    });

    if (!item) {
      toast("That snapshot was not found.");
      return;
    }

    if (typeof window.bluvixaImportState === "function") {
      setActiveProjectId(item.projectId || "");
      window.bluvixaImportState(clone(item.state));
      location.hash = "#builder";
      toast("Snapshot loaded.");
    }
  }

  function deleteSnapshot(id) {
    writeJson(
      SNAPSHOTS_KEY,
      snapshots().filter(function (item) {
        return item.id !== id;
      })
    );

    renderAll();
    toast("Snapshot deleted.");
  }

  function buyoutProject(id) {
    var project = findProject(id);

    if (!project) {
      toast("That website was not found.");
      return;
    }

    setActiveProjectId(project.id);

    if (
      window.BluvixaMVP &&
      typeof window.BluvixaMVP.checkout === "function"
    ) {
      window.BluvixaMVP.checkout(
        project.plan || "professional",
        "buyout",
        project.id
      );
      return;
    }

    toast("The checkout system is not connected yet.");
  }

  async function exportProject(id) {
    var project = findProject(id);

    if (!project) {
      toast("That website was not found.");
      return;
    }

    var account;

    try {
      account = await loadAccountStatus(true);
    } catch (error) {
      console.error("Account status error:", error);
      toast(error.message || "Ownership could not be verified.");
      return;
    }

    if (account.websiteBoughtOut !== true) {
      toast("Buy out this website before exporting it.");
      return;
    }

    if (
      window.BluvixaMVP &&
      typeof window.BluvixaMVP.exportWebsite === "function"
    ) {
      window.BluvixaMVP.exportWebsite(project.id);
      return;
    }

    toast("The export API is not connected yet.");
  }

  function websiteCard(project) {
    var url = projectUrl(project);
    var accountOwned = accountCache?.websiteBoughtOut === true;

    var accent =
      project.plan === "advanced"
        ? "#673ab7"
        : project.plan === "starter"
          ? "#226d88"
          : "#245f9e";

    var statusClass = accountOwned
      ? "owned"
      : project.published
        ? "published"
        : "";

    var statusText = accountOwned
      ? "Owned"
      : project.published
        ? "Published"
        : "Draft";

    return (
      '<article class="website-project-card" data-project-id="' +
      escapeHtml(project.id) +
      '">' +
      '<div class="website-project-preview" style="--project-accent:' +
      accent +
      '"><div><strong>' +
      escapeHtml(project.name) +
      "</strong><small>" +
      escapeHtml(url) +
      "</small></div></div>" +
      '<div class="website-project-body">' +
      '<div class="project-meta-row"><strong>' +
      escapeHtml(planName(project.plan)) +
      '</strong><span class="project-status ' +
      statusClass +
      '">' +
      statusText +
      "</span></div>" +
      '<div class="project-meta"><div><span>UPDATED</span><strong>' +
      escapeHtml(formatDate(project.updated_at)) +
      '</strong></div><div><span>OWNERSHIP</span><strong>' +
      (accountOwned ? "Purchased" : "Subscription") +
      "</strong></div></div>" +
      '<div class="project-actions">' +
      '<button class="btn btn-primary" data-project-load="' +
      escapeHtml(project.id) +
      '">Edit</button>' +
      '<button class="btn btn-secondary" data-project-duplicate="' +
      escapeHtml(project.id) +
      '">Duplicate</button>' +
      '<button class="btn btn-secondary" data-project-drafts="' +
      escapeHtml(project.id) +
      '">Drafts</button>' +
      '<button class="btn btn-danger" data-project-delete="' +
      escapeHtml(project.id) +
      '">Delete</button>' +
      "</div></div></article>"
    );
  }

  function renderProjects() {
    var grid = byId("websiteLibraryGrid");

    if (!grid) {
      return;
    }

    var query = (
      byId("projectSearchInput")
        ? byId("projectSearchInput").value
        : ""
    )
      .trim()
      .toLowerCase();

    var items = projectCache.filter(function (item) {
      return (
        !query ||
        item.name.toLowerCase().indexOf(query) >= 0 ||
        projectUrl(item).toLowerCase().indexOf(query) >= 0
      );
    });

    if (byId("projectCount")) {
      byId("projectCount").textContent = String(projectCache.length);
    }

    if (byId("publishedProjectCount")) {
      byId("publishedProjectCount").textContent = String(
        projectCache.filter(function (project) {
          return project.published;
        }).length
      );
    }

    if (byId("draftProjectCount")) {
      byId("draftProjectCount").textContent = String(
        projectCache.filter(function (project) {
          return !project.published;
        }).length
      );
    }

    grid.innerHTML = items.length
      ? items.map(websiteCard).join("")
      : '<div class="empty-state">No websites yet. Select “Create New Website” to begin.</div>';
  }

  function draftCard(item, type) {
    var project =
      type === "project"
        ? item
        : findProject(item.projectId);

    var owned = accountCache?.websiteBoughtOut === true;

    var status =
      type === "project"
        ? item.published
          ? "Published website"
          : "Incomplete website"
        : "Saved snapshot";

    var itemId = escapeHtml(item.id);

    return (
      '<article class="draft-card ' +
      (type === "project" ? "project-draft" : "snapshot-draft") +
      '">' +
      '<div class="draft-thumb"><strong>' +
      escapeHtml(item.name) +
      "</strong></div>" +
      '<div class="draft-card-body"><span class="draft-type-label">' +
      (type === "project" ? "WEBSITE PROJECT" : "SNAPSHOT") +
      "</span>" +
      "<strong>" +
      escapeHtml(status) +
      "</strong><small>" +
      escapeHtml(
        formatDate(
          type === "project"
            ? item.updated_at
            : item.savedAt
        )
      ) +
      "</small>" +
      '<div class="draft-ownership-row"><small>' +
      (owned ? "Website owned" : "Buyout $" + buyoutPrice(item.plan)) +
      '</small><span class="project-status ' +
      (owned ? "owned" : "") +
      '">' +
      (owned ? "Export unlocked" : "Export locked") +
      "</span></div>" +
      '<div class="draft-card-actions">' +
      '<button class="btn btn-primary btn-small" data-' +
      (type === "project" ? "project-load" : "snapshot-load") +
      '="' +
      itemId +
      '">Load</button>' +
      (type === "project"
        ? '<button class="btn btn-secondary btn-small" data-project-duplicate="' +
          itemId +
          '">Duplicate</button>' +
          (owned
            ? '<button class="btn btn-primary btn-small" data-project-export="' +
              itemId +
              '">Export ZIP</button>'
            : '<button class="btn btn-secondary btn-small" data-project-buyout="' +
              itemId +
              '">Buy Out $' +
              buyoutPrice(item.plan) +
              "</button>")
        : '<button class="btn btn-secondary btn-small" data-snapshot-delete="' +
          itemId +
          '">Delete</button>') +
      "</div></div></article>"
    );
  }

  function renderDrafts() {
    var grid = byId("savedDraftsGrid");

    if (!grid) {
      return;
    }

    var query = (
      byId("draftSearchInput")
        ? byId("draftSearchInput").value
        : ""
    )
      .trim()
      .toLowerCase();

    var entries = [];

    projectCache.forEach(function (item) {
      var incomplete = !item.published;

      if (
        draftFilter === "all" ||
        draftFilter === "project" ||
        (draftFilter === "incomplete" && incomplete)
      ) {
        entries.push({
          item: item,
          type: "project",
          date: item.updated_at
        });
      }
    });

    if (draftFilter === "all" || draftFilter === "snapshot") {
      snapshots().forEach(function (item) {
        entries.push({
          item: item,
          type: "snapshot",
          date: item.savedAt
        });
      });
    }

    entries = entries.filter(function (entry) {
      return (
        !query ||
        entry.item.name.toLowerCase().indexOf(query) >= 0
      );
    });

    entries.sort(function (a, b) {
      return new Date(b.date) - new Date(a.date);
    });

    if (byId("savedDraftCount")) {
      byId("savedDraftCount").textContent = String(entries.length);
    }

    grid.innerHTML = entries.length
      ? entries
          .map(function (entry) {
            return draftCard(entry.item, entry.type);
          })
          .join("")
      : '<div class="empty-state">No matching drafts or websites.</div>';
  }

  function updateBuilderHeading(project) {
    if (byId("builderProjectTitle")) {
      byId("builderProjectTitle").textContent = project
        ? project.name
        : "Build your website";
    }

    if (byId("builderProjectSubtitle")) {
      byId("builderProjectSubtitle").textContent = project
        ? "Editing website project · " +
          planName(project.plan) +
          " plan"
        : "Create or load a website project.";
    }
  }

  function notifyProjectsUpdated(projectId) {
    window.dispatchEvent(
      new CustomEvent("bluvixa:projects-updated", {
        detail: {
          projectId: projectId || activeProjectId() || ""
        }
      })
    );
  }

  function renderAll() {
    renderProjects();
    renderDrafts();
  }

  function currentRoute() {
    var route = (location.hash || "#home")
      .slice(1)
      .split("?")[0];

    return [
      "home",
      "projects",
      "drafts",
      "builder",
      "billing",
      "domains",
      "pricing"
    ].indexOf(route) >= 0
      ? route
      : "home";
  }

  async function route() {
    var name = currentRoute();
    var authenticated =
      document.body.classList.contains("member-authenticated");

    if (authenticated && name === "home") {
      name = "projects";
    }

    if (
      !authenticated &&
      ["projects", "drafts", "billing", "domains"].indexOf(name) >= 0
    ) {
      name = "home";
    }

    qa(".app-page").forEach(function (page) {
      page.classList.toggle(
        "route-active",
        page.dataset.page === name
      );
    });

    qa("[data-route-link]").forEach(function (link) {
      link.classList.toggle(
        "active",
        link.dataset.routeLink === name
      );
    });

    document.body.className =
      (authenticated ? "member-authenticated " : "") +
      "route-" +
      name;

    window.scrollTo(0, 0);

    if (
      authenticated &&
      (name === "projects" ||
        name === "drafts" ||
        name === "builder" ||
        name === "domains")
    ) {
      try {
        await Promise.all([
          loadProjects(true),
          loadAccountStatus(true)
        ]);

        renderAll();
      } catch (error) {
        console.error("Workspace load error:", error);
        toast(error.message || "Your websites could not be loaded.");
      }
    }

    if (
      name === "domains" &&
      window.BluvixaDomainManager &&
      typeof window.BluvixaDomainManager.refresh === "function"
    ) {
      window.BluvixaDomainManager.refresh();
    }

    if (name === "builder") {
      updateBuilderHeading(findProject(activeProjectId()));
    }
  }

  function bind() {
    window.addEventListener("hashchange", route);

    ["createWebsiteBtn", "createWebsiteFromDraftsBtn"].forEach(function (id) {
      var button = byId(id);

      if (button) {
        button.addEventListener("click", newWebsite);
      }
    });

    if (byId("saveWebsiteProjectBtn")) {
      byId("saveWebsiteProjectBtn").addEventListener("click", function () {
        saveActiveProject(true);
      });
    }

    ["saveCurrentDraftBtn", "saveSnapshotTopBtn"].forEach(function (id) {
      var button = byId(id);

      if (button) {
        button.addEventListener("click", saveSnapshot);
      }
    });

    if (byId("projectSearchInput")) {
      byId("projectSearchInput").addEventListener(
        "input",
        renderProjects
      );
    }

    if (byId("draftSearchInput")) {
      byId("draftSearchInput").addEventListener(
        "input",
        renderDrafts
      );
    }

    qa("[data-draft-filter]").forEach(function (button) {
      button.addEventListener("click", function () {
        draftFilter = button.dataset.draftFilter;

        qa("[data-draft-filter]").forEach(function (item) {
          item.classList.toggle("active", item === button);
        });

        renderDrafts();
      });
    });

    document.addEventListener("click", function (event) {
      var node;

      if ((node = event.target.closest("[data-project-load]"))) {
        loadProject(node.dataset.projectLoad);
        return;
      }

      if ((node = event.target.closest("[data-project-duplicate]"))) {
        duplicateProject(node.dataset.projectDuplicate);
        return;
      }

      if ((node = event.target.closest("[data-project-delete]"))) {
        deleteProject(node.dataset.projectDelete);
        return;
      }

      if ((node = event.target.closest("[data-project-drafts]"))) {
        setActiveProjectId(node.dataset.projectDrafts);
        location.hash = "#drafts";
        return;
      }

      if ((node = event.target.closest("[data-project-buyout]"))) {
        buyoutProject(node.dataset.projectBuyout);
        return;
      }

      if ((node = event.target.closest("[data-project-export]"))) {
        exportProject(node.dataset.projectExport);
        return;
      }

      if ((node = event.target.closest("[data-snapshot-load]"))) {
        loadSnapshot(node.dataset.snapshotLoad);
        return;
      }

      if ((node = event.target.closest("[data-snapshot-delete]"))) {
        deleteSnapshot(node.dataset.snapshotDelete);
      }
    });

    qa(".memberPlanCheckout").forEach(function (button) {
      button.addEventListener("click", function () {
        if (
          window.BluvixaMVP &&
          typeof window.BluvixaMVP.checkout === "function"
        ) {
          window.BluvixaMVP.checkout(
            button.dataset.plan,
            "annual"
          );
        }
      });
    });

    window.addEventListener("bluvixa:auth-changed", function () {
      accountCache = null;
      projectCache = [];
      route();
    });

    window.addEventListener("bluvixa:project-published", function () {
      loadProjects(true)
        .then(renderAll)
        .catch(function (error) {
          console.error("Project refresh error:", error);
        });
    });

    route();
  }

  document.addEventListener("DOMContentLoaded", bind);

  window.BluvixaWorkspace = {
    createProject: createProject,
    saveActiveProject: saveActiveProject,
    refresh: async function () {
      await Promise.all([
        loadProjects(true),
        loadAccountStatus(true)
      ]);

      renderAll();

      return projectCache.slice();
    },
    getProjects: function () {
      return projectCache.slice();
    },
    getProject: function (projectId) {
      return findProject(projectId);
    },
    getActiveProjectId: activeProjectId,
    setActiveProjectId: setActiveProjectId,
    markOwned: async function () {
      accountCache = null;

      try {
        await loadAccountStatus(true);
        renderAll();
      } catch (error) {
        console.error("Ownership refresh error:", error);
      }
    }
  };
})();