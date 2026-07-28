"use strict";

const { getAdmin } = require("../_supabase");

function bearer(req) {
  const header = req.headers.authorization || "";
  return header.startsWith("Bearer ") ? header.slice(7).trim() : "";
}

async function requireUser(req) {
  const token = bearer(req);
  if (!token) {
    const error = new Error("Authentication required");
    error.status = 401;
    throw error;
  }

  const supabase = getAdmin();
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) {
    const authError = new Error("Invalid or expired session");
    authError.status = 401;
    throw authError;
  }

  return data.user;
}

async function optionalUser(req) {
  try {
    return await requireUser(req);
  } catch {
    return null;
  }
}

async function requireProjectOwner(projectId, userId) {
  const supabase = getAdmin();
  const { data, error } = await supabase
    .from("projects")
    .select("*")
    .eq("id", projectId)
    .eq("user_id", userId)
    .single();

  if (error || !data) {
    const projectError = new Error("Website project not found");
    projectError.status = 404;
    throw projectError;
  }

  return data;
}

module.exports = { bearer, requireUser, optionalUser, requireProjectOwner };
