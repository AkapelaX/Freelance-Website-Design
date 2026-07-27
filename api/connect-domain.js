function send(res, status, body) {
  res.status(status).json(body);
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
  const vercelToken = process.env.VERCEL_TOKEN;
  const vercelProjectId = process.env.VERCEL_PROJECT_ID;
  const vercelTeamId = process.env.VERCEL_TEAM_ID || "";
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return send(res, 500, { error: "Supabase publishing variables are missing." });
  }
  if (!vercelToken || !vercelProjectId) {
    return send(res, 500, { error: "Add VERCEL_TOKEN and VERCEL_PROJECT_ID before connecting custom domains." });
  }

  const authorization = req.headers.authorization || "";
  const user = await getAuthenticatedUser(supabaseUrl, anonKey, authorization);
  if (!user || !user.id) return send(res, 401, { error: "Please sign in again." });

  const projectId = String(req.body?.projectId || "");
  const domain = String(req.body?.domain || "").toLowerCase().trim().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");
  if (!projectId || !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i.test(domain)) {
    return send(res, 400, { error: "Enter a valid domain." });
  }

  const ownerQuery = new URLSearchParams({
    select: "id",
    id: `eq.${projectId}`,
    owner_id: `eq.${user.id}`,
    limit: "1"
  });
  const ownerResponse = await fetch(`${supabaseUrl}/rest/v1/website_projects?${ownerQuery}`, {
    headers: { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}` }
  });
  if (!ownerResponse.ok || !(await ownerResponse.json())[0]) {
    return send(res, 404, { error: "Website not found." });
  }

  const teamQuery = vercelTeamId ? `?teamId=${encodeURIComponent(vercelTeamId)}` : "";
  const addResponse = await fetch(`https://api.vercel.com/v10/projects/${encodeURIComponent(vercelProjectId)}/domains${teamQuery}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${vercelToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ name: domain })
  });
  const addData = await addResponse.json().catch(() => ({}));
  if (!addResponse.ok && addData.error?.code !== "domain_already_in_use" && addData.error?.code !== "domain_already_exists") {
    return send(res, addResponse.status, { error: addData.error?.message || "Vercel rejected the domain." });
  }

  const verifyResponse = await fetch(`https://api.vercel.com/v9/projects/${encodeURIComponent(vercelProjectId)}/domains/${encodeURIComponent(domain)}/verify${teamQuery}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${vercelToken}` }
  });
  const verifyData = await verifyResponse.json().catch(() => ({}));
  const verified = Boolean(verifyResponse.ok && (verifyData.verified || verifyData.name));

  const updateResponse = await fetch(`${supabaseUrl}/rest/v1/website_projects?id=eq.${encodeURIComponent(projectId)}&owner_id=eq.${encodeURIComponent(user.id)}`, {
    method: "PATCH",
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      custom_domain: domain,
      domain_status: verified ? "connected" : "waiting"
    })
  });
  if (!updateResponse.ok) return send(res, 500, { error: "The domain was added, but its project record could not be updated." });

  return send(res, 200, {
    domain,
    verified,
    configuredBy: addData.configuredBy || null,
    verification: addData.verification || verifyData.verification || []
  });
}
