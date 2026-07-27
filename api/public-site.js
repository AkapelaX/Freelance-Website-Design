const JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0"
};

function send(res, status, body) {
  res.status(status);

  Object.entries(JSON_HEADERS).forEach(([key, value]) => {
    res.setHeader(key, value);
  });

  return res.json(body);
}

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function imageUrl(value) {
  if (typeof value === "string") {
    return value.trim();
  }

  if (value && typeof value === "object") {
    return text(
      value.url ||
      value.src ||
      value.publicUrl ||
      value.public_url ||
      value.imageUrl ||
      value.image_url
    );
  }

  return "";
}

function firstImage(...values) {
  for (const value of values) {
    const url = imageUrl(value);

    if (url) {
      return url;
    }
  }

  return "";
}

function normalizeProjectState(projectData) {
  const source =
    projectData &&
    typeof projectData === "object" &&
    !Array.isArray(projectData)
      ? projectData
      : {};

  const state = {
    ...source
  };

  const business =
    source.business &&
    typeof source.business === "object" &&
    !Array.isArray(source.business)
      ? { ...source.business }
      : {};

  const header =
    source.header &&
    typeof source.header === "object" &&
    !Array.isArray(source.header)
      ? { ...source.header }
      : {};

  const design =
    source.design &&
    typeof source.design === "object" &&
    !Array.isArray(source.design)
      ? { ...source.design }
      : {};

  const sections =
    source.sections &&
    typeof source.sections === "object" &&
    !Array.isArray(source.sections)
      ? source.sections
      : {};

  const aboutSection =
    sections.about &&
    typeof sections.about === "object" &&
    !Array.isArray(sections.about)
      ? sections.about
      : {};

  const featuredSection =
    sections.featured &&
    typeof sections.featured === "object" &&
    !Array.isArray(sections.featured)
      ? sections.featured
      : {};

  const gallerySection =
    sections.gallery &&
    typeof sections.gallery === "object" &&
    !Array.isArray(sections.gallery)
      ? sections.gallery
      : {};

  const mapSection =
    sections.map &&
    typeof sections.map === "object" &&
    !Array.isArray(sections.map)
      ? sections.map
      : {};

  const contactSection =
    sections.contact &&
    typeof sections.contact === "object" &&
    !Array.isArray(sections.contact)
      ? sections.contact
      : {};

  header.image = firstImage(
    header.image,
    header.cover,
    header.coverImage,
    header.cover_image,
    header.background,
    header.backgroundImage,
    header.background_image,
    source.headerImage,
    source.header_image,
    source.heroImage,
    source.hero_image,
    design.headerImage,
    design.header_image,
    design.heroImage,
    design.hero_image
  );

  design.logo = firstImage(
    design.logo,
    design.logoImage,
    design.logo_image,
    source.logo,
    source.logoImage,
    source.logo_image,
    business.logo,
    business.logoImage,
    business.logo_image
  );

  design.aboutCover = firstImage(
    design.aboutCover,
    design.aboutCoverImage,
    design.about_cover,
    design.about_cover_image,
    source.aboutCover,
    source.aboutCoverImage,
    source.about_cover,
    source.about_cover_image,
    aboutSection.cover,
    aboutSection.coverImage,
    aboutSection.cover_image,
    aboutSection.background,
    aboutSection.backgroundImage,
    aboutSection.background_image
  );

  design.featuredCover = firstImage(
    design.featuredCover,
    design.featuredCoverImage,
    design.featured_cover,
    design.featured_cover_image,
    source.featuredCover,
    source.featuredCoverImage,
    source.featured_cover,
    source.featured_cover_image,
    featuredSection.cover,
    featuredSection.coverImage,
    featuredSection.cover_image,
    featuredSection.background,
    featuredSection.backgroundImage,
    featuredSection.background_image
  );

  design.galleryCover = firstImage(
    design.galleryCover,
    design.galleryCoverImage,
    design.gallery_cover,
    design.gallery_cover_image,
    source.galleryCover,
    source.galleryCoverImage,
    source.gallery_cover,
    source.gallery_cover_image,
    gallerySection.cover,
    gallerySection.coverImage,
    gallerySection.cover_image,
    gallerySection.background,
    gallerySection.backgroundImage,
    gallerySection.background_image
  );

  design.mapCover = firstImage(
    design.mapCover,
    design.mapCoverImage,
    design.map_cover,
    design.map_cover_image,
    source.mapCover,
    source.mapCoverImage,
    source.map_cover,
    source.map_cover_image,
    mapSection.cover,
    mapSection.coverImage,
    mapSection.cover_image,
    mapSection.background,
    mapSection.backgroundImage,
    mapSection.background_image,
    contactSection.cover,
    contactSection.coverImage,
    contactSection.cover_image,
    contactSection.background,
    contactSection.backgroundImage,
    contactSection.background_image
  );

  state.mapUrl = text(
    source.mapUrl ||
    source.map_url ||
    design.mapUrl ||
    design.map_url ||
    mapSection.url ||
    mapSection.mapUrl ||
    mapSection.map_url ||
    contactSection.mapUrl ||
    contactSection.map_url
  );

  state.business = business;
  state.header = header;
  state.design = design;

  state.photos = Array.isArray(source.photos)
    ? source.photos
    : Array.isArray(featuredSection.items)
      ? featuredSection.items
      : Array.isArray(featuredSection.photos)
        ? featuredSection.photos
        : [];

  state.gallery = Array.isArray(source.gallery)
    ? source.gallery
    : Array.isArray(gallerySection.items)
      ? gallerySection.items
      : Array.isArray(gallerySection.photos)
        ? gallerySection.photos
        : [];

  return state;
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");

    return send(res, 405, {
      error: "Method not allowed."
    });
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    return send(res, 500, {
      error: "Publishing service is not configured."
    });
  }

  const slug = String(req.query.slug || "")
    .trim()
    .toLowerCase();

  const host = String(req.query.host || "")
    .trim()
    .toLowerCase()
    .replace(/^www\./, "");

  if (!slug && !host) {
    return send(res, 400, {
      error: "A website slug or domain is required."
    });
  }

  const field = host ? "custom_domain" : "slug";
  const lookupValue = host || slug;

  const query = new URLSearchParams({
    select:
      "id,name,slug,custom_domain,project_data,status,updated_at",
    status: "eq.published",
    [field]: `eq.${lookupValue}`,
    limit: "1"
  });

  let response;

  try {
    response = await fetch(
      `${supabaseUrl}/rest/v1/website_projects?${query.toString()}`,
      {
        method: "GET",
        headers: {
          apikey: serviceRoleKey,
          Authorization: `Bearer ${serviceRoleKey}`,
          Accept: "application/json"
        },
        cache: "no-store"
      }
    );
  } catch (error) {
    console.error(
      "Published website request failed:",
      error
    );

    return send(res, 500, {
      error: "The website could not be loaded."
    });
  }

  if (!response.ok) {
    const detail = await response.text();

    console.error(
      "Published website lookup failed:",
      detail
    );

    return send(res, 500, {
      error: "The website could not be loaded."
    });
  }

  let rows;

  try {
    rows = await response.json();
  } catch (error) {
    console.error(
      "Published website response was invalid:",
      error
    );

    return send(res, 500, {
      error: "The website data could not be read."
    });
  }

  const row = Array.isArray(rows) ? rows[0] : null;

  if (!row) {
    return send(res, 404, {
      error: "This website is not published."
    });
  }

  const state = normalizeProjectState(
    row.project_data
  );

  return send(res, 200, {
    website: {
      id: row.id,
      name: row.name,
      slug: row.slug,
      customDomain: row.custom_domain,
      updatedAt: row.updated_at,
      state
    }
  });
}