(function () {
  "use strict";

  const AUTO_REFRESH_MS = 30000;
  let projects = [];
  let current = null;
  let timer = null;
  let busy = false;

  const $ = (id) => document.getElementById(id);

  function cleanDomain(value) {
    return String(value || "")
      .trim()
      .toLowerCase()
      .replace(/^https?:\/\//, "")
      .replace(/\/.*$/, "")
      .replace(/\.$/, "");
  }

  function accessTokenFromStorage() {
    try {
      for (let i = 0; i < localStorage.length; i += 1) {
        const key = localStorage.key(i);
        if (!key || !key.startsWith("sb-") || !key.endsWith("-auth-token")) continue;
        const raw = localStorage.getItem(key);
        const parsed = JSON.parse(raw || "{}");
        const token =
          parsed.access_token ||
          parsed.currentSession?.access_token ||
          parsed.session?.access_token;
        if (token) return token;
      }
    } catch (_) {}
    return "";
  }

  async function api(path, options = {}) {
    const token = accessTokenFromStorage();
    if (!token) throw new Error("Your Bluvixa session could not be found. Sign out and sign back in.");

    const response = await fetch(path, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        ...(options.headers || {})
      },
      cache: "no-store"
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.error || payload.message || `Request failed (${response.status}).`);
    }
    return payload;
  }

  function message(id, text, type = "") {
    const el = $(id);
    if (!el) return;
    el.textContent = text || "";
    el.className = `dm-inline-message${type ? ` ${type}` : ""}`;
  }

  function setBusy(value) {
    busy = value;
    ["dmConnectBtn", "dmVerifyBtn", "dmRetryBtn", "dmRemoveBtn", "dmRefreshAllBtn"].forEach((id) => {
      const el = $(id);
      if (el) el.disabled = value;
    });
  }

  function labelStatus(status) {
    return {
      not_connected: "Not Connected",
      verifying: "Verifying",
      connected: "Connected",
      failed: "Needs Attention",
      removing: "Removing"
    }[status] || "Not Connected";
  }

  function setState(data) {
    current = data || null;
    const project = projects.find((item) => item.id === $("dmProjectSelect")?.value) || {};
    const status = data?.domain_status || "not_connected";
    const ssl = data?.ssl_status || "waiting";
    const domain = data?.custom_domain || "";
    const connected = status === "connected";
    const verifying = status === "verifying";
    const failed = status === "failed";
    const stateClass = connected ? "connected" : failed ? "failed" : verifying ? "verifying" : "waiting";

    $("dmOverviewDomain").textContent = domain || "Not connected";
    $("dmOverviewDomainDetail").textContent = domain ? "Assigned to the selected website." : "Choose a website below.";
    $("dmOverviewDns").textContent = data?.dns_verified ? "Verified" : verifying ? "Checking" : "Waiting";
    $("dmOverviewDnsDetail").textContent = data?.dns_verified ? "Required DNS records are valid." : "Add the required records and verify.";
    $("dmOverviewSsl").textContent = ssl === "active" ? "Active" : ssl === "provisioning" ? "Provisioning" : "Waiting";
    $("dmOverviewSslDetail").textContent = ssl === "active" ? "HTTPS is active." : "HTTPS activates automatically after verification.";

    $("dmSideDomain").textContent = domain || "No custom domain";
    $("dmDetailDomainStatus").textContent = labelStatus(status);
    $("dmDetailDnsStatus").textContent = data?.dns_verified ? "Yes" : "No";
    $("dmDetailSslStatus").textContent = ssl === "active" ? "Active" : ssl === "provisioning" ? "Provisioning" : "Waiting";
    $("dmDetailVerifiedAt").textContent = data?.verified_at ? new Date(data.verified_at).toLocaleString() : "—";
    $("dmDetailLastChecked").textContent = data?.domain_last_checked_at ? new Date(data.domain_last_checked_at).toLocaleString() : "—";

    $("dmLiveDot").className = `dm-live-dot ${stateClass}`;
    $("dmStatusPill").className = `dm-status-pill ${stateClass}`;
    $("dmStatusPill").textContent = labelStatus(status);
    $("dmLiveTitle").textContent = connected ? "Domain connected" : failed ? "Domain needs attention" : verifying ? "Waiting for DNS" : "Not connected";
    $("dmLiveMessage").textContent =
      data?.domain_error ||
      (connected ? "The custom domain is verified and ready to serve the website over HTTPS." :
       verifying ? "Add the DNS records shown above, then retry verification." :
       "Enter a domain and select Connect Domain.");

    $("dmDomainInput").value = domain;
    $("dmDnsEmpty").classList.toggle("hidden", Boolean(domain));
    $("dmDnsRecords").classList.toggle("hidden", !domain);

    const dns = Array.isArray(data?.dns_records) ? data.dns_records : [];
    const aRecord = dns.find((item) => item.type === "A");
    const cnameRecord = dns.find((item) => item.type === "CNAME");
    if (aRecord) {
      $("dmDnsType1").textContent = aRecord.type;
      $("dmDnsHost1").textContent = aRecord.name;
      $("dmDnsValue1").textContent = aRecord.value;
    }
    if (cnameRecord) {
      $("dmDnsType2").textContent = cnameRecord.type;
      $("dmDnsHost2").textContent = cnameRecord.name;
      $("dmDnsValue2").textContent = cnameRecord.value;
    }

    const verification = data?.verification_record;
    $("dmVerificationRecord").classList.toggle("hidden", !verification);
    if (verification) {
      $("dmVerificationHost").textContent = verification.name || "_vercel";
      $("dmVerificationValue").textContent = verification.value || "";
    }

    const publicUrl = project.public_url || project.published_url || "";
    $("dmCurrentAddress").textContent = publicUrl || "Not published";
    $("dmCurrentAddress").href = publicUrl || "#";

    const publishingDomain = $("publishingMetricDomain");
    const publishingDetail = $("publishingMetricDomainDetail");
    const publishingSsl = $("publishingMetricSsl");
    const badge = $("dmPublishingDomainBadge");
    if (publishingDomain) publishingDomain.textContent = domain || "Bluvixa address";
    if (publishingDetail) publishingDetail.textContent = domain ? labelStatus(status) : "No custom domain connected";
    if (publishingSsl) publishingSsl.textContent = ssl === "active" ? "Active" : ssl === "provisioning" ? "Provisioning" : "Waiting";
    if (badge) {
      badge.className = `dm-mini-badge ${stateClass}`;
      badge.textContent = labelStatus(status);
    }
  }

  function populateProjects() {
    const select = $("dmProjectSelect");
    if (!select) return;
    const previous = select.value;
    select.innerHTML = projects.length
      ? projects.map((p) => `<option value="${p.id}">${escapeHtml(p.name || p.title || "Untitled Website")}</option>`).join("")
      : '<option value="">No websites found</option>';
    if (projects.some((p) => p.id === previous)) select.value = previous;
    syncPublishingSelector();
  }

  function syncPublishingSelector() {
    const source = $("publishingCenterProjectSelect");
    const target = $("dmProjectSelect");
    if (!source || !target) return;
    if (source.value && projects.some((p) => p.id === source.value)) target.value = source.value;
  }

  function escapeHtml(value) {
    return String(value || "").replace(/[&<>"']/g, (char) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
    })[char]);
  }

  async function loadStatus({ quiet = false } = {}) {
    const projectId = $("dmProjectSelect")?.value;
    if (!projectId) {
      setState(null);
      return;
    }
    if (!quiet) message("dmStatusMessage", "Checking domain status…", "info");
    try {
      const data = await api(`/api/domain-status?project_id=${encodeURIComponent(projectId)}`);
      setState(data.domain);
      if (!quiet) message("dmStatusMessage", "Domain status refreshed.", "success");
    } catch (error) {
      if (!quiet) message("dmStatusMessage", error.message, "error");
    }
  }

  async function loadProjects() {
    setBusy(true);
    try {
      const data = await api("/api/domain-status");
      projects = Array.isArray(data.projects) ? data.projects : [];
      populateProjects();
      if (projects.length) await loadStatus({ quiet: true });
      else setState(null);
    } catch (error) {
      message("dmStatusMessage", error.message, "error");
    } finally {
      setBusy(false);
    }
  }

  async function connectDomain() {
    const projectId = $("dmProjectSelect")?.value;
    const domain = cleanDomain($("dmDomainInput")?.value);
    if (!projectId) return message("dmConnectMessage", "Select a website first.", "error");
    if (!domain || !domain.includes(".")) return message("dmConnectMessage", "Enter a valid domain such as example.com.", "error");

    setBusy(true);
    message("dmConnectMessage", "Adding the domain to Vercel…", "info");
    try {
      const data = await api("/api/connect-domain", {
        method: "POST",
        body: JSON.stringify({ project_id: projectId, domain })
      });
      setState(data.domain);
      message("dmConnectMessage", data.message || "Domain prepared. Add the DNS records shown below.", "success");
      scheduleRefresh();
    } catch (error) {
      message("dmConnectMessage", error.message, "error");
    } finally {
      setBusy(false);
    }
  }

  async function verifyDomain() {
    const projectId = $("dmProjectSelect")?.value;
    if (!projectId) return message("dmStatusMessage", "Select a website first.", "error");

    setBusy(true);
    message("dmStatusMessage", "Checking DNS and SSL status…", "info");
    try {
      const data = await api("/api/check-domain", {
        method: "POST",
        body: JSON.stringify({ project_id: projectId })
      });
      setState(data.domain);
      message("dmStatusMessage", data.message || "Verification completed.", data.domain?.domain_status === "connected" ? "success" : "info");
      scheduleRefresh();
    } catch (error) {
      message("dmStatusMessage", error.message, "error");
    } finally {
      setBusy(false);
    }
  }

  async function removeDomain() {
    const projectId = $("dmProjectSelect")?.value;
    const domain = current?.custom_domain;
    if (!projectId || !domain) return message("dmStatusMessage", "There is no custom domain to remove.", "error");
    if (!window.confirm(`Remove ${domain} from this Bluvixa website?`)) return;

    setBusy(true);
    message("dmStatusMessage", "Removing the domain…", "info");
    try {
      const data = await api("/api/remove-domain", {
        method: "POST",
        body: JSON.stringify({ project_id: projectId })
      });
      setState(data.domain);
      message("dmStatusMessage", "Custom domain removed. The Bluvixa address remains available.", "success");
      clearInterval(timer);
    } catch (error) {
      message("dmStatusMessage", error.message, "error");
    } finally {
      setBusy(false);
    }
  }

  async function copyValue(button) {
    const target = $(button.dataset.copyTarget);
    const value = target?.textContent?.trim();
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      const old = button.textContent;
      button.textContent = "Copied";
      button.classList.add("copied");
      setTimeout(() => {
        button.textContent = old;
        button.classList.remove("copied");
      }, 1400);
    } catch (_) {
      window.prompt("Copy this DNS value:", value);
    }
  }

  function scheduleRefresh() {
    clearInterval(timer);
    if (!$("dmAutoRefreshToggle")?.checked) return;
    if (!current?.custom_domain || current?.domain_status === "connected") return;
    timer = setInterval(() => {
      if (!busy && location.hash === "#domains") loadStatus({ quiet: true });
    }, AUTO_REFRESH_MS);
  }

  function bind() {
    $("dmConnectBtn")?.addEventListener("click", connectDomain);
    $("dmVerifyBtn")?.addEventListener("click", verifyDomain);
    $("dmRetryBtn")?.addEventListener("click", verifyDomain);
    $("dmRemoveBtn")?.addEventListener("click", removeDomain);
    $("dmRefreshAllBtn")?.addEventListener("click", () => loadStatus());
    $("dmProjectSelect")?.addEventListener("change", async () => {
      await loadStatus({ quiet: true });
      scheduleRefresh();
    });
    $("dmAutoRefreshToggle")?.addEventListener("change", scheduleRefresh);
    $("dmDomainInput")?.addEventListener("input", (event) => {
      event.target.value = event.target.value.replace(/\s+/g, "");
    });
    document.addEventListener("click", (event) => {
      const button = event.target.closest(".dm-copy-btn");
      if (button) copyValue(button);
    });
    window.addEventListener("hashchange", () => {
      if (location.hash === "#domains") {
        syncPublishingSelector();
        loadProjects();
      } else {
        clearInterval(timer);
      }
    });
  }

  document.addEventListener("DOMContentLoaded", () => {
    bind();
    if (location.hash === "#domains") loadProjects();
  });
})();
