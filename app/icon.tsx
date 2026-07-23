/** Брендовый фавикон: золотая V на стали с неоновой рамкой (как на аватаре). */
import { ImageResponse } from "next/og";

export const runtime = "nodejs";
export const size = { width: 32, height: 32 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#3f4441",
          border: "2px solid #8cff5a",
          color: "#ffd95a",
          fontSize: 22,
          fontWeight: 700,
          fontFamily: "monospace",
        }}
      >
        V
      </div>
    ),
    size,
  );
}
