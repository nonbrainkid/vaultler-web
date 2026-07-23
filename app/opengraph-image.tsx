/**
 * OG-картинка для шеринга (X, Telegram, Discord). Генерируется Next-ом на лету,
 * бинарные ассеты не нужны. Палитра — брендовая: неон сейфа + золото заката.
 */
import { ImageResponse } from "next/og";

export const runtime = "nodejs";
export const alt = "The Vaultler — wind it, it stacks while you sleep";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OgImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: 70,
          background:
            "linear-gradient(160deg, #241708 0%, #0f0a06 55%, #14100a 100%)",
          color: "#f0e6d2",
          fontFamily: "monospace",
          position: "relative",
        }}
      >
        {/* неоновая полоса-акцент слева */}
        <div
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            bottom: 0,
            width: 16,
            background: "#8cff5a",
          }}
        />
        <div style={{ display: "flex", alignItems: "center", gap: 26 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: 116,
              height: 116,
              background: "#3f4441",
              border: "8px solid #2f3330",
              boxShadow: "0 0 0 6px #5fbf3a",
              color: "#ffd95a",
              fontSize: 68,
              fontWeight: 700,
            }}
          >
            V
          </div>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ fontSize: 26, color: "#8cff5a", letterSpacing: 4 }}>
              DAILY STACKING GAME · ROBINHOOD CHAIN
            </div>
            <div
              style={{
                fontSize: 86,
                fontWeight: 700,
                color: "#ffd95a",
                lineHeight: 1.05,
              }}
            >
              THE VAULTLER
            </div>
          </div>
        </div>

        <div style={{ fontSize: 40, color: "#8cff5a", marginTop: 34 }}>
          Wind it. It stacks while you sleep.
        </div>
        <div style={{ fontSize: 28, color: "#d99a1f", marginTop: 16, maxWidth: 900 }}>
          Trading is cope. Stacking is based. No deposits, no custody.
        </div>

        <div
          style={{
            display: "flex",
            gap: 14,
            marginTop: 40,
            fontSize: 22,
            color: "#b3987a",
          }}
        >
          <span style={{ border: "3px solid #5c3520", padding: "10px 16px" }}>
            CRANK DAILY
          </span>
          <span style={{ border: "3px solid #5c3520", padding: "10px 16px" }}>
            KEEP THE STREAK
          </span>
          <span style={{ border: "3px solid #5c3520", padding: "10px 16px" }}>
            SPLIT THE POT
          </span>
        </div>
      </div>
    ),
    size,
  );
}
