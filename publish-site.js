"use strict";

(function () {
  var bound = false;
  var supabaseClient = null;

  function toast(message) {
    if (
      window.BluvixaMVP &&
      typeof window.BluvixaMVP.toast === "function"
    ) {
      window.BluvixaMVP.toast(message);
      return;
    }

    var element = document.getElementById("toast");

    if (element) {
      element.textContent = message;
      element.classList.add("show");
      clearTimeout(toast.timer);
      toast.timer = setTimeout(function () {
        element.classList.remove("show");
      }, 2800);
      return;
    }

    console.log(message);
  }

  function sanitizeSlug(value) {
    return String(value || "website")
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 48) || "website";
  }

  async function getSupabaseClient() {
    if (supabaseClient) return supabaseClient;

    if (!window.supabase) {
      throw new Error("Supabase did not load.");
    }

    var response = await fetch("/api/config", {
      headers: { Accept: "application/json" }
    });

    var config = {};

    try {
      config = await response.json();
    } catch (_error) {}

    if (!response.ok) {
      throw new Error(
        config.error || "Supabase configuration could not be loaded."
      );
    }

    var url =
      config.supabaseUrl ||
      config.supabase_url ||
      config.url;

    var anonKey =
      config.supabaseAnonKey ||
      config.supabase_anon_key ||
      config.anonKey ||
      config.anon_key;

    if (!url || !anonKey) {
      throw new Error("Supabase configuration is incomplete.");
    }

    supabaseClient = window.supabase.createClient(url, anonKey);
    return supabaseClient;
  }

  async function getAccessToken() {
    var client = await getSupabaseClient();
    var result = await client.auth.getSession();
    var session =
      result &&
      result.data &&
      result.data.session
        ? result.data.session
        : null;

    if (!session || !session.access_token) {
      throw new Error("Please sign in again.");
    }

    return session.access_token;
  }

  function getBuilderState() {
    if (typeof window.bluvixaExportState !== "function") {
      return null;
    }

    try {
      return window.bluvixaExportState();
    } catch (error) {
      console.error("Builder state could not be read:", error);
      return null;
    }
  }

  function readStoredProjects() {
    var possibleKeys = [
      "bluvixa_projects_v6",
      "bluvixa_projects",
      "bluvixaProjects",
      "bluvixa_platform_projects",
      "bluvixaPlatformProjects"
    ];

    for (var index = 0; index < possibleKeys.length; index += 1) {
      try {
        var raw = localStorage.getItem(possibleKeys[index]);
        if (!raw) continue;

        var parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          return {
            key: possibleKeys[index],
            projects: parsed
          };
        }
      } catch (_error) {}
    }

    return null;
  }

  function findStoredProject(projectId) {
    var stored = readStoredProjects();
    if (!stored) return null;

    return stored.projects.find(function (project) {
      return String(project.id) === String(projectId);
    }) || null;
  }

  function getProjectId(button, state) {
    return String(
      button.dataset.projectId ||
      button.getAttribute("data-project-id") ||
      (state && state.backend && state.backend.websiteId) ||
      (state && state.backend && state.backend.website_id) ||
      ""
    ).trim();
  }

  function getRequestedSlug(button, state, storedProject) {
    return sanitizeSlug(
      button.dataset.slug ||
      (storedProject && storedProject.slug) ||
      (state && state.project && state.project.slug) ||
      (storedProject && storedProject.name) ||
      "website"
    );
  }

  function buttonMeansUnpublish(button, state, storedProject) {
    var text = String(button.textContent || "")
      .trim()
      .toLowerCase();

    if (text.indexOf("unpublish") !== -1) return true;
    if (text.indexOf("publish") !== -1) return false;

    if (typeof button.dataset.published === "string") {
      return button.dataset.published === "true";
    }

    if (storedProject && typeof storedProject.published === "boolean") {
      return storedProject.published;
    }

    return Boolean(
      state &&
      state.backend &&
      state.backend.published
    );
  }

  function updateButton(button, published) {
    var isDashboardButton =
      button.id === "publishingPrimaryBtn";

    button.dataset.published = String(published);
    button.textContent = published
      ? "Unpublish Website"
      : isDashboardButton
        ? "Publish Now"
        : "Publish Website";

    button.classList.toggle("btn-danger", published);
    button.disabled = false;
  }

  function updateBuilderState(result) {
    var state = getBuilderState();
    if (!state) return;

    state.backend = state.backend || {};
    state.project = state.project || {};

    state.backend.published = result.published === true;
    state.backend.updatedAt = new Date().toISOString();
    state.project.slug = result.slug || state.project.slug || "";

    if (typeof window.bluvixaImportState === "function") {
      window.bluvixaImportState(state);
    }
  }

  function updateStoredProject(projectId, result) {
    var stored = readStoredProjects();
    if (!stored) return;

    var changed = false;

    stored.projects.forEach(function (project) {
      if (String(project.id) !== String(projectId)) return;

      project.published = result.published === true;
      project.slug = result.slug || project.slug || "";
      project.updatedAt = new Date().toISOString();

      if (project.published) {
        project.publishedAt = project.updatedAt;
      } else {
        project.publishedAt = null;
      }

      if (project.state) {
        project.state.backend = project.state.backend || {};
        project.state.project = project.state.project || {};
        project.state.backend.published = project.published;
        project.state.backend.publishedAt =
          project.publishedAt || null;
        project.state.project.slug = project.slug;
      }

      changed = true;
    });

    if (changed) {
      try {
        localStorage.setItem(
          stored.key,
          JSON.stringify(stored.projects)
        );
      } catch (error) {
        console.error("Publishing state could not be saved:", error);
      }
    }
  }

  async function requestPublication(options) {
    var accessToken = await getAccessToken();

    var response = await fetch("/api/publish-site", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + accessToken
      },
      body: JSON.stringify({
        projectId: options.projectId,
        publish: options.publish === true,
        requestedSlug: options.requestedSlug
      })
    });

    var result = {};

    try {
      result = await response.json();
    } catch (_error) {}

    if (!response.ok) {
      throw new Error(
        result.error ||
        (options.publish
          ? "The website could not be published."
          : "The website could not be unpublished.")
      );
    }

    if (typeof result.published !== "boolean") {
      throw new Error(
        "The server returned an invalid publishing status."
      );
    }

    return result;
  }

  async function toggle(button) {
    var state = getBuilderState();
    var projectId = getProjectId(button, state);

    if (!projectId) {
      throw new Error(
        "Save this website to your account before publishing."
      );
    }

    var storedProject = findStoredProject(projectId);
    var currentlyPublished = buttonMeansUnpublish(
      button,
      state,
      storedProject
    );
    var shouldPublish = !currentlyPublished;
    var requestedSlug = getRequestedSlug(
      button,
      state,
      storedProject
    );

    if (
      shouldPublish &&
      state &&
      state.project &&
      state.project.domainMode === "custom" &&
      !state.project.dnsVerified
    ) {
      throw new Error(
        "Connect and verify your custom domain before publishing."
      );
    }

    button.disabled = true;
    button.textContent = shouldPublish
      ? "Publishing…"
      : "Unpublishing…";

    var result;

    try {
      result = await requestPublication({
        projectId: projectId,
        publish: shouldPublish,
        requestedSlug: requestedSlug
      });

      updateBuilderState(result);
      updateStoredProject(projectId, result);
      updateButton(button, result.published);

      document.dispatchEvent(
        new CustomEvent("bluvixa:publication-changed", {
          detail: result
        })
      );

      toast(
        result.published
          ? "Website published successfully."
          : "Website unpublished successfully."
      );

      return result;
    } catch (error) {
      updateButton(button, currentlyPublished);
      throw error;
    }
  }

  function isPublishingButton(target) {
    return target && (
      target.id === "publishBtn" ||
      target.id === "publishingPrimaryBtn" ||
      target.matches("[data-bluvixa-publish]")
    );
  }

  function bind() {
    if (bound) return;
    bound = true;

    /*
      Capture phase is intentional. It prevents older app.js or platform.js
      publish handlers from firing a second request after this controller.
    */
    document.addEventListener(
      "click",
      function (event) {
        var button = event.target.closest(
          "#publishBtn, #publishingPrimaryBtn, [data-bluvixa-publish]"
        );

        if (!isPublishingButton(button)) return;

        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();

        toggle(button).catch(function (error) {
          console.error("Bluvixa publishing failed:", error);
          toast(
            "Publishing failed: " +
            (error.message || "Unknown error")
          );
        });
      },
      true
    );
  }

  window.BluvixaPublishing = {
    bind: bind,
    toggle: toggle,
    request: requestPublication
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bind);
  } else {
    bind();
  }
})();