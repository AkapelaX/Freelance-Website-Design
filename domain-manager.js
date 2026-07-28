(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);

  let projects = [];
  let currentProject = null;
  let refreshTimer = null;
  let busy = false;
  let loadingProjects = false;

  function getAccessToken() {
    try {
      for (let index = 0; index < localStorage.length; index += 1) {
        const key = localStorage.key(index);

        if (!key || !key.startsWith("sb-") || !key.endsWith("-auth-token")) {
          continue;
        }

        const stored = JSON.parse(localStorage.getItem(key) || "{}");
        const accessToken =
          stored.access_token ||
          stored.currentSession?.access_token ||
          stored.session?.access_token;

        if (accessToken) {
          return accessToken;
        }
      }
    } catch (error) {
      console.error("Unable to read the Supabase session.", error);
    }

    return "";
  }

  async function domainApi(action, options = {}) {
    const accessToken = getAccessToken();

    if (!accessToken) {
      throw new Error("Your session has expired. Sign out and sign back in.");
    }

    const separator = action.includes("?") ? "&" : "?";
    const response = await fetch(`/api/domain${separator}${action}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
        ...(options.headers || {})
      },
      cache: "no-store"
    });

    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(payload.error || `Request failed (${response.status}).`);
    }

    return payload;
  }

  function setText(id, value) {
    const element = $(id);
    if (element) element.textContent = value;
  }

  function setValue(id, value) {
    const element = $(id);
    if (element) element.value = value;
  }

  function setHref(id, value) {
    const element = $(id);
    if (!element) return;

    element.href = value || "#";
    element.classList.toggle("disabled-link", !value);
  }

  function setHidden(id, hidden) {
    const element = $(id);
    if (element) element.classList.toggle("hidden", hidden);
  }

  function showMessage(id, text, type = "") {
    const element = $(id);
    if (!element) return;

    element.textContent = text || "";
    element.className = `dm-inline-message${type ? ` ${type}` : ""}`;
  }

  function cleanDomain(value) {
    return String(value || "")
      .trim()
      .toLowerCase()
      .replace(/^https?:\/\//, "")
      .replace(/\/.*$/, "");
  }

  function cleanSlug(value) {
    return String(value || "")
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .replace(/-{2,}/g, "-")
      .slice(0, 63);
  }

  function escapeHtml(value) {
    return String(value || "").replace(/[&<>"']/g, (character) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;"
    })[character]);
  }

  function domainStatusLabel(status) {
    return ({
      not_connected: "Not Connected",
      verifying: "Verifying",
      connected: "Connected",
      failed: "Needs Attention",
      removing: "Removing"
    })[status] || "Not Connected";
  }

  function sslStatusLabel(status) {
    return ({
      active: "Active",
      provisioning: "Provisioning",
      failed: "Needs Attention",
      waiting: "Waiting"
    })[status] || "Waiting";
  }

  function setBusy(value) {
    busy = value;

    [
      "dmCheckSlugBtn",
      "dmReserveSlugBtn",
      "dmConnectBtn",
      "dmVerifyBtn",
      "dmRetryBtn",
      "dmRemoveBtn",
      "dmRefreshAllBtn"
    ].forEach((id) => {
      const button = $(id);
      if (button) button.disabled = value;
    });
  }

  function selectedProjectId() {
    return $("dmProjectSelect")?.value ||
      $("publishingCenterProjectSelect")?.value ||
      "";
  }

  function updateLocalProject(project) {
    if (!project?.id) return;

    const index = projects.findIndex((item) => item.id === project.id);

    if (index >= 0) {
      projects[index] = { ...projects[index], ...project };
    } else {
      projects.push(project);
    }

    currentProject = project;
  }

  function populateProjectSelectors(preferredId = "") {
    const domainSelect = $("dmProjectSelect");
    const publishingSelect = $("publishingCenterProjectSelect");
    const previousDomainId = domainSelect?.value || "";
    const previousPublishingId = publishingSelect?.value || "";

    const options = projects.length
      ? projects.map((project) => {
          const projectName = project.name || "Untitled Website";
          return `<option value="${escapeHtml(project.id)}">${escapeHtml(projectName)}</option>`;
        }).join("")
      : '<option value="">No websites found</option>';

    if (domainSelect) domainSelect.innerHTML = options;
    if (publishingSelect) publishingSelect.innerHTML = options;

    const requestedId =
      preferredId ||
      previousDomainId ||
      previousPublishingId ||
      projects[0]?.id ||
      "";

    if (domainSelect && projects.some((project) => project.id === requestedId)) {
      domainSelect.value = requestedId;
    }

    if (publishingSelect && projects.some((project) => project.id === requestedId)) {
      publishingSelect.value = requestedId;
    }
  }

  function syncProjectSelectors(projectId, sourceId) {
    if (!projectId) return;

    const domainSelect = $("dmProjectSelect");
    const publishingSelect = $("publishingCenterProjectSelect");

    if (sourceId !== "dmProjectSelect" && domainSelect) {
      domainSelect.value = projectId;
    }

    if (sourceId !== "publishingCenterProjectSelect" && publishingSelect) {
      publishingSelect.value = projectId;
    }
  }

  function renderDomainManager(project) {
    currentProject = project || null;

    const slug = project?.slug || "";
    const bluvixaUrl = slug ? `https://bluvixa.com/site/${slug}` : "";
    const customDomain = project?.custom_domain || "";
    const domainStatus = project?.domain_status || "not_connected";
    const sslStatus = project?.ssl_status || "waiting";
    const hasCustomDomain = Boolean(customDomain);

    const statusClass =
      domainStatus === "connected"
        ? "connected"
        : domainStatus === "failed"
          ? "failed"
          : domainStatus === "verifying"
            ? "verifying"
            : "waiting";

    setValue("dmSlugInput", slug);
    setValue("dmDomainInput", customDomain);

    setText("dmOverviewBluvixa", bluvixaUrl || "Not reserved");
    setText(
      "dmOverviewBluvixaDetail",
      bluvixaUrl ? "Ready to publish." : "Choose an address below."
    );

    setText("dmBluvixaAddress", bluvixaUrl || "Not reserved");
    setHref("dmBluvixaAddress", bluvixaUrl);
    setText("dmDetailBluvixa", bluvixaUrl || "Not reserved");

    setText("dmOverviewDomain", customDomain || "Not connected");
    setText(
      "dmOverviewDomainDetail",
      customDomain ? "Assigned to this website." : "Optional custom domain."
    );

    setText("dmOverviewSsl", sslStatusLabel(sslStatus));
    setText(
      "dmOverviewSslDetail",
      sslStatus === "active"
        ? "HTTPS is active."
        : "HTTPS activates after verification."
    );

    setText("dmSideDomain", customDomain || "No custom domain");
    setText("dmDetailDomainStatus", domainStatusLabel(domainStatus));
    setText("dmDetailDnsStatus", project?.dns_verified ? "Yes" : "No");
    setText("dmDetailSslStatus", sslStatusLabel(sslStatus));
    setText(
      "dmDetailVerifiedAt",
      project?.verified_at
        ? new Date(project.verified_at).toLocaleString()
        : "—"
    );
    setText(
      "dmDetailLastChecked",
      project?.domain_last_checked_at
        ? new Date(project.domain_last_checked_at).toLocaleString()
        : "—"
    );

    const liveDot = $("dmLiveDot");
    if (liveDot) liveDot.className = `dm-live-dot ${statusClass}`;

    const statusPill = $("dmStatusPill");
    if (statusPill) {
      statusPill.className = `dm-status-pill ${statusClass}`;
      statusPill.textContent = domainStatusLabel(domainStatus);
    }

    setText(
      "dmLiveTitle",
      domainStatus === "connected"
        ? "Domain connected"
        : domainStatus === "verifying"
          ? "Waiting for DNS"
          : domainStatus === "failed"
            ? "Domain needs attention"
            : "Not connected"
    );

    setText(
      "dmLiveMessage",
      project?.domain_error ||
        (domainStatus === "connected"
          ? "Custom domain is verified and secured."
          : domainStatus === "verifying"
            ? "Add the DNS records and retry verification."
            : "Enter a custom domain and select Connect Domain.")
    );

    setHidden("dmDnsEmpty", hasCustomDomain);
    setHidden("dmDnsRecords", !hasCustomDomain);

    const dnsRecords = Array.isArray(project?.dns_records)
      ? project.dns_records
      : [];

    const aRecord = dnsRecords.find((record) => record.type === "A");
    const cnameRecord = dnsRecords.find((record) => record.type === "CNAME");

    setText("dmDnsType1", aRecord?.type || "A");
    setText("dmDnsHost1", aRecord?.name || "@");
    setText("dmDnsValue1", aRecord?.value || "76.76.21.21");

    setText("dmDnsType2", cnameRecord?.type || "CNAME");
    setText("dmDnsHost2", cnameRecord?.name || "www");
    setText(
      "dmDnsValue2",
      cnameRecord?.value || "cname.vercel-dns.com"
    );

    const verificationRecord = project?.verification_record || null;
    setHidden("dmVerificationRecord", !verificationRecord);

    if (verificationRecord) {
      setText(
        "dmVerificationHost",
        verificationRecord.name || "_vercel"
      );
      setText("dmVerificationValue", verificationRecord.value || "");
    }

    const publishingBadge = $("dmPublishingDomainBadge");
    if (publishingBadge) {
      publishingBadge.className = `dm-mini-badge ${statusClass}`;
      publishingBadge.textContent = domainStatusLabel(domainStatus);
    }

    setText(
      "publishingMetricDomain",
      customDomain || bluvixaUrl || "Bluvixa address"
    );

    setText(
      "publishingMetricDomainDetail",
      customDomain
        ? domainStatusLabel(domainStatus)
        : bluvixaUrl
          ? "Bluvixa address reserved"
          : "No address reserved"
    );

    setText("publishingMetricSsl", sslStatusLabel(sslStatus));

    setText(
      "dmPublishingSslDetail",
      sslStatus === "active"
        ? "HTTPS is active"
        : customDomain
          ? "HTTPS activates after domain verification"
          : "HTTPS activates after publishing"
    );

    const removeButton = $("dmRemoveBtn");
    if (removeButton) removeButton.disabled = busy || !hasCustomDomain;

    scheduleAutomaticRefresh();
  }

  async function loadProjects(preferredId = "") {
    if (loadingProjects) return;
    loadingProjects = true;
    setBusy(true);

    try {
      const data = await domainApi("action=status");
      projects = Array.isArray(data.projects) ? data.projects : [];
      populateProjectSelectors(preferredId);

      if (projects.length) {
        await loadSelectedProjectStatus(true);
      } else {
        renderDomainManager(null);
      }
    } catch (error) {
      showMessage("dmStatusMessage", error.message, "error");
    } finally {
      loadingProjects = false;
      setBusy(false);
    }
  }

  async function loadSelectedProjectStatus(quiet = false) {
    const projectId = selectedProjectId();

    if (!projectId) {
      renderDomainManager(null);
      return;
    }

    try {
      const data = await domainApi(
        `action=status&project_id=${encodeURIComponent(projectId)}`
      );

      updateLocalProject(data.domain);
      syncProjectSelectors(projectId);
      renderDomainManager(data.domain);

      if (!quiet) {
        showMessage("dmStatusMessage", "Status refreshed.", "success");
      }
    } catch (error) {
      if (!quiet) {
        showMessage("dmStatusMessage", error.message, "error");
      }
    }
  }

  async function checkOrReserveSlug(reserve) {
    const projectId = selectedProjectId();
    const slug = cleanSlug($("dmSlugInput")?.value);

    setValue("dmSlugInput", slug);

    if (!projectId) {
      showMessage("dmSlugMessage", "Select a website first.", "error");
      return;
    }

    if (slug.length < 3) {
      showMessage(
        "dmSlugMessage",
        "Use at least 3 letters or numbers.",
        "error"
      );
      return;
    }

    setBusy(true);
    showMessage(
      "dmSlugMessage",
      reserve ? "Reserving address…" : "Checking availability…",
      "info"
    );

    try {
      const action = reserve ? "reserve-slug" : "check-slug";
      const data = await domainApi(`action=${action}`, {
        method: "POST",
        body: JSON.stringify({
          project_id: projectId,
          slug
        })
      });

      if (reserve) {
        updateLocalProject(data.domain);
        renderDomainManager(data.domain);
        showMessage("dmSlugMessage", data.message, "success");
      } else {
        showMessage(
          "dmSlugMessage",
          data.available
            ? `${data.url} is available.`
            : "That address is already reserved.",
          data.available ? "success" : "error"
        );
      }
    } catch (error) {
      showMessage("dmSlugMessage", error.message, "error");
    } finally {
      setBusy(false);
    }
  }

  async function connectCustomDomain() {
    const projectId = selectedProjectId();
    const domain = cleanDomain($("dmDomainInput")?.value);

    setValue("dmDomainInput", domain);

    if (!projectId) {
      showMessage("dmConnectMessage", "Select a website first.", "error");
      return;
    }

    if (!domain) {
      showMessage("dmConnectMessage", "Enter a domain first.", "error");
      return;
    }

    setBusy(true);
    showMessage(
      "dmConnectMessage",
      "Adding domain to Vercel…",
      "info"
    );

    try {
      const data = await domainApi("action=connect", {
        method: "POST",
        body: JSON.stringify({
          project_id: projectId,
          domain
        })
      });

      updateLocalProject(data.domain);
      renderDomainManager(data.domain);
      showMessage("dmConnectMessage", data.message, "success");
    } catch (error) {
      showMessage("dmConnectMessage", error.message, "error");
    } finally {
      setBusy(false);
    }
  }

  async function verifyCustomDomain() {
    const projectId = selectedProjectId();

    if (!projectId) {
      showMessage("dmStatusMessage", "Select a website first.", "error");
      return;
    }

    setBusy(true);
    showMessage("dmStatusMessage", "Checking DNS and SSL…", "info");

    try {
      const data = await domainApi("action=check", {
        method: "POST",
        body: JSON.stringify({ project_id: projectId })
      });

      updateLocalProject(data.domain);
      renderDomainManager(data.domain);

      showMessage(
        "dmStatusMessage",
        data.message,
        data.domain?.domain_status === "connected" ? "success" : "info"
      );
    } catch (error) {
      showMessage("dmStatusMessage", error.message, "error");
    } finally {
      setBusy(false);
    }
  }

  async function removeCustomDomain() {
    const projectId = selectedProjectId();

    if (!currentProject?.custom_domain) {
      showMessage(
        "dmStatusMessage",
        "No custom domain is connected.",
        "error"
      );
      return;
    }

    const confirmed = window.confirm(
      `Remove ${currentProject.custom_domain}?`
    );

    if (!confirmed) return;

    setBusy(true);

    try {
      const data = await domainApi("action=remove", {
        method: "POST",
        body: JSON.stringify({ project_id: projectId })
      });

      updateLocalProject(data.domain);
      renderDomainManager(data.domain);

      showMessage(
        "dmStatusMessage",
        "Custom domain removed. The Bluvixa address remains available.",
        "success"
      );
    } catch (error) {
      showMessage("dmStatusMessage", error.message, "error");
    } finally {
      setBusy(false);
    }
  }

  function scheduleAutomaticRefresh() {
    window.clearInterval(refreshTimer);

    if (
      !$("dmAutoRefreshToggle")?.checked ||
      !currentProject?.custom_domain ||
      currentProject?.domain_status === "connected"
    ) {
      return;
    }

    refreshTimer = window.setInterval(() => {
      if (!busy && window.location.hash === "#domains") {
        loadSelectedProjectStatus(true);
      }
    }, 30000);
  }

  function domainsPageIsOpen() {
    return window.location.hash === "#domains";
  }

  function bindEvents() {
    $("dmCheckSlugBtn")?.addEventListener("click", () => {
      checkOrReserveSlug(false);
    });

    $("dmReserveSlugBtn")?.addEventListener("click", () => {
      checkOrReserveSlug(true);
    });

    $("dmConnectBtn")?.addEventListener("click", connectCustomDomain);
    $("dmVerifyBtn")?.addEventListener("click", verifyCustomDomain);
    $("dmRetryBtn")?.addEventListener("click", verifyCustomDomain);
    $("dmRemoveBtn")?.addEventListener("click", removeCustomDomain);

    $("dmRefreshAllBtn")?.addEventListener("click", () => {
      loadProjects(selectedProjectId());
    });

    $("dmProjectSelect")?.addEventListener("change", async (event) => {
      syncProjectSelectors(event.target.value, "dmProjectSelect");
      await loadSelectedProjectStatus(true);
    });

    $("publishingCenterProjectSelect")?.addEventListener(
      "change",
      async (event) => {
        syncProjectSelectors(
          event.target.value,
          "publishingCenterProjectSelect"
        );
        await loadSelectedProjectStatus(true);
      }
    );

    $("dmAutoRefreshToggle")?.addEventListener(
      "change",
      scheduleAutomaticRefresh
    );

    $("dmSlugInput")?.addEventListener("input", (event) => {
      event.target.value = cleanSlug(event.target.value);
    });

    $("dmSlugInput")?.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        checkOrReserveSlug(false);
      }
    });

    $("dmDomainInput")?.addEventListener("input", (event) => {
      event.target.value = event.target.value.replace(/\s+/g, "");
    });

    $("dmDomainInput")?.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        connectCustomDomain();
      }
    });

    document.addEventListener("click", async (event) => {
      const copyButton = event.target.closest(".dm-copy-btn");
      if (!copyButton) return;

      const target = $(copyButton.dataset.copyTarget);
      const value = target?.textContent?.trim();

      if (!value) return;

      try {
        await navigator.clipboard.writeText(value);
        const originalText = copyButton.textContent;
        copyButton.textContent = "Copied";

        window.setTimeout(() => {
          copyButton.textContent = originalText;
        }, 1200);
      } catch (error) {
        window.prompt("Copy this value:", value);
      }
    });
  }

  document.addEventListener("DOMContentLoaded", () => {
    bindEvents();

    if (domainsPageIsOpen()) {
      loadProjects();
    }
  });

  window.addEventListener("hashchange", () => {
    if (domainsPageIsOpen()) {
      loadProjects(selectedProjectId());
    } else {
      window.clearInterval(refreshTimer);
    }
  });

  window.addEventListener("bluvixa:projects-updated", (event) => {
    if (!domainsPageIsOpen()) return;
    loadProjects(event.detail?.projectId || selectedProjectId());
  });

  window.BluvixaDomainManager = {
    refresh: () => loadProjects(selectedProjectId()),
    refreshCurrent: () => loadSelectedProjectStatus(false),
    getCurrentProject: () => currentProject
  };
})();