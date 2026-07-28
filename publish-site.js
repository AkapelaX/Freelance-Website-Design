"use strict";

import {
  admin,
  requireUser,
  sendError
} from "../_lib.js";

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

function text(value) {
  return typeof value === "string"
    ? value.trim()
    : "";
}

function cleanSlug(value) {
  return (
    text(value || "website")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) ||
    "website"
  );
}

function parsePublishValue(value) {
  if (
    value === true ||
    value === 1 ||
    value === "1"
  ) {
    return true;
  }

  if (
    value === false ||
    value === 0 ||
    value === "0"
  ) {
    return false;
  }

  if (typeof value === "string") {
    const normalized =
      value.trim().toLowerCase();

    if (
      normalized === "true" ||
      normalized === "publish" ||
      normalized === "published"
    ) {
      return true;
    }

    if (
      normalized === "false" ||
      normalized === "unpublish" ||
      normalized === "draft"
    ) {
      return false;
    }
  }

  return null;
}

function projectIdFrom(req) {
  return text(
    req.body?.project_id ||
    req.body?.projectId ||
    req.query?.project_id ||
    req.query?.projectId
  );
}

function requestedSlugFrom(req) {
  return cleanSlug(
    req.body?.requested_slug ||
    req.body?.requestedSlug ||
    req.body?.slug ||
    ""
  );
}

function requestOrigin(req) {
  const forwardedProto =
    text(
      req.headers["x-forwarded-proto"]
    )
      .split(",")[0]
      .trim();

  const protocol =
    forwardedProto ||
    "https";

  const forwardedHost =
    text(
      req.headers["x-forwarded-host"]
    )
      .split(",")[0]
      .trim();

  const host =
    forwardedHost ||
    text(req.headers.host) ||
    "bluvixa.com";

  return `${protocol}://${host}`;
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
      "Website not found."
    );

    error.status = 404;
    throw error;
  }

  return data;
}

async function slugTaken(
  slug,
  projectId
) {
  const {
    data,
    error
  } = await admin
    .from("projects")
    .select("id")
    .eq("slug", slug)
    .neq("id", projectId)
    .limit(1);

  if (error) {
    throw error;
  }

  return (
    Array.isArray(data) &&
    data.length > 0
  );
}

async function uniqueSlug(
  baseSlug,
  projectId
) {
  const normalizedBase =
    cleanSlug(baseSlug);

  if (
    !await slugTaken(
      normalizedBase,
      projectId
    )
  ) {
    return normalizedBase;
  }

  const suffix =
    String(projectId)
      .replace(/-/g, "")
      .slice(-8);

  const trimmedBase =
    normalizedBase
      .slice(
        0,
        Math.max(
          1,
          48 - suffix.length - 1
        )
      )
      .replace(/-+$/g, "");

  const candidate =
    `${trimmedBase}-${suffix}`;

  if (
    !await slugTaken(
      candidate,
      projectId
    )
  ) {
    return candidate;
  }

  const error = new Error(
    "A unique website address could not be created."
  );

  error.status = 409;
  throw error;
}

function buildPublishedUrl(
  req,
  project,
  slug,
  publish
) {
  if (!publish) {
    return null;
  }

  const customDomain =
    text(project.custom_domain)
      .toLowerCase()
      .replace(/^https?:\/\//, "")
      .replace(/\/.*$/, "")
      .replace(/^www\./, "");

  if (
    customDomain &&
    project.domain_status === "connected"
  ) {
    return `https://${customDomain}`;
  }

  return (
    `${requestOrigin(req)}` +
    `/site/${encodeURIComponent(slug)}`
  );
}

function protectProjectData(
  projectData,
  {
    projectId,
    userId,
    published,
    publishedUrl,
    slug,
    updatedAt
  }
) {
  const source =
    projectData &&
    typeof projectData === "object" &&
    !Array.isArray(projectData)
      ? projectData
      : {};

  const projectSettings =
    source.project &&
    typeof source.project === "object" &&
    !Array.isArray(source.project)
      ? source.project
      : {};

  const backend =
    source.backend &&
    typeof source.backend === "object" &&
    !Array.isArray(source.backend)
      ? source.backend
      : {};

  return {
    ...source,

    project: {
      ...projectSettings,
      slug
    },

    backend: {
      ...backend,
      userId,
      websiteId: projectId,
      published,
      publishedUrl,
      updatedAt
    }
  };
}

export default async function handler(
  req,
  res
) {
  if (req.method === "OPTIONS") {
    res.setHeader(
      "Allow",
      "POST, OPTIONS"
    );

    return res
      .status(204)
      .end();
  }

  if (req.method !== "POST") {
    res.setHeader(
      "Allow",
      "POST, OPTIONS"
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
  }

  try {
    const user =
      await requireUser(req);

    const projectId =
      projectIdFrom(req);

    const publish =
      parsePublishValue(
        req.body?.publish
      );

    if (!projectId) {
      return sendJson(
        res,
        400,
        {
          ok: false,
          error:
            "A website project is required."
        }
      );
    }

    if (publish === null) {
      return sendJson(
        res,
        400,
        {
          ok: false,
          error:
            "Publish must be true or false."
        }
      );
    }

    const project =
      await getOwnedProject(
        projectId,
        user.id
      );

    let slug =
      cleanSlug(
        project.slug ||
        requestedSlugFrom(req) ||
        project.name
      );

    if (publish) {
      slug =
        await uniqueSlug(
          slug,
          project.id
        );
    }

    const now =
      new Date().toISOString();

    const publishedUrl =
      buildPublishedUrl(
        req,
        project,
        slug,
        publish
      );

    const protectedProjectData =
      protectProjectData(
        project.project_data,
        {
          projectId:
            project.id,
          userId:
            user.id,
          published:
            publish,
          publishedUrl,
          slug,
          updatedAt:
            now
        }
      );

    const {
      data: updatedProject,
      error: updateError
    } = await admin
      .from("projects")
      .update({
        slug,
        published:
          publish,
        published_url:
          publishedUrl,
        project_data:
          protectedProjectData,
        updated_at:
          now
      })
      .eq(
        "id",
        project.id
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
          "created_at",
          "updated_at"
        ].join(",")
      )
      .single();

    if (updateError) {
      throw updateError;
    }

    return sendJson(
      res,
      200,
      {
        ok: true,
        projectId:
          updatedProject.id,
        published:
          updatedProject.published === true,
        slug:
          updatedProject.slug,
        url:
          updatedProject.published_url,
        project:
          updatedProject,
        message:
          updatedProject.published
            ? "Website published successfully."
            : "Website unpublished successfully."
      }
    );
  } catch (error) {
    console.error(
      "Publish site API error:",
      error
    );

    return sendError(
      res,
      error
    );
  }
}
