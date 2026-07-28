"use strict";

import {
  admin,
  sendJson
} from "../_lib.js";

function text(value) {
  return typeof value === "string"
    ? value.trim()
    : "";
}

function isObject(value) {
  return Boolean(
    value &&
    typeof value === "object" &&
    !Array.isArray(value)
  );
}

function imageUrl(value) {
  if (typeof value === "string") {
    return value.trim();
  }

  if (isObject(value)) {
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

function normalizeSlug(value) {
  return text(value)
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

function normalizeHost(value) {
  return text(value)
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "")
    .replace(/:\d+$/, "")
    .replace(/^www\./, "")
    .replace(/\.$/, "");
}

function normalizeProjectState(projectData) {
  const source =
    isObject(projectData)
      ? projectData
      : {};

  const state = {
    ...source
  };

  const business =
    isObject(source.business)
      ? { ...source.business }
      : {};

  const header =
    isObject(source.header)
      ? { ...source.header }
      : {};

  const design =
    isObject(source.design)
      ? { ...source.design }
      : {};

  const sections =
    isObject(source.sections)
      ? source.sections
      : {};

  const aboutSection =
    isObject(sections.about)
      ? sections.about
      : {};

  const featuredSection =
    isObject(sections.featured)
      ? sections.featured
      : {};

  const gallerySection =
    isObject(sections.gallery)
      ? sections.gallery
      : {};

  const mapSection =
    isObject(sections.map)
      ? sections.map
      : {};

  const contactSection =
    isObject(sections.contact)
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

  state.photos =
    Array.isArray(source.photos)
      ? source.photos
      : Array.isArray(featuredSection.items)
        ? featuredSection.items
        : Array.isArray(featuredSection.photos)
          ? featuredSection.photos
          : [];

  state.gallery =
    Array.isArray(source.gallery)
      ? source.gallery
      : Array.isArray(gallerySection.items)
        ? gallerySection.items
        : Array.isArray(gallerySection.photos)
          ? gallerySection.photos
          : [];

  return state;
}

async function findPublishedProject({
  slug,
  host
}) {
  let query = admin
    .from("projects")
    .select(
      [
        "id",
        "user_id",
        "name",
        "slug",
        "plan",
        "project_data",
        "published",
        "published_url",
        "custom_domain",
        "domain_status",
        "ssl_status",
        "dns_verified",
        "updated_at"
      ].join(",")
    )
    .eq("published", true)
    .limit(1);

  if (host) {
    query = query.eq(
      "custom_domain",
      host
    );
  } else {
    query = query.eq(
      "slug",
      slug
    );
  }

  const {
    data,
    error
  } = await query.maybeSingle();

  if (error) {
    throw error;
  }

  return data || null;
}

export default async function handler(
  req,
  res
) {
  if (req.method === "OPTIONS") {
    res.setHeader(
      "Allow",
      "GET, OPTIONS"
    );

    return res
      .status(204)
      .end();
  }

  if (req.method !== "GET") {
    res.setHeader(
      "Allow",
      "GET, OPTIONS"
    );

    return sendJson(
      res,
      405,
      {
        error:
          "Method not allowed."
      }
    );
  }

  try {
    const slug =
      normalizeSlug(
        req.query?.slug
      );

    const host =
      normalizeHost(
        req.query?.host
      );

    if (!slug && !host) {
      return sendJson(
        res,
        400,
        {
          error:
            "A website slug or domain is required."
        }
      );
    }

    const project =
      await findPublishedProject({
        slug,
        host
      });

    if (!project) {
      return sendJson(
        res,
        404,
        {
          error:
            "This website is not published."
        }
      );
    }

    const state =
      normalizeProjectState(
        project.project_data
      );

    state.plan =
      project.plan ||
      state.plan ||
      "starter";

    state.project = {
      ...(
        isObject(state.project)
          ? state.project
          : {}
      ),

      slug:
        project.slug ||
        "",

      customDomain:
        project.custom_domain ||
        "",

      domainStatus:
        project.domain_status ||
        "not_connected",

      sslStatus:
        project.ssl_status ||
        "waiting",

      dnsVerified:
        project.dns_verified === true
    };

    state.backend = {
      ...(
        isObject(state.backend)
          ? state.backend
          : {}
      ),

      userId:
        project.user_id,

      websiteId:
        project.id,

      published: true,

      publishedUrl:
        project.published_url ||
        null,

      updatedAt:
        project.updated_at ||
        null
    };

    return sendJson(
      res,
      200,
      {
        website: {
          id:
            project.id,

          name:
            project.name ||
            "Untitled Website",

          slug:
            project.slug ||
            "",

          plan:
            project.plan ||
            "starter",

          published:
            true,

          publishedUrl:
            project.published_url ||
            null,

          customDomain:
            project.custom_domain ||
            null,

          domainStatus:
            project.domain_status ||
            "not_connected",

          sslStatus:
            project.ssl_status ||
            "waiting",

          dnsVerified:
            project.dns_verified === true,

          updatedAt:
            project.updated_at ||
            null,

          state
        }
      }
    );
  } catch (error) {
    console.error(
      "Public website API error:",
      error
    );

    return sendJson(
      res,
      Number.isInteger(error?.status)
        ? error.status
        : 500,
      {
        error:
          error?.message ||
          "The website could not be loaded."
      }
    );
  }
}
