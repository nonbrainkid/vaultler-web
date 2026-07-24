"use client";

import { useState } from "react";
import {
  useAccount,
  useConnect,
  useDisconnect,
  useSignMessage,
  useSwitchChain,
  useChainId,
} from "wagmi";
import { createSiweMessage } from "viem/siwe";
import { SIWE_STATEMENT, SIWE_TTL_MS } from "@/lib/auth";
import { robinhoodChain } from "@/lib/chain";

export function shortAddr(a: string): string {
  return a.slice(0, 6) + "…" + a.slice(-4);
}

export default function ConnectButton({
  wallet,
  onChanged,
}: {
  wallet: string | null;
  onChanged: () => void;
}) {
  const { address, isConnected } = useAccount();
  const { connect, connectors, isPending } = useConnect();
  const { disconnect } = useDisconnect();
  const { signMessageAsync } = useSignMessage();
  const { switchChain } = useSwitchChain();
  const chainId = useChainId();

  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const linked =
    !!wallet && !!address && wallet.toLowerCase() === address.toLowerCase();
  const wrongChain = isConnected && chainId !== robinhoodChain.id;

  // Убираем дубликаты (EIP-6963 может отдать тот же кошелёк, что и явный таргет).
  const seen = new Set<string>();
  const list = connectors.filter((c) => {
    const k = c.name.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  async function doConnect(connectorId: string) {
    const c = list.find((x) => x.uid === connectorId);
    if (!c) return;
    setErr(null);
    try {
      await connect({ connector: c });
      setOpen(false);
    } catch {
      setErr("connect failed");
    }
  }

  async function signIn() {
    if (!address) return;
    setBusy(true);
    setErr(null);
    try {
      const nres = await fetch("/api/auth/nonce", { cache: "no-store" });
      if (!nres.ok) throw new Error("nonce");
      const { nonce } = await nres.json();

      // Полноценное SIWE-сообщение (EIP-4361): домен, chainId, срок действия.
      // Кошелёк покажет пользователю домен — сервер примет подпись только для нашего.
      const issuedAt = new Date();
      const message = createSiweMessage({
        domain: window.location.host,
        address, // useAccount отдаёт checksum-адрес
        statement: SIWE_STATEMENT,
        uri: window.location.origin,
        version: "1",
        chainId: chainId || robinhoodChain.id,
        nonce,
        issuedAt,
        expirationTime: new Date(issuedAt.getTime() + SIWE_TTL_MS),
      });

      const signature = await signMessageAsync({ message });
      const r = await fetch("/api/auth/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message, signature }),
      });
      if (!r.ok) throw new Error("verify");
      onChanged();
    } catch (e) {
      // отказ подписи в кошельке — не ошибка, просто отмена
      const msg = String((e as Error)?.message ?? "");
      setErr(/reject|denied|User rejected/i.test(msg) ? null : "sign-in failed");
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
      setOpen(false);
    }
  }

  // ── не подключён ──
  if (!isConnected || !address) {
    return (
      <>
        <button className="btn btn-neon" onClick={() => setOpen(true)}>
          CONNECT
        </button>
        {open && (
          <Modal onClose={() => setOpen(false)} title="CONNECT WALLET">
            <p className="modal-note">
              Signing in costs nothing — no gas, no transaction, no access to your funds.
            </p>
            <div className="modal-list">
              {list.map((c) => (
                <button
                  key={c.uid}
                  className="btn btn-wood wide"
                  disabled={isPending}
                  onClick={() => doConnect(c.uid)}
                >
                  {(c.name === "Injected" ? "Browser Wallet" : c.name).toUpperCase()}
                </button>
              ))}
            </div>
            {err && <p className="modal-err">{err}</p>}
            <p className="modal-note dim">
              Robinhood Chain is an Arbitrum Orbit L2 — any EVM wallet works.
            </p>
          </Modal>
        )}
      </>
    );
  }

  // ── подключён, но не подписан ──
  if (!linked) {
    return (
      <div className="wallet-inline">
        <button className="btn btn-neon" disabled={busy} onClick={signIn}>
          {busy ? "…" : "SIGN IN"}
        </button>
        <button className="btn btn-ghost" onClick={logout} title="disconnect">
          ✕
        </button>
        {err && <span className="modal-err inline">{err}</span>}
      </div>
    );
  }

  // ── подключён и подписан ──
  return (
    <div className="wallet-inline">
      {wrongChain && (
        <button
          className="btn btn-warn"
          onClick={() => switchChain({ chainId: robinhoodChain.id })}
          title="switch network"
        >
          WRONG NET
        </button>
      )}
      <button className="btn btn-wood" onClick={() => setOpen(true)}>
        {shortAddr(address)}
      </button>
      {open && (
        <Modal onClose={() => setOpen(false)} title="WALLET">
          <p className="modal-note">{address}</p>
          <div className="modal-list">
            <button
              className="btn btn-wood wide"
              onClick={() => switchChain({ chainId: robinhoodChain.id })}
            >
              ADD / SWITCH TO {robinhoodChain.name.toUpperCase()}
            </button>
            <button className="btn btn-ghost wide" disabled={busy} onClick={logout}>
              DISCONNECT
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <div className="modal-back" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <span>{title}</span>
          <button className="btn btn-ghost" onClick={onClose} aria-label="close">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
