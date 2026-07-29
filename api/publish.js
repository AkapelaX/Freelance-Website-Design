"use strict";

const { getAdmin } = require("./_supabase");
const { requireUser, requireProjectOwner } = require("./_auth");
const {
  ok,
  fail,
  method,
  action,
  parseJsonBody,
  text,
  publicBaseUrl,
  handleError
} = require("./_utils");

module.exports = async function handler(req, res) {
  try {
    const name = action(req, "publish");
    const body = parseJsonBody(req);
    const user = await requireUser(req);
    const supabase = getAdmin();

    if (name === "publish") {
      method(req, ["POST"]);
      const projectId = text(body.project_id, 80);
      const project = await requireProjectOwner(projectId, user.id);

      const publishedAt = new Date().toISOString();
      const publicUrl = project.custom_domain && project.domain_status === "verified"
        ? `https://${project.custom_domain}`
        : `${publicBaseUrl(req)}/public-site.html?slug=${encodeURIComponent(project.slug)}`;

      const { error: publicError } = await supabase
        .from("published_sites")
        .upsert({
          project_id: project.id,
          user_id: user.id,
          slug: project.slug,
          custom_domain: project.custom_domain,
          site_data: project.project_data || {},
          plan: project.plan,
          published_at: publishedAt,
          updated_at: publishedAt
        }, { onConflict: "project_id" });
      if (publicError) throw publicError;

      const { data, error } = await supabase
        .from("projects")
        .update({
          status: "published",
          published_url: publicUrl,
          published_at: publishedAt,
          updated_at: publishedAt
        })
        .eq("id", projectId)
        .eq("user_id", user.id)
        .select("*")
        .single();
      if (error) throw error;

      return ok(res, {
        project: { ...data, data: data.project_data || {} },
        url: publicUrl
      });
    }

    if (name === "unpublish") {
      method(req, ["POST"]);
      const projectId = text(body.project_id, 80);
      await requireProjectOwner(projectId, user.id);
      await supabase.from("published_sites").delete().eq("project_id", projectId);
      await supabase.from("projects").update({
        status: "draft",
        published_url: null,
        updated_at: new Date().toISOString()
      }).eq("id", projectId).eq("user_id", user.id);
      return ok(res, { unpublished: true });
    }

    return fail(res, 404, "Unknown publish action");
  } catch (error) {
    return handleError(res, error);
  }
};
