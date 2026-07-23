"use client";

import { useCallback, useEffect, useState } from "react";

/** Лёгкий хук: узнать у сервера, привязана ли сессия к кошельку, и активен ли буст. */
export function useSession() {
  const [wallet, setWallet] = useState<string | null>(null);
  const [boost, setBoost] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const r = await fetch("/api/state", { cache: "no-store" });
      if (!r.ok) return;
      const d = await r.json();
      setWallet(d.wallet ?? null);
      setBoost(Boolean(d.view?.boost));
    } catch {
      /* оффлайн — молчим */
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { wallet, boost, refresh };
}
