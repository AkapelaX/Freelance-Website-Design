import { admin, requireUser, sendError } from "./api/_lib.js";

export default async function handler(req, res) {
  try {
    const user = await requireUser(req);

    if (req.method === "GET") {
      const { data, error } = await admin
        .from("projects")
        .select("project_data")
        .eq("user_id", user.id)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) throw error;

      return res.status(200).json({
        project: data?.project_data || null
      });
    }

    if (req.method === "POST") {
      const incomingProject = req.body?.project;

      if (!incomingProject) {
        throw Object.assign(
          new Error("Project data is required."),
          { status: 400 }
        );
      }

      /*
       * Read the existing server copy first.
       * Publishing status must be controlled by /api/publish-site,
       * not overwritten by an older browser state.
       */
      const { data: existingRow, error: existingError } = await admin
        .from("projects")
        .select("project_data")
        .eq("user_id", user.id)
        .maybeSingle();

      if (existingError) throw existingError;

      const existingProject = existingRow?.project_data || {};
      const existingBackend = existingProject.backend || {};
      const incomingBackend = incomingProject.backend || {};

      const protectedProject = {
        ...incomingProject,

        backend: {
          ...incomingBackend,

          /*
           * Preserve publishing values already stored by the server.
           */
          published:
            typeof existingBackend.published === "boolean"
              ? existingBackend.published
              : false,

          websiteId:
            existingBackend.websiteId ??
            incomingBackend.websiteId ??
            null,

          updatedAt:
            existingBackend.updatedAt ??
            incomingBackend.updatedAt ??
            null
        }
      };

      const payload = {
        user_id: user.id,
        name:
          protectedProject.business?.name ||
          "My Website",
        slug:
          protectedProject.project?.slug ||
          null,
        plan:
          protectedProject.plan ||
          "starter",
        project_data: protectedProject,
        updated_at: new Date().toISOString()
      };

      const { error } = await admin
        .from("projects")
        .upsert(payload, {
          onConflict: "user_id"
        });

      if (error) throw error;

      return res.status(200).json({
        saved: true,
        project: protectedProject
      });
    }

    return res.status(405).json({
      error: "Method not allowed."
    });
  } catch (error) {
    sendError(res, error);
  }
}