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

async function createUniquePublishedSlug(supabase, requestedSlug, projectId) {
  const baseSlug = text(requestedSlug, 80) || "untitled-website";
  let candidate = baseSlug;
  let number = 2;

  while (true) {
    const { data, error } = await supabase
      .from("published_sites")
      .select("project_id")
      .eq("slug", candidate)
      .neq("project_id", projectId)
      .limit(1);

    if (error) {
      throw error;
    }

    if (!data || data.length === 0) {
      return candidate;
    }

    const suffix = `-${number}`;
    const maximumBaseLength = 80 - suffix.length;
    candidate = `${baseSlug.slice(0, maximumBaseLength)}${suffix}`;
    number += 1;
  }
}

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

      const publishedSlug = await createUniquePublishedSlug(
        supabase,
        project.slug,
        project.id
      );

      const publicUrl =
        project.custom_domain && project.domain_status === "verified"
          ? `https://${project.custom_domain}`
          : `${publicBaseUrl(req)}/public-site.html?slug=${encodeURIComponent(
              publishedSlug
            )}`;

      const { error: publicError } = await supabase
        .from("published_sites")
        .upsert(
          {
            project_id: project.id,
            user_id: user.id,
            slug: publishedSlug,
            custom_domain: project.custom_domain,
            site_data: project.project_data || {},
            plan: project.plan,
            published_at: publishedAt,
            updated_at: publishedAt
          },
          {
            onConflict: "project_id"
          }
        );

      if (publicError) {
        throw publicError;
      }

      const { data, error } = await supabase
        .from("projects")
        .update({
          slug: publishedSlug,
          status: "published",
          published_url: publicUrl,
          published_at: publishedAt,
          updated_at: publishedAt
        })
        .eq("id", projectId)
        .eq("user_id", user.id)
        .select("*")
        .single();

      if (error) {
        throw error;
      }

      return ok(res, {
        project: {
          ...data,
          data: data.project_data || {}
        },
        url: publicUrl
      });
    }

    if (name === "unpublish") {
      method(req, ["POST"]);

      const projectId = text(body.project_id, 80);

      await requireProjectOwner(projectId, user.id);

      const { error: deleteError } = await supabase
        .from("published_sites")
        .delete()
        .eq("project_id", projectId);

      if (deleteError) {
        throw deleteError;
      }

      const { error: updateError } = await supabase
        .from("projects")
        .update({
          status: "draft",
          published_url: null,
          updated_at: new Date().toISOString()
        })
        .eq("id", projectId)
        .eq("user_id", user.id);

      if (updateError) {
        throw updateError;
      }

      return ok(res, {
        unpublished: true
      });
    }

    return fail(res, 404, "Unknown publish action");
  } catch (error) {
    return handleError(res, error);
  }
};