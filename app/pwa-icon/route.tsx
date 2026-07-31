/**
 * Иконки установленного приложения (PWA): `/pwa-icon?size=192` и `?size=512`.
 *
 * Зачем отдельный роут, если есть `app/icon.tsx` и `app/apple-icon.tsx`. Браузер считает
 * сайт устанавливаемым только при наличии иконок 192 и 512 px, а конвенция метаданных Next
 * отдаёт свои файлы по URL с хешем версии (`/icon?<hash>`) — в манифест такую ссылку не
 * впишешь руками, она меняется от сборки к сборке. Здесь путь стабильный и явный.
 *
 * Рисуем то же, что фавикон: золотая V на тёмном фоне с неоновой рамкой. Фон полностью
 * непрозрачный, а буква занимает ~55% полотна — поэтому иконка выживает обрезку в круг на
 * Android (`purpose: "maskable"`), не теряя букву под маской.
 */
import { ImageResponse } from "next/og";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  // Только два разрешённых значения: размер приходит из URL, и без белого списка это был бы
  // способ заставить сервер рисовать картинку 20000×20000 одним запросом.
  const size = new URL(req.url).searchParams.get("size") === "512" ? 512 : 192;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#241708",
          color: "#ffd95a",
          fontSize: Math.round(size * 0.55),
          fontWeight: 700,
          fontFamily: "monospace",
          border: `${Math.round(size * 0.05)}px solid #8cff5a`,
        }}
      >
        V
      </div>
    ),
    { width: size, height: size },
  );
}
