"use strict";

export default function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ ok: false, error: "Method not allowed." });
  }

  const present = (name) => Boolean(process.env[name] && String(process.env[name]).trim());
  const browserKey = present("SUPABASE_ANON_KEY") || present("SUPABASE_PUBLISHABLE_KEY") || present("NEXT_PUBLIC_SUPABASE_ANON_KEY") || present("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
  const serverKey = present("SUPABASE_SERVICE_ROLE_KEY") || present("SUPABASE_SECRET_KEY");

  res.setHeader("Cache-Control", "no-store, max-age=0");
  return res.status(200).json({
    ok: present("SUPABASE_URL") && browserKey,
    services: {
      supabaseUrl: present("SUPABASE_URL"),
      supabaseBrowserKey: browserKey,
      supabaseServerKey: serverKey,
      stripeSecretKey: present("STRIPE_SECRET_KEY"),
      stripeWebhookSecret: present("STRIPE_WEBHOOK_SECRET"),
      vercelToken: present("VERCEL_TOKEN")
    }
  });
}
