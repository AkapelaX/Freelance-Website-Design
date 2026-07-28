"use strict";

import * as U from "./domain-utils.js";

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function projectIdFrom(req) {
  return text(
    req.body?.project_id ||
    req.body?.projectId ||
    req.query?.project_id ||
    req.query?.projectId
  );
}

function actionFrom(req) {
  return text(
    req.query?.action ||
    req.body?.action ||
    "status"
  ).toLowerCase();
}

function requireProjectId(req, res) {
  const projectId = projectIdFrom(req);

  if (!projectId) {
    U.send(res, 400, {
      ok: false,
      error: "project_id is required."
    });

    return "";
  }

  return projectId;
}

function allow(res, methods) {
  res.setHeader("Allow", methods.join(", "));
}

async function status(req, res, user) {
  const projectId = projectIdFrom(req);

  if (projectId) {
    const project = await U.getOwnedProject(
      projectId,
      user.id
    );

    return U.send(res, 200, {
      ok: true,
      domain: project
    });
  }

  const projects =
    await U.listOwnedProjects(user.id);

  return U.send(res, 200, {
    ok: true,
    projects
  });
}

async function checkSlug(req, res, user) {
  const projectId =
    requireProjectId(req, res);

  if (!projectId) {
    return;
  }

  const slug =
    U.cleanSlug(req.body?.slug);

  if (slug.length < 3) {
    return U.send(res, 400, {
      ok: false,
      error:
        "Use at least 3 letters or numbers."
    });
  }

  await U.getOwnedProject(
    projectId,
    user.id
  );

  const taken =
    await U.slugTaken(
      slug,
      projectId
    );

  return U.send(res, 200, {
    ok: true,
    available: !taken,
    slug,
    url:
      `https://bluvixa.com/site/${slug}`
  });
}

async function reserveSlug(req, res, user) {
  const projectId =
    requireProjectId(req, res);

  if (!projectId) {
    return;
  }

  const slug =
    U.cleanSlug(req.body?.slug);

  if (slug.length < 3) {
    return U.send(res, 400, {
      ok: false,
      error:
        "Use at least 3 letters or numbers."
    });
  }

  await U.getOwnedProject(
    projectId,
    user.id
  );

  const taken =
    await U.slugTaken(
      slug,
      projectId
    );

  if (taken) {
    return U.send(res, 409, {
      ok: false,
      error:
        "That Bluvixa address is already reserved."
    });
  }

  const project =
    await U.updateProject(
      projectId,
      user.id,
      {
        slug
      }
    );

  return U.send(res, 200, {
    ok: true,
    message:
      "Bluvixa address reserved.",
    domain: project,
    url:
      `https://bluvixa.com/site/${slug}`
  });
}

async function connect(req, res, user) {
  const projectId =
    requireProjectId(req, res);

  if (!projectId) {
    return;
  }

  const domain =
    U.normalizeDomain(
      req.body?.domain
    );

  if (!U.validDomain(domain)) {
    return U.send(res, 400, {
      ok: false,
      error: "Enter a valid domain."
    });
  }

  const currentProject =
    await U.getOwnedProject(
      projectId,
      user.id
    );

  const currentDomain =
    U.normalizeDomain(
      currentProject.custom_domain
    );

  if (
    currentDomain &&
    currentDomain !== domain
  ) {
    return U.send(res, 409, {
      ok: false,
      error:
        "Remove the current custom domain first."
    });
  }

  const vercelDomain =
    await U.addDomainToVercel(
      domain
    );

  const dns =
    U.dnsRecordsFor(
      domain,
      vercelDomain
    );

  const now =
    new Date().toISOString();

  const savedProject =
    await U.updateProject(
      projectId,
      user.id,
      {
        custom_domain: domain,
        domain_status: "verifying",
        ssl_status: "provisioning",
        dns_verified: false,
        verified_at: null,
        domain_last_checked_at: now,
        domain_error: null,
        dns_records:
          Array.isArray(dns?.records)
            ? dns.records
            : [],
        verification_record:
          dns?.verification_record ||
          null
      }
    );

  return U.send(res, 200, {
    ok: true,
    message:
      "Domain added. Configure DNS, then verify.",
    domain: savedProject
  });
}

