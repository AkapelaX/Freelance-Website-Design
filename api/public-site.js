const JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "public, max-age=30, s-maxage=60, stale-while-revalidate=300"
};

function send(res, status, body) {
  res.status(status);
  Object.entries(JSON_HEADERS).forEach(([key, value]) => res.setHeader(key, value));
  res.json(body);
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return send(res, 405, { error: "Method not allowed." });
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    return send(res, 500, { error: "Publishing service is not configured." });
  }

  const slug = String(req.query.slug || "").trim().toLowerCase();
  const host = String(req.query.host || "").trim().toLowerCase().replace(/^www\./, "");
  if (!slug && !host) {
    return send(res, 400, { error: "A website slug or domain is required." });
  }

  const field = host ? "custom_domain" : "slug";
  const value = host || slug;
  const query = new URLSearchParams({
    select: "id,name,slug,custom_domain,project_data,status,updated_at",
    status: "eq.published",
    [field]: `eq.${value}`,
    limit: "1"
  });

  const response = await fetch(`${supabaseUrl}/rest/v1/website_projects?${query.toString()}`, {
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`
    }
  });

  if (!response.ok) {
    const detail = await response.text();
    console.error("Published website lookup failed:", detail);
    return send(res, 500, { error: "The website could not be loaded." });
  }

  const rows = await response.json();
  const row = rows[0];
  if (!row) {
    return send(res, 404, { error: "This website is not published." });
  }

  const state = row.project_data && typeof row.project_data === "object" ? row.project_data : {};
  return send(res, 200, {
    website: {
      id: row.id,
      name: row.name,
      slug: row.slug,
      customDomain: row.custom_domain,
      updatedAt: row.updated_at,
      state
    }
  });
}
