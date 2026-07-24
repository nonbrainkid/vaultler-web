"use client";

/** Крайний случай: падение самого layout. Собственная разметка, без зависимостей темы. */
export default function GlobalError({ reset }: { reset: () => void }) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#0f0a06",
          color: "#f0e6d2",
          fontFamily: "monospace",
          textAlign: "center",
          padding: 24,
        }}
      >
        <div>
          <p style={{ color: "#8cff5a", letterSpacing: 2 }}>THE VAULTLER</p>
          <h1 style={{ color: "#ffd95a" }}>The vault jammed.</h1>
          <p style={{ color: "#b3987a" }}>
            Something broke on our side. Nothing is lost — try again.
          </p>
          <button
            onClick={reset}
            style={{
              marginTop: 16,
              padding: "12px 18px",
              background: "#5fbf3a",
              color: "#0c1a06",
              border: "3px solid #1d4d18",
              cursor: "pointer",
              fontFamily: "monospace",
              fontWeight: 700,
            }}
          >
            TRY AGAIN
          </button>
        </div>
      </body>
    </html>
  );
}
