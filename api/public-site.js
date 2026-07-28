"use strict";

const { getAdmin } = require("./_supabase");
const { ok, fail, method, text, normalizeDomain, handleError } = require("./_utils");

module.exports = async function handler(req, res) {
  try {
    method(req, ["GET"]);
    const supabase = getAdmin();
    const slug = text(req.query.slug, 80);
    const domain = normalizeDomain(req.query.domain || req.query.host);

    let query = supabase.from("published_sites").select("*");
    if (slug) query = query.eq("slug", slug);
    else if (domain) query = query.eq("custom_domain", domain);
    else return fail(res, 400, "slug or domain is required");

    const { data, error } = await query.single();
    if (error || !data) return fail(res, 404, "Published website not found");

    return ok(res, {
      site: {
        project_id: data.project_id,
        slug: data.slug,
        custom_domain: data.custom_domain,
        plan: data.plan,
        published_at: data.published_at,
        data: data.site_data || {}
      }
    });
  } catch (error) {
    return handleError(res, error);
  }
};
