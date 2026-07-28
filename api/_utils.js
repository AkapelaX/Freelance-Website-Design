"use strict";

const JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0"
};

function send(res, status, body) {
  res.status(status);
  Object.entries(JSON_HEADERS).forEach(([key, value]) => res.setHeader(key, value));
  return res.json(body);
}

function ok(res, body = {}) {
  return send(res, 200, body);
}

function created(res, body = {}) {
  return send(res, 201, body);
}

function fail(res, status, message, details) {
  return send(res, status, {
    error: message,
    ...(details ? { details } : {})
  });
}

function method(req, allowed) {
  if (!allowed.includes(req.method)) {
    const error = new Error(`Method ${req.method} not allowed`);
    error.status = 405;
    throw error;
  }
}

function text(value, max = 10000) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function slugify(value) {
  return text(value, 100)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 63) || "my-website";
}

function normalizeDomain(value) {
  return text(value, 253)
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .split("/")[0]
    .replace(/\.+$/, "");
}

function requiredEnv(names) {
  const missing = names.filter((name) => !process.env[name]);
  if (missing.length) {
    const error = new Error(`Missing environment variables: ${missing.join(", ")}`);
    error.status = 500;
    throw error;
  }
}

function action(req, fallback = "") {
  return text(req.query?.action || req.body?.action || fallback, 80);
}

function parseJsonBody(req) {
  if (req.body && typeof req.body === "object" && !Buffer.isBuffer(req.body)) {
    return req.body;
  }
  if (typeof req.body === "string") {
    try {
      return JSON.parse(req.body);
    } catch {
      return {};
    }
  }
  return {};
}

function publicBaseUrl(req) {
  return (
    process.env.PUBLIC_APP_URL ||
    `${req.headers["x-forwarded-proto"] || "https"}://${req.headers.host}`
  ).replace(/\/+$/, "");
}

function safeFilename(value) {
  return slugify(value).replace(/[^a-z0-9_-]/g, "") || "website";
}

function handleError(res, error) {
  console.error(error);
  return fail(
    res,
    Number(error.status) || 500,
    error.message || "Unexpected server error"
  );
}

module.exports = {
  send,
  ok,
  created,
  fail,
  method,
  text,
  slugify,
  normalizeDomain,
  requiredEnv,
  action,
  parseJsonBody,
  publicBaseUrl,
  safeFilename,
  handleError
};
