"use strict";

const { getAdmin, getAnon } = require("./_supabase");
const { requireUser } = require("./_auth");
const {
  ok,
  created,
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
    const name = action(req, "health");
    const body = parseJsonBody(req);

    if (name === "health") {
      method(req, ["GET"]);
      return ok(res, { ok: true, service: "auth" });
    }

    if (name === "signup") {
      method(req, ["POST"]);
      const email = text(body.email, 320).toLowerCase();
      const password = String(body.password || "");
      const fullName = text(body.full_name, 120);

      if (!email.includes("@")) return fail(res, 400, "Valid email required");
      if (password.length < 8) return fail(res, 400, "Password must be at least 8 characters");

      const supabase = getAnon();
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: { full_name: fullName },
          emailRedirectTo: `${publicBaseUrl(req)}/#projects`
        }
      });

      if (error) return fail(res, 400, error.message);

      if (data.user) {
        const admin = getAdmin();
        await admin.from("profiles").upsert({
          id: data.user.id,
          email,
          full_name: fullName,
          plan: "starter",
          subscription_status: "inactive",
          updated_at: new Date().toISOString()
        });
      }

      return created(res, {
        user: data.user,
        session: data.session,
        requires_email_confirmation: !data.session
      });
    }

    if (name === "signin") {
      method(req, ["POST"]);
      const supabase = getAnon();
      const { data, error } = await supabase.auth.signInWithPassword({
        email: text(body.email, 320).toLowerCase(),
        password: String(body.password || "")
      });
      if (error) return fail(res, 401, error.message);
      return ok(res, data);
    }

    if (name === "signout") {
      method(req, ["POST"]);
      await requireUser(req);
      return ok(res, { signed_out: true });
    }

    if (name === "session") {
      method(req, ["GET"]);
      const user = await requireUser(req);
      return ok(res, { user });
    }

    if (name === "profile") {
      method(req, ["GET"]);
      const user = await requireUser(req);
      const admin = getAdmin();
      const { data, error } = await admin
        .from("profiles")
        .select("*")
        .eq("id", user.id)
        .single();

      if (error && error.code !== "PGRST116") throw error;
      return ok(res, {
        profile: data || {
          id: user.id,
          email: user.email,
          full_name: user.user_metadata?.full_name || "",
          plan: "starter",
          subscription_status: "inactive"
        }
      });
    }

    if (name === "reset-password") {
      method(req, ["POST"]);
      const email = text(body.email, 320).toLowerCase();
      const supabase = getAnon();
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: text(body.redirect_to, 1000) || `${publicBaseUrl(req)}/#home`
      });
      if (error) return fail(res, 400, error.message);
      return ok(res, { sent: true });
    }

    if (name === "update-password") {
      method(req, ["POST"]);
      const user = await requireUser(req);
      const password = String(body.password || "");
      if (password.length < 8) return fail(res, 400, "Password must be at least 8 characters");
      const admin = getAdmin();
      const { error } = await admin.auth.admin.updateUserById(user.id, { password });
      if (error) return fail(res, 400, error.message);
      return ok(res, { updated: true });
    }

    return fail(res, 404, "Unknown auth action");
  } catch (error) {
    return handleError(res, error);
  }
};
