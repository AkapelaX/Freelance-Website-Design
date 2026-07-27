"use strict";

(function () {
  const byId = id => document.getElementById(id);
  const state = {};

  function value(input, fallback = "") {
    return input == null ? fallback : String(input);
  }

  function phoneHref(input) {
    return "tel:" + value(input).replace(/[^\d+]/g, "");
  }

  function setText(id, input) {
    const node = byId(id);
    if (node) node.textContent = value(input);
  }

  function setCover(id, url) {
    const node = byId(id);

    if (node && url) {
      node.style.backgroundImage = `url("${String(url).replace(/"/g, "%22")}")`;
    }
  }

  function validHttpUrl(url) {
    return /^https?:\/\//i.test(value(url));
  }

  function showLoading() {
    byId("loadingScreen").hidden = false;
    byId("notFoundScreen").hidden = true;
    byId("siteRoot").hidden = true;
  }

  function showWebsite() {
    byId("loadingScreen").hidden = true;
    byId("notFoundScreen").hidden = true;
    byId("siteRoot").hidden = false;
  }

  function showUnavailable(message) {
    byId("loadingScreen").hidden = true;
    byId("siteRoot").hidden = true;
    byId("notFoundScreen").hidden = false;

    setText(
      "notFoundMessage",
      message || "This website is not published."
    );
  }

  function mapEmbedUrl(project) {
    if (validHttpUrl(project.mapUrl)) return project.mapUrl;

    const address = value(project.business?.address);

    return address
      ? `https://www.google.com/maps?q=${encodeURIComponent(address)}&output=embed`
      : "";
  }

  function renderMedia(items, containerId) {
    const container = byId(containerId);
    const list = Array.isArray(items) ? items : [];

    container.innerHTML = list.map(item => {
      const src = value(item.src || item.url);
      const title = value(item.title || item.name);
      const description = value(item.description || item.bio);

      const isVideo =
        item.type === "video" ||
        /\.(mp4|webm|mov)(\?|$)/i.test(src);

      return `
        <article class="media-card">
          ${
            isVideo
              ? `<video src="${src}" controls playsinline preload="metadata"></video>`
              : `<img src="${src}" alt="${title.replace(/"/g, "&quot;")}" loading="lazy">`
          }
          <div>
            ${title ? `<strong>${title}</strong>` : ""}
            ${description ? `<p>${description}</p>` : ""}
          </div>
        </article>
      `;
    }).join("");
  }

  function applyWebsite(project) {
    const s = project.state || {};
    const business = s.business || {};
    const header = s.header || {};
    const design = s.design || {};
    const photos = Array.isArray(s.photos) ? s.photos : [];
    const gallery = Array.isArray(s.gallery) ? s.gallery : [];

    document.title = business.name || project.name || "Website";

    const description = business.bio || header.headline || "";

    document
      .querySelector('meta[name="description"]')
      .setAttribute("content", description.slice(0, 160));

    document.documentElement.style.setProperty(
      "--theme",
      design.themeColor || "#1769ff"
    );

    document.documentElement.style.setProperty(
      "--header",
      design.headerColor || "#082b5e"
    );

    document.documentElement.style.setProperty(
      "--button",
      design.buttonColor || "#1769ff"
    );

    document.documentElement.style.setProperty(
      "--card",
      design.cardColor || "#ffffff"
    );

    document.documentElement.style.setProperty(
      "--outline",
      design.logoOutlineColor || "#61c7ff"
    );

    setText(
      "businessName",
      (business.name || project.name || "Your Business").toUpperCase()
    );

    setText("tagline", header.tagline);
    setText("headline", header.headline || "Build a stronger online presence.");
    setText("headerBio", header.bio);
    setText("businessBio", business.bio);
    setText("phoneLink", business.phone);
    setText("emailLink", business.email);
    setText("hours", business.hours);
    setText("address", business.address);
    setText("aboutHeading", design.aboutHeading || "About Us");
    setText("aboutText", business.bio);
    setText("featuredHeading", design.featuredHeading || "Featured");
    setText("featuredDescription", design.featuredDescription);
    setText("galleryHeading", design.galleryHeading || "Gallery");
    setText("galleryDescription", design.galleryDescription);
    setText("mapHeading", design.mapHeading || "Find Us");

    setText(
      "footerText",
      `© ${new Date().getFullYear()} ${
        business.name || project.name || "Your Business"
      }`
    );

    const logo = design.logo;

    if (logo) {
      byId("logoImage").src = logo;
      byId("logoImage").hidden = false;
      byId("logoFallback").hidden = true;
    }

    if (header.image) {
      byId("home").style.backgroundImage =
        `url("${header.image.replace(/"/g, "%22")}")`;
    }

    const callText = business.callText || "Call Now";

    ["headerCall", "heroCall", "mapCall"].forEach(id => {
      const node = byId(id);

      node.textContent = callText;
      node.href = phoneHref(business.phone);
      node.hidden = !business.phone;
    });

    byId("phoneLink").href = phoneHref(business.phone);

    byId("emailLink").href = business.email
      ? `mailto:${business.email}`
      : "#";

    setCover("aboutCover", design.aboutCover);
    setCover("featuredCover", design.featuredCover);
    setCover("galleryCover", design.galleryCover);
    setCover("mapCover", design.mapCover);

    byId("about").hidden = !(
      design.aboutHeading ||
      design.aboutCover ||
      business.bio
    );

    byId("featured").hidden = photos.length === 0;
    byId("gallery").hidden = gallery.length === 0;

    renderMedia(photos, "photoGrid");
    renderMedia(gallery, "galleryGrid");

    const mapUrl = mapEmbedUrl(s);

    byId("contact").hidden = !mapUrl && !business.address;

    if (mapUrl) {
      byId("mapFrame").src = mapUrl;
    }

    const navNames =
      Array.isArray(design.scroll) && design.scroll.length
        ? design.scroll
        : ["Home", "Services", "About", "Gallery", "Contact"];

    const available = [
      ["Home", "home", true],
      ["Services", "services", true],
      ["About", "about", !byId("about").hidden],
      ["Featured", "featured", !byId("featured").hidden],
      ["Gallery", "gallery", !byId("gallery").hidden],
      ["Contact", "contact", !byId("contact").hidden]
    ];

    const chosen = [];

    navNames.forEach(label => {
      const lower = value(label).toLowerCase();

      const match = available.find(
        item =>
          item[0].toLowerCase() === lower &&
          item[2]
      );

      if (
        match &&
        !chosen.some(item => item[1] === match[1])
      ) {
        chosen.push(match);
      }
    });

    available.forEach(item => {
      if (
        item[2] &&
        !chosen.some(chosenItem => chosenItem[1] === item[1])
      ) {
        chosen.push(item);
      }
    });

    byId("siteNav").innerHTML = chosen
      .map(item => `<a href="#${item[1]}">${item[0]}</a>`)
      .join("");

    showWebsite();
  }

  async function start() {
    showLoading();

    const params = new URLSearchParams(location.search);

    const pathMatch = location.pathname.match(
      /^\/site\/([^/?#]+)/i
    );

    const slug =
      params.get("slug") ||
      (pathMatch ? decodeURIComponent(pathMatch[1]) : "");

    const host =
      params.get("host") ||
      (
        location.hostname !== "bluvixa.com" &&
        location.hostname !== "www.bluvixa.com" &&
        location.hostname !== "localhost"
          ? location.hostname
          : ""
      );

    const query = new URLSearchParams();

    if (host) {
      query.set("host", host);
    } else {
      query.set("slug", slug);
    }

    try {
      const response = await fetch(
        `/api/public-site?${query.toString()}`
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.error || "Website unavailable."
        );
      }

      if (!data.website) {
        throw new Error("This website could not be found.");
      }

      applyWebsite(data.website);
    } catch (error) {
      showUnavailable(
        error.message || "This website is not published."
      );
    }
  }

  byId("menuButton").addEventListener("click", () => {
    byId("siteNav").classList.toggle("open");
  });

  byId("siteNav").addEventListener("click", () => {
    byId("siteNav").classList.remove("open");
  });

  start();
})();