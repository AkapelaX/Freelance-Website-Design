"use strict";

import fs from "fs";
import path from "path";
import { createClient } from "@supabase/supabase-js";

function sendJson(res, status, payload) {
  res.status(status);
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  return res.end(JSON.stringify(payload));
}

function bearerToken(req) {
  const header = String(req.headers.authorization || "");
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : "";
}

function safeFileName(value) {
  return (
    String(value || "bluvixa-website")
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "bluvixa-website"
  );
}

function readProjectFile(name) {
  const candidates = [
    path.join(process.cwd(), name),
    path.join(process.cwd(), "public", name),
  ];

  for (const candidate of candidates) {
    try {
      return fs.readFileSync(candidate, "utf8");
    } catch (_error) {
      // Try the next supported location.
    }
  }

  throw new Error(
    `${name} could not be found. Place it in the project root or public folder.`
  );
}

/**
 * The normal public-site.html loads website data from /api/public-site.
 * A downloaded static website has no Bluvixa API, so this adds site-data.js
 * and makes start() render the exported project immediately.
 */
function prepareStaticHtml(sourceHtml) {
  let html = String(sourceHtml || "");

  const dataScript = '<script src="site-data.js"></script>';

  if (!html.includes(dataScript)) {
    if (/<\/head>/i.test(html)) {
      html = html.replace(/<\/head>/i, `  ${dataScript}\n</head>`);
    } else {
      html = `${dataScript}\n${html}`;
    }
  }

  const startMarker =
    /async function start\(\)\s*\{\s*showLoading\(\);/;

  if (!startMarker.test(html)) {
    throw new Error(
      "The public-site.html start function could not be prepared for static export."
    );
  }

  html = html.replace(
    startMarker,
    `async function start(){
    showLoading();

    /*
      Static buyout export:
      site-data.js defines window.__BLUVIXA_SITE__, allowing this downloaded
      website to render without a Bluvixa domain, slug, API, or subscription.
    */
    if (window.__BLUVIXA_SITE__) {
      applyWebsite(window.__BLUVIXA_SITE__);
      return;
    }`
  );

  return html;
}

// CRC32 implementation used by the self-contained ZIP writer below.
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);

  for (let n = 0; n < 256; n += 1) {
    let c = n;

    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }

    table[n] = c >>> 0;
  }

  return table;
})();

function crc32(buffer) {
  let crc = 0xffffffff;

  for (const byte of buffer) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }

  return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(dateValue) {
  const date = dateValue instanceof Date ? dateValue : new Date();
  const year = Math.max(1980, date.getFullYear());

  const time =
    (date.getHours() << 11) |
    (date.getMinutes() << 5) |
    Math.floor(date.getSeconds() / 2);

  const day =
    ((year - 1980) << 9) |
    ((date.getMonth() + 1) << 5) |
    date.getDate();

  return { time, day };
}

function buildZip(files) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  const stamp = dosDateTime(new Date());

  for (const file of files) {
    const name = Buffer.from(file.name.replace(/\\/g, "/"), "utf8");
    const data = Buffer.isBuffer(file.data)
      ? file.data
      : Buffer.from(String(file.data), "utf8");

    const crc = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(stamp.time, 10);
    local.writeUInt16LE(stamp.day, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);

    locals.push(local, name, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(stamp.time, 12);
    central.writeUInt16LE(stamp.day, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);

    centrals.push(central, name);
    offset += local.length + name.length + data.length;
  }

  const centralDirectory = Buffer.concat(centrals);

  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...locals, centralDirectory, end]);
}

function buildStaticWebsite(project) {
  const state =
    project.project_data &&
    typeof project.project_data === "object" &&
    !Array.isArray(project.project_data)
      ? project.project_data
      : {};

  /*
    public-site.html supports the original builder state under "state".
    Top-level project fields are also retained for compatibility.
  */
  return {
    id: project.id,
    owner_id: project.owner_id,
    name: project.name || "Untitled Website",
    slug: project.slug || "",
    plan: project.plan || null,
    status: project.status || "draft",
    custom_domain: project.custom_domain || null,
    domain_status: project.domain_status || "not_connected",
    website_bought_out: Boolean(project.website_bought_out),
    updated_at: project.updated_at || null,

    state,
    project_data: state,
  };
}

function buildSiteDataJs(project) {
  const website = buildStaticWebsite(project);

  return [
    "/* Bluvixa static buyout export data */",
    `window.__BLUVIXA_SITE__ = ${JSON.stringify(website)};`,
    "",
  ].join("\n");
}

