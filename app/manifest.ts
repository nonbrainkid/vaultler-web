import type { MetadataRoute } from "next";

/**
 * Web-манифест: устанавливаемое приложение («на главный экран»).
 *
 * Аудитория преимущественно мобильная, а на iOS 16.4+ веб-пуши работают ТОЛЬКО у сайта,
 * добавленного на главный экран, — то есть для второго канала напоминаний установка не
 * украшение, а условие работы.
 *
 * Что обязательно для установки (иначе браузер не предложит установку и не даст пушей на
 * iOS): `name`, `short_name`, `start_url`, `display: standalone`, `scope` и иконки 192 и
 * 512 px. Иконки отдаёт `app/pwa-icon/route.tsx` — по СТАБИЛЬНОМУ пути, в отличие от
 * `/icon`, который Next версионирует хешем.
 *
 * Чего здесь намеренно нет: `share_target`, protocol handlers и прочих интеграций — они
 * расширяют поверхность атаки установленного приложения, а игре не нужны.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "The Vaultler",
    short_name: "Vaultler",
    description: "Wind it. It stacks while you sleep. A daily stacking game on Robinhood Chain.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#0f0a06",
    theme_color: "#0f0a06",
    icons: [
      // 192 и 512 — то, по чему браузер решает, устанавливаемое ли это приложение.
      { src: "/pwa-icon?size=192", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/pwa-icon?size=512", sizes: "512x512", type: "image/png", purpose: "any" },
      // Те же картинки как maskable: фон непрозрачный, буква с запасом от края — обрезка в
      // круг на Android не съедает её. Отдельными записями, потому что тип манифеста в Next
      // не принимает составное значение "any maskable".
      { src: "/pwa-icon?size=192", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/pwa-icon?size=512", sizes: "512x512", type: "image/png", purpose: "maskable" },
      { src: "/apple-icon", sizes: "180x180", type: "image/png" },
      { src: "/icon", sizes: "32x32", type: "image/png" },
    ],
  };
}
