function send(res, status, body) {
  res.status(status).json(body);
}

function cleanSlug(value) {
  return String(value || "website")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48) || "website";
}

async function getAuthenticatedUser(supabaseUrl, anonKey, authorization) {
  const response = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: { apikey: anonKey, Authorization: authorization }
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
    return send(res, 500, { error: "Publishing service is not configured." });
  }

  const user = await getAuthenticatedUser(supabaseUrl, anonKey, authorization);
  if (!user || !user.id) return send(res, 401, { error: "Please sign in again." });

  const projectId = String(req.body?.projectId || "");
  const publish = Boolean(req.body?.publish);
  if (!projectId) return send(res, 400, { error: "A website project is required." });

  const projectQuery = new URLSearchParams({
    select: "id,owner_id,name,slug,status",
    id: `eq.${projectId}`,
    owner_id: `eq.${user.id}`,
    limit: "1"
  });
  const projectResponse = await fetch(`${supabaseUrl}/rest/v1/website_projects?${projectQuery}`, {
    headers: { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}` }
  });
  if (!projectResponse.ok) return send(res, 500, { error: "The website could not be verified." });
  const project = (await projectResponse.json())[0];
  if (!project) return send(res, 404, { error: "Website not found." });

  let slug = project.slug || cleanSlug(req.body?.requestedSlug || project.name);
  if (publish) {
    const collisionQuery = new URLSearchParams({
      select: "id",
      slug: `eq.${slug}`,
      id: `neq.${projectId}`,
      limit: "1"
    });
    const collisionResponse = await fetch(`${supabaseUrl}/rest/v1/website_projects?${collisionQuery}`, {
      headers: { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}` }
    });
    const collision = collisionResponse.ok ? (await collisionResponse.json())[0] : null;
    if (collision) slug = `${slug}-${projectId.replace(/-/g, "").slice(-8)}`;
  }

  const updateResponse = await fetch(`${supabaseUrl}/rest/v1/website_projects?id=eq.${encodeURIComponent(projectId)}&owner_id=eq.${encodeURIComponent(user.id)}`, {
    method: "PATCH",
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      "Content-Type": "application/json",
      Prefer: "return=representation"
    },
    body: JSON.stringify({
      status: publish ? "published" : "draft",
      slug: publish ? slug : project.slug
    })
  });

  if (!updateResponse.ok) {
    const detail = await updateResponse.text();
    console.error("Website publishing update failed:", detail);
    return send(res, 500, { error: "The publishing update failed." });
  }

  return send(res, 200, {
    published: publish,
    slug,
    url: `${req.headers["x-forwarded-proto"] || "https"}://${req.headers.host}/site/${encodeURIComponent(slug)}`
  });
}
