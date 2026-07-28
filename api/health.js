export default function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed." });
  }
  res.setHeader("Cache-Control", "no-store");
  const present = (name) => Boolean(String(process.env[name] || "").trim());
  return res.status(200).json({
    ok: true,
    environment: process.env.VERCEL_ENV || "unknown",
    services: {
      supabaseUrl: present("SUPABASE_URL"),
      supabaseAnonKey: present("SUPABASE_ANON_KEY"),
      supabaseServerKey: present("SUPABASE_SERVICE_ROLE_KEY"),
      stripeSecretKey: present("STRIPE_SECRET_KEY"),
      stripeWebhookSecret: present("STRIPE_WEBHOOK_SECRET"),
      vercelToken: present("VERCEL_TOKEN"),
      vercelProjectId: present("VERCEL_PROJECT_ID")
    }
  });
}
