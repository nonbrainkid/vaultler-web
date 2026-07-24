import type { MetadataRoute } from "next";

/** Web-манифест: «на главный экран» на мобилке (аудитория преимущественно с телефонов). */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "The Vaultler",
    short_name: "Vaultler",
    description: "Wind it. It stacks while you sleep. A daily stacking game on Robinhood Chain.",
    start_url: "/",
    display: "standalone",
    background_color: "#0f0a06",
    theme_color: "#0f0a06",
    icons: [
      { src: "/apple-icon", sizes: "180x180", type: "image/png" },
      { src: "/icon", sizes: "32x32", type: "image/png" },
    ],
  };
}