export default async function handler(req, res) {
  if (req.method === "OPTIONS") {
    res.setHeader("Allow", "GET, OPTIONS");
    return res.status(204).end();
  }

  if (req.method !== "GET") {
    res.setHeader("Allow", "GET, OPTIONS");
    return sendJson(res, 405, {
      error: "Method not allowed.",
    });
  }

  try {
    const required = [
      "SUPABASE_URL",
      "SUPABASE_SERVICE_ROLE_KEY",
    ];

    const missing = required.filter(
      (name) => !process.env[name]
    );

    if (missing.length) {
      return sendJson(res, 500, {
        error:
          `Missing server environment variable` +
          `${missing.length > 1 ? "s" : ""}: ` +
          missing.join(", "),
      });
    }

    const token = bearerToken(req);

    if (!token) {
      return sendJson(res, 401, {
        error: "Sign in before exporting a website.",
      });
    }

    const websiteId = String(
      (req.query && req.query.websiteId) || ""
    ).trim();

    if (!websiteId) {
      return sendJson(res, 400, {
        error: "A websiteId is required.",
      });
    }

    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
      {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
        },
      }
    );

    const {
      data: userData,
      error: userError,
    } = await supabase.auth.getUser(token);

    const user = userData && userData.user;

    if (userError || !user) {
      return sendJson(res, 401, {
        error:
          "Your sign-in session is invalid or expired.",
      });
    }

    const {
      data: project,
      error: projectError,
    } = await supabase
      .from("website_projects")
      .select(
        [
          "id",
          "owner_id",
          "name",
          "slug",
          "plan",
          "project_data",
          "status",
          "custom_domain",
          "domain_status",
          "website_bought_out",
          "updated_at",
        ].join(",")
      )
      .eq("id", websiteId)
      .eq("owner_id", user.id)
      .maybeSingle();

    if (projectError) {
      throw projectError;
    }

    if (!project) {
      return sendJson(res, 404, {
        error: "Website not found.",
      });
    }

    if (!project.website_bought_out) {
      return sendJson(res, 403, {
        error:
          "Website export unlocks after this website's buyout is completed.",
      });
    }

    /*
      public-site.html is now the complete master website, including its CSS
      and JavaScript. The export therefore needs only one website HTML file,
      its static project data, and documentation.
    */
    const masterHtml = readProjectFile("public-site.html");
    const indexHtml = prepareStaticHtml(masterHtml);
    const siteDataJs = buildSiteDataJs(project);

    const siteDataJson = JSON.stringify(
      buildStaticWebsite(project),
      null,
      2
    );

    const readme = [
      "BLUVIXA WEBSITE BUYOUT EXPORT",
      "",
      `Website: ${project.name || "Untitled Website"}`,
      `Exported: ${new Date().toISOString()}`,
      "",
      "FILES",
      "index.html     Complete exported website",
      "site-data.js   Website content loaded by index.html",
      "site-data.json Human-readable backup of the website data",
      "README.txt     These instructions",
      "",
      "HOW TO OPEN",
      "Keep every file in the same folder.",
      "Open index.html with a local web server such as VS Code Live Server.",
      "",
      "HOW TO HOST",
      "Upload every file in this folder to the same directory on any static host.",
      "The exported website does not require the Bluvixa API or an active subscription.",
      "",
      "IMPORTANT",
      "Do not rename or remove site-data.js unless index.html is updated to match.",
    ].join("\n");

    const zip = buildZip([
      {
        name: "index.html",
        data: indexHtml,
      },
      {
        name: "site-data.js",
        data: siteDataJs,
      },
      {
        name: "site-data.json",
        data: siteDataJson,
      },
      {
        name: "README.txt",
        data: readme,
      },
    ]);

    const downloadName =
      `${safeFileName(project.name)}.zip`;

    res.status(200);
    res.setHeader(
      "Content-Type",
      "application/zip"
    );
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${downloadName}"`
    );
    res.setHeader(
      "Content-Length",
      String(zip.length)
    );
    res.setHeader(
      "Cache-Control",
      "private, no-store"
    );

    return res.end(zip);
  } catch (error) {
    console.error(
      "Bluvixa website export failed:",
      error
    );

    return sendJson(res, 500, {
      error:
        error && error.message
          ? error.message
          : "Website export could not be generated.",
    });
  }
}