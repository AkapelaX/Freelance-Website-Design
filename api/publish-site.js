function send(res, status, body) {
  res.status(status).json(body);
}

function cleanSlug(value) {
  return (
    String(value || "website")
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 48) || "website"
  );
}

function parsePublishValue(value) {
  if (value === true || value === "true" || value === 1 || value === "1") {
    return true;
  }

  if (
    value === false ||
    value === "false" ||
    value === 0 ||
    value === "0"
  ) {
    return false;
  }

  return null;
}

async function getAuthenticatedUser(
  supabaseUrl,
  anonKey,
  authorization
) {
  const response = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: {
      apikey: anonKey,
      Authorization: authorization
    }
  });

  if (!response.ok) {
    return null;
  }

  return response.json();
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");

    return send(res, 405, {
      error: "Method not allowed."
    });
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
    return send(res, 401, {
      error: "Please sign in again."
    });
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
      error: "A valid publish status is required."
    });
  }

  const projectQuery = new URLSearchParams({
    select: "id,owner_id,name,slug,status",
    id: `eq.${projectId}`,
    owner_id: `eq.${user.id}`,
    limit: "1"
  });

  const projectResponse = await fetch(
    `${supabaseUrl}/rest/v1/website_projects?${projectQuery.toString()}`,
    {
      method: "GET",
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
        Accept: "application/json"
      }
    }
  );

  if (!projectResponse.ok) {
    const detail = await projectResponse.text();

    console.error("Website verification failed:", detail);

    return send(res, 500, {
      error: "The website could not be verified."
    });
  }

  const projects = await projectResponse.json();
  const project = Array.isArray(projects) ? projects[0] : null;

  if (!project) {
    return send(res, 404, {
      error: "Website not found."
    });
  }

  let slug =
    project.slug ||
    cleanSlug(req.body?.requestedSlug || project.name);

  if (publish) {
    const collisionQuery = new URLSearchParams({
      select: "id",
      slug: `eq.${slug}`,
      id: `neq.${projectId}`,
      limit: "1"
    });

    const collisionResponse = await fetch(
      `${supabaseUrl}/rest/v1/website_projects?${collisionQuery.toString()}`,
      {
        method: "GET",
        headers: {
          apikey: serviceRoleKey,
          Authorization: `Bearer ${serviceRoleKey}`,
          Accept: "application/json"
        }
      }
    );

    if (!collisionResponse.ok) {
      const detail = await collisionResponse.text();

      console.error("Slug collision check failed:", detail);

      return send(res, 500, {
        error: "The website address could not be verified."
      });
    }

    const collisions = await collisionResponse.json();
    const collision = Array.isArray(collisions)
      ? collisions[0]
      : null;

    if (collision) {
      slug = `${slug}-${projectId
        .replace(/-/g, "")
        .slice(-8)}`;
    }
  }

  const updateBody = {
    status: publish ? "published" : "draft"
  };

  if (publish) {
    updateBody.slug = slug;
  }

  const updateQuery = new URLSearchParams({
    id: `eq.${projectId}`,
    owner_id: `eq.${user.id}`
  });

  const updateResponse = await fetch(
    `${supabaseUrl}/rest/v1/website_projects?${updateQuery.toString()}`,
    {
      method: "PATCH",
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
        "Content-Type": "application/json",
        Prefer: "return=representation"
      },
      body: JSON.stringify(updateBody)
    }
  );

  if (!updateResponse.ok) {
    const detail = await updateResponse.text();

    console.error(
      publish
        ? "Website publishing update failed:"
        : "Website unpublishing update failed:",
      detail
    );

    return send(res, 500, {
      error: publish
        ? "The website could not be published."
        : "The website could not be unpublished."
    });
  }

  const updatedProjects = await updateResponse.json();
  const updatedProject = Array.isArray(updatedProjects)
    ? updatedProjects[0]
    : null;

  if (!updatedProject) {
    return send(res, 500, {
      error: publish
        ? "The website was not published."
        : "The website was not unpublished."
    });
  }

  const protocol =
    String(req.headers["x-forwarded-proto"] || "https")
      .split(",")[0]
      .trim();

  const host = req.headers.host || "";

  const finalSlug = updatedProject.slug || project.slug || slug;

  return send(res, 200, {
    success: true,
    published: updatedProject.status === "published",
    status: updatedProject.status,
    slug: finalSlug,
    url:
      finalSlug && host
        ? `${protocol}://${host}/site/${encodeURIComponent(finalSlug)}`
        : "",
    message:
      updatedProject.status === "published"
        ? "Website published successfully."
        : "Website unpublished successfully."
  });
}