const {
  send,
  authenticatedUser,
  getOwnedProject,
  listOwnedProjects,
  errorResponse
} = require("./_lib/domain-utils");

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return send(res, 405, { error: "Method not allowed." });
  }

  try {
    const user = await authenticatedUser(req);
    const projectId = String(req.query?.project_id || "").trim();

    if (projectId) {
      const project = await getOwnedProject(projectId, user.id);
      return send(res, 200, { ok: true, domain: project });
    }

    const projects = await listOwnedProjects(user.id);
    return send(res, 200, { ok: true, projects });
  } catch (error) {
    return errorResponse(res, error);
  }
};
