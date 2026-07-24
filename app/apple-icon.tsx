/** Иконка для «на главный экран» на iOS (apple-touch-icon). Брендовая V на стали с неоном. */
import { ImageResponse } from "next/og";

export const runtime = "nodejs";
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
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
          fontSize: 116,
          fontWeight: 700,
          fontFamily: "monospace",
          border: "10px solid #8cff5a",
        }}
      >
        V
      </div>
    ),
    size,
  );
}
