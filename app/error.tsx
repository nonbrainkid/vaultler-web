"use client";

import { useEffect } from "react";

/** Границы ошибок для секций сайта: вместо белого экрана — внятный экран с ретраем. */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // сюда позже подключить трекинг ошибок (Sentry и т.п.)
    console.error(error);
  }, [error]);

  return (
    <main className="section" id="main">
      <div className="shell notfound">
        <p className="eyebrow">SOMETHING JAMMED</p>
        <h1 className="section-title">THE MACHINE HICCUPED</h1>
        <p className="section-lead">
          A gear slipped on our side. Your stack is safe on the server — nothing is lost.
        </p>
        <button className="btn btn-neon lg" onClick={reset}>
          TRY AGAIN
        </button>
      </div>
    </main>
  );
}
