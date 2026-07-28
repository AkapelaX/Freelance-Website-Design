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
  safeFilename,
  handleError
} = require("./_utils");

const BUCKET = process.env.SUPABASE_STORAGE_BUCKET || "website-media";
const MAX_BYTES = 25 * 1024 * 1024;

function decodeDataUrl(value) {
  const match = String(value || "").match(/^data:([^;,]+)?(;base64)?,(.*)$/s);
  if (!match) return null;
  const mime = match[1] || "application/octet-stream";
  const encoded = match[3] || "";
  const buffer = match[2] ? Buffer.from(encoded, "base64") : Buffer.from(decodeURIComponent(encoded));
  return { mime, buffer };
}

module.exports = async function handler(req, res) {
  try {
    const name = action(req, "upload");
    const body = parseJsonBody(req);
    const user = await requireUser(req);
    const supabase = getAdmin();

    if (name === "upload") {
      method(req, ["POST"]);
      const projectId = text(body.project_id, 80);
      await requireProjectOwner(projectId, user.id);

      const decoded = decodeDataUrl(body.data_url);
      if (!decoded) return fail(res, 400, "A valid data_url is required");
      if (decoded.buffer.length > MAX_BYTES) return fail(res, 413, "File exceeds 25 MB");

      const originalName = safeFilename(body.filename || "upload");
      const extension = text(body.extension, 12).replace(/[^a-z0-9]/gi, "") ||
        (decoded.mime.split("/")[1] || "bin").split("+")[0];
      const path = `${user.id}/${projectId}/${Date.now()}-${originalName}.${extension}`;

      const { error } = await supabase.storage
        .from(BUCKET)
        .upload(path, decoded.buffer, {
          contentType: decoded.mime,
          upsert: false,
          cacheControl: "3600"
        });

      if (error) throw error;

      const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
      await supabase.from("media_assets").insert({
        user_id: user.id,
        project_id: projectId,
        storage_path: path,
        public_url: data.publicUrl,
        mime_type: decoded.mime,
        original_name: text(body.filename, 255),
        size_bytes: decoded.buffer.length
      });

      return created(res, {
        path,
        url: data.publicUrl,
        mime_type: decoded.mime,
        size_bytes: decoded.buffer.length
      });
    }

    if (name === "list") {
      method(req, ["GET"]);
      const projectId = text(req.query.project_id, 80);
      await requireProjectOwner(projectId, user.id);
      const { data, error } = await supabase
        .from("media_assets")
        .select("*")
        .eq("project_id", projectId)
        .eq("user_id", user.id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return ok(res, { media: data || [] });
    }

    if (name === "delete") {
      method(req, ["DELETE", "POST"]);
      const assetId = text(req.query.id || body.id, 80);
      const { data: asset, error: findError } = await supabase
        .from("media_assets")
        .select("*")
        .eq("id", assetId)
        .eq("user_id", user.id)
        .single();
      if (findError || !asset) return fail(res, 404, "Media asset not found");

      await supabase.storage.from(BUCKET).remove([asset.storage_path]);
      const { error } = await supabase
        .from("media_assets")
        .delete()
        .eq("id", assetId)
        .eq("user_id", user.id);
      if (error) throw error;
      return ok(res, { deleted: true });
    }

    return fail(res, 404, "Unknown media action");
  } catch (error) {
    return handleError(res, error);
  }
};
