"use client";

import { useState } from "react";
import { useAccount, useConnect, useDisconnect, useSignMessage } from "wagmi";
import { buildAuthMessage } from "@/lib/auth";

function shortAddr(a: string): string {
  return a.slice(0, 6) + "…" + a.slice(-4);
}

export default function Wallet({
  serverAddress,
  boost,
  onChanged,
}: {
  serverAddress: string | null;
  boost: boolean;
  onChanged: () => void;
}) {
  const { address, isConnected } = useAccount();
  const { connect, connectors, isPending: connecting } = useConnect();
  const { disconnect } = useDisconnect();
  const { signMessageAsync } = useSignMessage();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const linked =
    !!serverAddress &&
    !!address &&
    serverAddress.toLowerCase() === address.toLowerCase();

  async function signIn() {
    if (!address) return;
    setBusy(true);
    setErr(null);
    try {
      const nonceRes = await fetch("/api/auth/nonce", { cache: "no-store" });
      const { nonce } = await nonceRes.json();
      const message = buildAuthMessage(address, nonce);
      const signature = await signMessageAsync({ message });
      const r = await fetch("/api/auth/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ address, signature }),
      });
      if (!r.ok) throw new Error("verify");
      onChanged();
    } catch {
      setErr("sign-in failed");
    } finally {
      setBusy(false);
    }
  }

  async function refresh() {
    setBusy(true);
    try {
      await fetch("/api/boost/refresh", { method: "POST", cache: "no-store" });
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    setBusy(true);
    try {
      disconnect();
      await fetch("/api/auth/logout", { method: "POST", cache: "no-store" });
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  // 1) кошелёк не подключён
  if (!isConnected || !address) {
    return (
      <div className="boost wallet">
        <div className="txt">
          <b>Connect a wallet.</b> Holding $VLTR boosts your stacking rate ×1.5.
          Non-holders still play — holders climb faster.
        </div>
        <div className="wbtns">
          {connectors.map((c) => (
            <button
              key={c.uid}
              className="toggle"
              disabled={connecting}
              onClick={() => connect({ connector: c })}
            >
              {(c.name === "Injected" ? "Browser Wallet" : c.name).toUpperCase()}
            </button>
          ))}
          {connectors.length === 0 && (
            <span className="werr" style={{ fontSize: 13 }}>
              no wallet found
            </span>
          )}
        </div>
      </div>
    );
  }

  // 2) подключён, но сессия не привязана к этому адресу — нужен вход подписью
  if (!linked) {
    return (
      <div className="boost wallet">
        <div className="txt">
          <b>{shortAddr(address)}</b> connected. Sign in to link it — one signature,
          no gas, no funds moved.
          {err && <span className="werr"> · {err}</span>}
        </div>
        <div className="wbtns">
          <button className="toggle on" disabled={busy} onClick={signIn}>
            {busy ? "…" : "SIGN IN"}
          </button>
          <button className="toggle" disabled={busy} onClick={logout}>
            DROP
          </button>
        </div>
      </div>
    );
  }

  // 3) привязан — показываем статус буста
  return (
    <div className="boost wallet">
      <div className="txt">
        <b>{shortAddr(address)}</b> linked.
        <br />
        <span className={"bpill" + (boost ? " on" : "")}>
          {boost ? "BOOST ×1.5 ACTIVE" : "not holding $VLTR"}
        </span>
      </div>
      <div className="wbtns">
        <button className="toggle" disabled={busy} onClick={refresh}>
          {busy ? "…" : "REFRESH"}
        </button>
        <button className="toggle" disabled={busy} onClick={logout}>
          DROP
        </button>
      </div>
    </div>
  );
}
