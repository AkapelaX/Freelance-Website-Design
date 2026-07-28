"use strict";

import {
  admin,
  requireUser,
  sendError
} from "../_lib.js";

function text(value) {
  return typeof value === "string"
    ? value.trim()
    : "";
}

function cleanSlug(value) {
  return (
    text(value)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || ""
  );
}

function isObject(value) {
  return Boolean(
    value &&
    typeof value === "object" &&
    !Array.isArray(value)
  );
}

function requestProjectId(req) {
  return text(
    req.query?.project_id ||
    req.query?.projectId ||
    req.body?.project_id ||
    req.body?.projectId
  );
}

function sendJson(res, status, payload) {
  res.status(status);
  res.setHeader(
    "Content-Type",
    "application/json; charset=utf-8"
  );
  res.setHeader(
    "Cache-Control",
    "no-store, no-cache, must-revalidate, max-age=0"
  );

  return res.end(
    JSON.stringify(payload)
  );
}

function normalizedProjectData(value) {
  if (!isObject(value)) {
    return null;
  }

  return JSON.parse(
    JSON.stringify(value)
  );
}

async function getOwnedProject(
  projectId,
  userId
) {
  const {
    data,
    error
  } = await admin
    .from("projects")
    .select(
      [
        "id",
        "user_id",
        "name",
        "slug",
        "plan",
        "project_data",
        "published",
        "published_url",
        "custom_domain",
        "domain_status",
        "ssl_status",
        "dns_verified",
        "dns_records",
        "verification_record",
        "verified_at",
        "domain_last_checked_at",
        "domain_error",
        "created_at",
        "updated_at"
      ].join(",")
    )
    .eq("id", projectId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  if (!data) {
    const error = new Error(
      "Website project not found."
    );

    error.status = 404;
    throw error;
  }

  return data;
}

async function listProjects(userId) {
  const {
    data,
    error
  } = await admin
    .from("projects")
    .select(
      [
        "id",
        "user_id",
        "name",
        "slug",
        "plan",
        "project_data",
        "published",
        "published_url",
        "custom_domain",
        "domain_status",
        "ssl_status",
        "dns_verified",
        "dns_records",
        "verification_record",
        "verified_at",
        "domain_last_checked_at",
        "domain_error",
        "created_at",
        "updated_at"
      ].join(",")
    )
    .eq("user_id", userId)
    .order(
      "updated_at",
      {
        ascending: false
      }
    );

  if (error) {
    throw error;
  }

  return Array.isArray(data)
    ? data
    : [];
}

async function slugIsTaken(
  slug,
  projectId
) {
  if (!slug) {
    return false;
  }

  let query = admin
    .from("projects")
    .select("id")
    .eq("slug", slug)
    .limit(1);

  if (projectId) {
    query = query.neq(
      "id",
      projectId
    );
  }

  const {
    data,
    error
  } = await query;

  if (error) {
    throw error;
  }

  return Array.isArray(data) &&
    data.length > 0;
}

function buildProtectedProjectData(
  incomingProject,
  existingRow,
  userId,
  projectId,
  now
) {
  const existingData =
    isObject(existingRow?.project_data)
      ? existingRow.project_data
      : {};

  const existingBackend =
    isObject(existingData.backend)
      ? existingData.backend
      : {};

  const incomingBackend =
    isObject(incomingProject.backend)
      ? incomingProject.backend
      : {};

  const existingProjectSettings =
    isObject(existingData.project)
      ? existingData.project
      : {};

  const incomingProjectSettings =
    isObject(incomingProject.project)
      ? incomingProject.project
      : {};

  return {
    ...incomingProject,

    project: {
      ...incomingProjectSettings,

      customDomain:
        existingRow?.custom_domain ||
        existingProjectSettings.customDomain ||
        "",

      domainStatus:
        existingRow?.domain_status ||
        existingProjectSettings.domainStatus ||
        "not_connected",

      sslStatus:
        existingRow?.ssl_status ||
        existingProjectSettings.sslStatus ||
        "waiting",

      dnsVerified:
        existingRow?.dns_verified === true,

      dnsRecords:
        Array.isArray(
          existingRow?.dns_records
        )
          ? existingRow.dns_records
          : [],

      verificationRecord:
        existingRow?.verification_record ||
        null
    },

    backend: {
      ...incomingBackend,

      userId,

      websiteId: projectId,

      published:
        existingRow?.published === true,

      publishedUrl:
        existingRow?.published_url ||
        null,

      updatedAt: now,

      createdAt:
        existingBackend.createdAt ||
        existingRow?.created_at ||
        now
    }
  };
}

async function handleGet(
  req,
  res,
  user
) {
  const projectId =
    requestProjectId(req);

  if (projectId) {
    const project =
      await getOwnedProject(
        projectId,
        user.id
      );

    return sendJson(
      res,
      200,
      {
        ok: true,
        project
      }
    );
  }

  const projects =
    await listProjects(
      user.id
    );

  return sendJson(
    res,
    200,
    {
      ok: true,
      projects
    }
  );
}

async function handlePost(
  req,
  res,
  user
) {
  const incomingProject =
    normalizedProjectData(
      req.body?.projectData ||
      req.body?.project_data ||
      req.body?.project
    );

  if (!incomingProject) {
    return sendJson(
      res,
      400,
      {
        ok: false,
        error:
          "Project data is required."
      }
    );
  }

  const requestedProjectId =
    requestProjectId(req);

  let existingRow = null;

  if (requestedProjectId) {
    existingRow =
      await getOwnedProject(
        requestedProjectId,
        user.id
      );
  }

  const requestedName =
    text(req.body?.name);

  const businessName =
    text(
      incomingProject.business?.name
    );

  const name =
    requestedName ||
    (
      businessName
        ? `${businessName} Website`
        : ""
    ) ||
    existingRow?.name ||
    "My Website";

  const requestedSlug =
    cleanSlug(
      req.body?.slug ||
      incomingProject.project?.slug ||
      existingRow?.slug
    );

  if (
    requestedSlug &&
    await slugIsTaken(
      requestedSlug,
      requestedProjectId
    )
  ) {
    return sendJson(
      res,
      409,
      {
        ok: false,
        error:
          "That Bluvixa address is already reserved."
      }
    );
  }

  const plan =
    text(
      req.body?.plan ||
      incomingProject.plan ||
      existingRow?.plan ||
      "starter"
    ).toLowerCase();

  const now =
    new Date().toISOString();

  if (existingRow) {
    const protectedProject =
      buildProtectedProjectData(
        incomingProject,
        existingRow,
        user.id,
        existingRow.id,
        now
      );

    const {
      data,
      error
    } = await admin
      .from("projects")
      .update({
        name,
        slug:
          requestedSlug ||
          existingRow.slug ||
          null,
        plan,
        project_data:
          protectedProject,
        updated_at: now
      })
      .eq(
        "id",
        existingRow.id
      )
      .eq(
        "user_id",
        user.id
      )
      .select(
        [
          "id",
          "user_id",
          "name",
          "slug",
          "plan",
          "project_data",
          "published",
          "published_url",
          "custom_domain",
          "domain_status",
          "ssl_status",
          "dns_verified",
          "dns_records",
          "verification_record",
          "verified_at",
          "domain_last_checked_at",
          "domain_error",
          "created_at",
          "updated_at"
        ].join(",")
      )
      .single();

    if (error) {
      throw error;
    }

    return sendJson(
      res,
      200,
      {
        ok: true,
        saved: true,
        created: false,
        project: data
      }
    );
  }

  const temporaryProjectId =
    null;

  const initialProjectData = {
    ...incomingProject,

    project: {
      ...(
        isObject(
          incomingProject.project
        )
          ? incomingProject.project
          : {}
      ),

      customDomain: "",
      domainStatus:
        "not_connected",
      sslStatus: "waiting",
      dnsVerified: false,
      dnsRecords: [],
      verificationRecord: null
    },

    backend: {
      ...(
        isObject(
          incomingProject.backend
        )
          ? incomingProject.backend
          : {}
      ),

      userId: user.id,
      websiteId:
        temporaryProjectId,
      published: false,
      publishedUrl: null,
      createdAt: now,
      updatedAt: now
    }
  };

  const {
    data: inserted,
    error: insertError
  } = await admin
    .from("projects")
    .insert({
      user_id: user.id,
      name,
      slug:
        requestedSlug ||
        null,
      plan,
      project_data:
        initialProjectData,
      published: false,
      published_url: null,
      custom_domain: null,
      domain_status:
        "not_connected",
      ssl_status: "waiting",
      dns_verified: false,
      dns_records: [],
      verification_record: null,
      verified_at: null,
      domain_last_checked_at:
        null,
      domain_error: null,
      created_at: now,
      updated_at: now
    })
    .select(
      [
        "id",
        "user_id",
        "name",
        "slug",
        "plan",
        "project_data",
        "published",
        "published_url",
        "custom_domain",
        "domain_status",
        "ssl_status",
        "dns_verified",
        "dns_records",
        "verification_record",
        "verified_at",
        "domain_last_checked_at",
        "domain_error",
        "created_at",
        "updated_at"
      ].join(",")
    )
    .single();

  if (insertError) {
    throw insertError;
  }

  const finalizedProjectData =
    buildProtectedProjectData(
      incomingProject,
      inserted,
      user.id,
      inserted.id,
      now
    );

  const {
    data: finalized,
    error: finalizeError
  } = await admin
    .from("projects")
    .update({
      project_data:
        finalizedProjectData,
      updated_at: now
    })
    .eq(
      "id",
      inserted.id
    )
    .eq(
      "user_id",
      user.id
    )
    .select(
      [
        "id",
        "user_id",
        "name",
        "slug",
        "plan",
        "project_data",
        "published",
        "published_url",
        "custom_domain",
        "domain_status",
        "ssl_status",
        "dns_verified",
        "dns_records",
        "verification_record",
        "verified_at",
        "domain_last_checked_at",
        "domain_error",
        "created_at",
        "updated_at"
      ].join(",")
    )
    .single();

  if (finalizeError) {
    throw finalizeError;
  }

  return sendJson(
    res,
    201,
    {
      ok: true,
      saved: true,
      created: true,
      project: finalized
    }
  );
}

export default async function handler(
  req,
  res
) {
  if (req.method === "OPTIONS") {
    res.setHeader(
      "Allow",
      "GET, POST, OPTIONS"
    );

    return res
      .status(204)
      .end();
  }

  try {
    const user =
      await requireUser(req);

    if (req.method === "GET") {
      return handleGet(
        req,
        res,
        user
      );
    }

    if (req.method === "POST") {
      return handlePost(
        req,
        res,
        user
      );
    }

    res.setHeader(
      "Allow",
      "GET, POST, OPTIONS"
    );

    return sendJson(
      res,
      405,
      {
        ok: false,
        error:
          "Method not allowed."
      }
    );
  } catch (error) {
    console.error(
      "Projects API error:",
      error
    );

    return sendError(
      res,
      error
    );
  }
}
