"use strict";

const { createClient } = require("@supabase/supabase-js");
const { requiredEnv } = require("./_utils");

let adminClient;
let anonClient;

function getAdmin() {
  requiredEnv(["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]);
  if (!adminClient) {
    adminClient = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
          detectSessionInUrl: false
        }
      }
    );
  }
  return adminClient;
}

function getAnon() {
  requiredEnv(["SUPABASE_URL", "SUPABASE_ANON_KEY"]);
  if (!anonClient) {
    anonClient = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_ANON_KEY,
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
          detectSessionInUrl: false
        }
      }
    );
  }
  return anonClient;
}

async function single(query, notFoundMessage = "Record not found") {
  const { data, error } = await query.single();
  if (error) {
    const err = new Error(error.code === "PGRST116" ? notFoundMessage : error.message);
    err.status = error.code === "PGRST116" ? 404 : 400;
    throw err;
  }
  return data;
}

module.exports = { getAdmin, getAnon, single };