async function check(req, res, user) {
  const projectId =
    requireProjectId(req, res);

  if (!projectId) {
    return;
  }

  const currentProject =
    await U.getOwnedProject(
      projectId,
      user.id
    );

  const domain =
    U.normalizeDomain(
      currentProject.custom_domain
    );

  if (!domain) {
    return U.send(res, 400, {
      ok: false,
      error:
        "This website has no custom domain."
    });
  }

  let vercelDomain;

  try {
    vercelDomain =
      await U.verifyVercelProjectDomain(
        domain
      );
  } catch (verifyError) {
    if (
      verifyError &&
      verifyError.status &&
      verifyError.status !== 400 &&
      verifyError.status !== 404 &&
      verifyError.status >= 500
    ) {
      throw verifyError;
    }

    vercelDomain =
      await U.getVercelProjectDomain(
        domain
      );
  }

  const state =
    U.statusFromVercel(
      vercelDomain
    );

  const dns =
    U.dnsRecordsFor(
      domain,
      vercelDomain
    );

  const now =
    new Date().toISOString();

  const connected =
    state.domain_status ===
    "connected";

  const savedProject =
    await U.updateProject(
      projectId,
      user.id,
      {
        domain_status:
          state.domain_status ||
          "verifying",
        ssl_status:
          state.ssl_status ||
          "provisioning",
        dns_verified:
          state.dns_verified === true,
        verified_at:
          connected
            ? currentProject.verified_at ||
              now
            : null,
        domain_last_checked_at:
          now,
        domain_error:
          connected
            ? null
            : state.domain_error ||
              "DNS is not verified yet.",
        dns_records:
          Array.isArray(dns?.records)
            ? dns.records
            : [],
        verification_record:
          dns?.verification_record ||
          null
      }
    );

  return U.send(res, 200, {
    ok: true,
    message:
      connected
        ? "Domain verified and HTTPS is active."
        : "Still waiting for valid DNS records.",
    domain: savedProject
  });
}

async function remove(req, res, user) {
  const projectId =
    requireProjectId(req, res);

  if (!projectId) {
    return;
  }

  const currentProject =
    await U.getOwnedProject(
      projectId,
      user.id
    );

  const domain =
    U.normalizeDomain(
      currentProject.custom_domain
    );

  if (domain) {
    try {
      await U.removeDomainFromVercel(
        domain
      );
    } catch (error) {
      if (error?.status !== 404) {
        throw error;
      }
    }
  }

  const savedProject =
    await U.updateProject(
      projectId,
      user.id,
      {
        custom_domain: null,
        domain_status:
          "not_connected",
        ssl_status: "waiting",
        dns_verified: false,
        verified_at: null,
        domain_last_checked_at:
          new Date().toISOString(),
        domain_error: null,
        dns_records: [],
        verification_record: null
      }
    );

  return U.send(res, 200, {
    ok: true,
    message:
      "Custom domain removed.",
    domain: savedProject
  });
}

export default async function handler(
  req,
  res
) {
  try {
    const user =
      await U.authenticatedUser(req);

    const action =
      actionFrom(req);

    if (
      action === "status" &&
      req.method === "GET"
    ) {
      return status(
        req,
        res,
        user
      );
    }

    if (
      action === "check-slug" &&
      req.method === "POST"
    ) {
      return checkSlug(
        req,
        res,
        user
      );
    }

    if (
      action === "reserve-slug" &&
      req.method === "POST"
    ) {
      return reserveSlug(
        req,
        res,
        user
      );
    }

    if (
      action === "connect" &&
      req.method === "POST"
    ) {
      return connect(
        req,
        res,
        user
      );
    }

    if (
      action === "check" &&
      req.method === "POST"
    ) {
      return check(
        req,
        res,
        user
      );
    }

    if (
      action === "remove" &&
      (
        req.method === "POST" ||
        req.method === "DELETE"
      )
    ) {
      return remove(
        req,
        res,
        user
      );
    }

    allow(
      res,
      ["GET", "POST", "DELETE"]
    );

    return U.send(res, 405, {
      ok: false,
      error:
        "Method or action not allowed."
    });
  } catch (error) {
    console.error(
      "Domain API error:",
      error
    );

    return U.errorResponse(
      res,
      error
    );
  }
};
