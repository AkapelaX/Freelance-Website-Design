"use strict";

function send(res, status, body) {
  res.status(status).json(body);
}

function cleanSlug(value) {
  return String(value || "website")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48) || "website";
}

function parsePublishValue(value) {
  if (value === true || value === 1 || value === "1") return true;
  if (value === false || value === 0 || value === "0") return false;

  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true" || normalized === "publish" || normalized === "published") {
      return true;
    }
    if (normalized === "false" || normalized === "unpublish" || normalized === "draft") {
      return false;
    }
  }

  return null;
}

async function getAuthenticatedUser(supabaseUrl, anonKey, authorization) {
  if (!authorization.toLowerCase().startsWith("bearer ")) return null;

  const response = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: {
      apikey: anonKey,
      Authorization: authorization
    }
  });

  if (!response.ok) return null;
  return response.json();
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return send(res, 405, { error: "Method not allowed." });
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const authorization = req.headers.authorization || "";

  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return send(res, 500, {
      error: "Publishing service is not configured."
    });
  }

  const user = await getAuthenticatedUser(
    supabaseUrl,
    anonKey,
    authorization
  );

  if (!user || !user.id) {
    return send(res, 401, { error: "Please sign in again." });
  }

  const projectId = String(req.body?.projectId || "").trim();
  const publish = parsePublishValue(req.body?.publish);

  if (!projectId) {
    return send(res, 400, {
      error: "A website project is required."
    });
  }

  if (publish === null) {
    return send(res, 400, {
      error: "Publish must be true or false."
    });
  }

  const projectQuery = new URLSearchParams({
    select: "id,owner_id,name,slug,status",
    id: `eq.${projectId}`,
    owner_id: `eq.${user.id}`,
    limit: "1"
  });

  const projectResponse = await fetch(
    `${supabaseUrl}/rest/v1/website_projects?${projectQuery}`,
    {
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`
      }
    }
  );

  if (!projectResponse.ok) {
    console.error(
      "Website verification failed:",
      await projectResponse.text()
    );
    return send(res, 500, {
      error: "The website could not be verified."
    });
  }

  const projectRows = await projectResponse.json();
  const project = projectRows[0];

  if (!project) {
    return send(res, 404, { error: "Website not found." });
  }

  let slug = cleanSlug(
    project.slug ||
    req.body?.requestedSlug ||
    project.name
  );

  if (publish) {
    const collisionQuery = new URLSearchParams({
      select: "id",
      slug: `eq.${slug}`,
      id: `neq.${projectId}`,
      limit: "1"
    });

    const collisionResponse = await fetch(
      `${supabaseUrl}/rest/v1/website_projects?${collisionQuery}`,
      {
        headers: {
          apikey: serviceRoleKey,
          Authorization: `Bearer ${serviceRoleKey}`
        }
      }
    );

    if (!collisionResponse.ok) {
      console.error(
        "Slug collision check failed:",
        await collisionResponse.text()
      );
      return send(res, 500, {
        error: "The website address could not be verified."
      });
    }

    const collision = (await collisionResponse.json())[0];

    if (collision) {
      slug = `${slug}-${projectId.replace(/-/g, "").slice(-8)}`;
    }
  }

  const patchBody = {
    status: publish ? "published" : "draft"
  };

  if (publish || !project.slug) {
    patchBody.slug = slug;
  }

  const updateResponse = await fetch(
    `${supabaseUrl}/rest/v1/website_projects` +
      `?id=eq.${encodeURIComponent(projectId)}` +
      `&owner_id=eq.${encodeURIComponent(user.id)}`,
    {
      method: "PATCH",
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
        "Content-Type": "application/json",
        Prefer: "return=representation"
      },
      body: JSON.stringify(patchBody)
    }
  );

  if (!updateResponse.ok) {
    console.error(
      "Website publishing update failed:",
      await updateResponse.text()
    );
    return send(res, 500, {
      error: publish
        ? "The website could not be published."
        : "The website could not be unpublished."
    });
  }

  const updatedRows = await updateResponse.json();
  const updatedProject = updatedRows[0];

  if (!updatedProject) {
    return send(res, 500, {
      error: "The publishing update returned no website."
    });
  }

  const published = updatedProject.status === "published";
  const finalSlug = cleanSlug(updatedProject.slug || slug);
  const protocol = String(
    req.headers["x-forwarded-proto"] || "https"
  ).split(",")[0].trim();
  const host = req.headers.host;

  return send(res, 200, {
    ok: true,
    projectId: updatedProject.id,
    published,
    status: updatedProject.status,
    slug: finalSlug,
    url: `${protocol}://${host}/site/${encodeURIComponent(finalSlug)}`
  });
}
