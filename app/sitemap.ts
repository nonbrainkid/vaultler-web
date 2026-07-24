import type { MetadataRoute } from "next";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  // Одностраничный лендинг с якорями — отдаём корень; секции индексируются вместе с ним.
  return [
    { url: SITE_URL, lastModified: now, changeFrequency: "daily", priority: 1 },
  ];
}
