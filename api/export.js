"use strict";

const JSZip = require("jszip");
const { requireUser, requireProjectOwner } = require("./_auth");
const { method, text, safeFilename, handleError } = require("./_utils");

function escapeHtml(value) {
  return String(value || "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  })[character]);
}

function buildHtml(project) {
  const data = project.project_data || {};
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(data.businessName || project.name)}</title>
<link rel="stylesheet" href="style.css">
</head>
<body>
<header><strong>${escapeHtml(data.businessName || project.name)}</strong>
<a href="tel:${escapeHtml(data.phoneNumber || "")}">${escapeHtml(data.callButtonText || "Call Now")}</a></header>
<main>
<section class="hero"><p>${escapeHtml(data.headerTagline || "")}</p><h1>${escapeHtml(data.headerHeadline || "")}</h1><p>${escapeHtml(data.headerBio || "")}</p></section>
<section><h2>${escapeHtml(data.aboutHeading || "About")}</h2><p>${escapeHtml(data.businessBio || "")}</p></section>
<section><h2>${escapeHtml(data.featuredHeading || "Services")}</h2><p>${escapeHtml(data.featuredDescription || "")}</p></section>
<section><h2>${escapeHtml(data.galleryHeading || "Gallery")}</h2><p>${escapeHtml(data.galleryDescription || "")}</p></section>
<section><h2>${escapeHtml(data.mapHeading || "Find Us")}</h2><p>${escapeHtml(data.businessAddress || "")}</p></section>
</main>
<footer>${escapeHtml(data.businessName || project.name)} — Exported from Bluvixa</footer>
</body>
</html>`;
}

function buildCss(project) {
  const data = project.project_data || {};
  return `:root{--theme:${data.themeColor || "#1769ff"};--header:${data.headerColor || "#082b5e"};--button:${data.buttonColor || "#1769ff"};--card:${data.cardColor || "#ffffff"}}
*{box-sizing:border-box}body{margin:0;font-family:Arial,sans-serif;color:#0f172a;background:#f8fafc}
header{display:flex;justify-content:space-between;align-items:center;padding:20px 7%;color:white;background:var(--header)}
header a{padding:10px 16px;border-radius:10px;color:white;background:var(--button);text-decoration:none}
main section{padding:64px 7%;border-bottom:1px solid #e2e8f0}main section:nth-child(even){background:#eef5ff}
.hero{min-height:480px;display:flex;flex-direction:column;justify-content:center;color:white;background:#07152d}
h1{font-size:clamp(42px,7vw,82px);max-width:900px}h2{font-size:38px;color:var(--theme)}
footer{padding:26px 7%;color:white;background:var(--header)}`;
}

module.exports = async function handler(req, res) {
  try {
    method(req, ["GET"]);
    const user = await requireUser(req);
    const projectId = text(req.query.project_id, 80);
    const project = await requireProjectOwner(projectId, user.id);

    if (!project.owned) {
      const error = new Error("Website buyout is required before ZIP export");
      error.status = 403;
      throw error;
    }

    const zip = new JSZip();
    zip.file("index.html", buildHtml(project));
    zip.file("style.css", buildCss(project));
    zip.file("README.txt", [
      "Bluvixa website export",
      "",
      "Open index.html in a browser or upload this folder to a static host.",
      "This export contains no Bluvixa subscription lock.",
      "Domain registration and third-party service costs remain separate."
    ].join("\n"));

    const archive = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
    const filename = `${safeFilename(project.name)}.zip`;

    res.status(200);
    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Content-Length", archive.length);
    return res.end(archive);
  } catch (error) {
    return handleError(res, error);
  }
};
