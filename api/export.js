"use strict";

const fs = require("fs");
const path = require("path");
const JSZip = require("jszip");
const { requireUser, requireProjectOwner } = require("./_auth");
const { method, text, safeFilename, handleError } = require("./_utils");

function serializeForScript(value) {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

function loadPublicSiteTemplate() {
  const templatePath = path.join(__dirname, "..", "public-site.html");
  return fs.readFileSync(templatePath, "utf8");
}

function buildHtml(project) {
  const template = loadPublicSiteTemplate();
  const exportedWebsite = {
    project_id: project.id,
    slug: project.slug || "",
    custom_domain: project.custom_domain || "",
    plan: project.plan || "",
    published_at: project.published_at || "",
    name: project.name || "Website",
    data: project.project_data || {}
  };

  const startupMarker = "  start();";

  if (!template.includes(startupMarker)) {
    const error = new Error("The public-site.html startup marker could not be found");
    error.status = 500;
    throw error;
  }

  return template.replace(
    startupMarker,
    `  const exportedWebsite=${serializeForScript(exportedWebsite)};\n  applyWebsite(exportedWebsite);`
  );
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
    zip.file("README.txt", [
      "Bluvixa website export",
      "",
      "Open index.html in a browser or upload this folder to a static host.",
      "The exported website uses the same renderer as public-site.html.",
      "This export contains no Bluvixa subscription lock.",
      "Saved images and videos continue to use their existing hosted URLs.",
      "Domain registration and third-party service costs remain separate."
    ].join("\n"));

    const archive = await zip.generateAsync({
      type: "nodebuffer",
      compression: "DEFLATE"
    });

    const filename = `${safeFilename(project.name || "bluvixa-website")}.zip`;

    res.status(200);
    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Content-Length", archive.length);
    return res.end(archive);
  } catch (error) {
    return handleError(res, error);
  }
};