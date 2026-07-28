"use strict";

const { getAdmin } = require("./_supabase");
const { requireUser, requireProjectOwner } = require("./_auth");
const {
  ok,
  created,
  fail,
  method,
  action,
  parseJsonBody,
  text,
  slugify,
  handleError
} = require("./_utils");

function projectPayload(source, userId) {
  const project = source && typeof source === "object" ? source : {};
  const data = project.data && typeof project.data === "object" ? project.data : {};

  return {
    user_id: userId,
    name: text(project.name || data.businessName, 160) || "Untitled Website",
    slug: slugify(project.slug || project.name || data.businessName),
    plan: ["starter", "professional", "advanced"].includes(project.plan)
      ? project.plan
      : "starter",
    status: ["draft", "published", "archived"].includes(project.status)
      ? project.status
      : "draft",
    project_data: data,
    custom_domain: text(project.custom_domain || project.customDomain, 253) || null,
    domain_status: text(project.domain_status, 40) || "not_connected",
    ssl_status: text(project.ssl_status, 40) || "waiting",
    owned: Boolean(project.owned),
    updated_at: new Date().toISOString()
  };
}

module.exports = async function handler(req, res) {
  try {
    const name = action(req, "list");
    const body = parseJsonBody(req);
    const user = await requireUser(req);
    const supabase = getAdmin();

    if (name === "list") {
      method(req, ["GET"]);
      const { data, error } = await supabase
        .from("projects")
        .select("*, project_snapshots(*)")
        .eq("user_id", user.id)
        .order("updated_at", { ascending: false });

      if (error) throw error;
      const projects = (data || []).map((row) => ({
        ...row,
        data: row.project_data || {},
        snapshots: row.project_snapshots || []
      }));
      return ok(res, { projects });
    }

    if (name === "get") {
      method(req, ["GET"]);
      const project = await requireProjectOwner(text(req.query.id, 80), user.id);
      return ok(res, { project: { ...project, data: project.project_data || {} } });
    }

    if (name === "create") {
      method(req, ["POST"]);
      const input = body.project || body;
      const payload = projectPayload(input, user.id);

      const { data, error } = await supabase
        .from("projects")
        .insert(payload)
        .select("*")
        .single();

      if (error) {
        if (error.code === "23505") {
          payload.slug = `${payload.slug}-${Math.random().toString(36).slice(2, 6)}`;
          const retry = await supabase.from("projects").insert(payload).select("*").single();
          if (retry.error) throw retry.error;
          return created(res, { project: { ...retry.data, data: retry.data.project_data || {} } });
        }
        throw error;
      }

      return created(res, { project: { ...data, data: data.project_data || {} } });
    }

    if (name === "save") {
      method(req, ["POST", "PUT"]);
      const input = body.project || body;
      let projectId = text(input.id, 80);

      if (!projectId) {
        const payload = projectPayload(input, user.id);
        const { data, error } = await supabase
          .from("projects")
          .insert(payload)
          .select("*")
          .single();
        if (error) throw error;
        return created(res, { project: { ...data, data: data.project_data || {} } });
      }

      await requireProjectOwner(projectId, user.id);
      const payload = projectPayload(input, user.id);
      delete payload.user_id;

      const { data, error } = await supabase
        .from("projects")
        .update(payload)
        .eq("id", projectId)
        .eq("user_id", user.id)
        .select("*")
        .single();

      if (error) throw error;
      return ok(res, { project: { ...data, data: data.project_data || {} } });
    }

    if (name === "snapshot") {
      method(req, ["POST"]);
      const projectId = text(body.project_id, 80);
      await requireProjectOwner(projectId, user.id);

      const snapshot = body.snapshot || {};
      const { data, error } = await supabase
        .from("project_snapshots")
        .insert({
          project_id: projectId,
          user_id: user.id,
          name: text(snapshot.name, 180) || `Snapshot ${new Date().toLocaleString()}`,
          snapshot_data: snapshot.data || {},
          created_at: new Date().toISOString()
        })
        .select("*")
        .single();

      if (error) throw error;
      return created(res, { snapshot: { ...data, data: data.snapshot_data || {} } });
    }

    if (name === "delete") {
      method(req, ["DELETE", "POST"]);
      const projectId = text(req.query.id || body.project_id, 80);
      await requireProjectOwner(projectId, user.id);
      const { error } = await supabase
        .from("projects")
        .delete()
        .eq("id", projectId)
        .eq("user_id", user.id);
      if (error) throw error;
      return ok(res, { deleted: true });
    }

    return fail(res, 404, "Unknown projects action");
  } catch (error) {
    return handleError(res, error);
  }
};
