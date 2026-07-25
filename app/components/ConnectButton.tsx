"use client";

import { useState } from "react";
import {
  useAccount,
  useConnect,
  useDisconnect,
  useSignMessage,
  useSwitchChain,
} from "wagmi";
import { createSiweMessage } from "viem/siwe";
import { SIWE_STATEMENT, SIWE_TTL_MS } from "@/lib/auth";
import { robinhoodChain, RPC_CONFIGURED } from "@/lib/chain";

export function shortAddr(a: string): string {
  return a.slice(0, 6) + "…" + a.slice(-4);
}

/**
 * Кошелёк и wagmi оборачивают ошибки, поэтому ищем совпадение по всей цепочке `cause`.
 * Сверяемся с `name`/`code`, а не с текстом: текст меняется между версиями библиотек
 * и локализуется кошельком, а `name` — часть контракта ошибки.
 */
function errorMatches(e: unknown, test: (x: { name?: string; code?: number }) => boolean): boolean {
  let cur = e as { name?: string; code?: number; cause?: unknown } | null | undefined;
  for (let depth = 0; cur && depth < 5; depth++) {
    if (test(cur)) return true;
    cur = cur.cause as typeof cur;
  }
  return false;
}

/** Подпись сорвалась в кошельке (не дошли до сервера). */
class SignStepError extends Error {
  constructor(readonly cause: unknown) {
    super("sign step failed");
  }
}

/** Сервер отверг вход и назвал причину кодом. */
class VerifyRejected extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
  ) {
    super(`verify rejected: ${code || status}`);
  }
}

/**
 * Человеческий текст для провала входа. Общее «Sign-in failed» бесполезно: у входа
 * два принципиально разных места отказа — кошелёк не отдал подпись и сервер её не принял,
 * — и чинятся они по-разному. Сервер уже возвращает код причины, показываем его.
 */
function signInErrorText(e: unknown): string {
  if (e instanceof VerifyRejected) {
    switch (e.code) {
      case "message_rejected":
        return "The signed message didn't match this site (domain, nonce or expiry). Reload the page and try again.";
      case "bad_signature":
        return "Your wallet's signature didn't verify for this address. If you switched accounts, reconnect and retry.";
      case "nonce_missing":
        return "Sign-in code was lost — your browser is blocking our cookie. Disable tracking protection for this site and retry.";
      case "bad_message":
      case "bad_params":
      case "bad_body":
        return "The wallet returned a signature we couldn't read. Please report which wallet you used.";
      case "rate_limited":
        return "Too many attempts — wait a minute and try again.";
      default:
        return `Sign-in was rejected by the server (${e.code || e.status}).`;
    }
  }
  if (e instanceof SignStepError) {
    const name = (e.cause as { name?: string })?.name;
    // Имя ошибки кошелька важнее общей фразы: по нему видно, что именно отказало.
    return `Your wallet didn't return a signature${name ? ` (${name})` : ""}. Some wallets only sign on a supported network — try switching to a mainnet and retry.`;
  }
  return "Sign-in failed — try again.";
}

/** Имя коннектора для показа: generic-инжект wagmi зовётся "Injected" — это не для глаз. */
function prettyName(name: string): string {
  return name === "Injected" ? "Browser Wallet" : name;
}

/** Отмена в кошельке — не ошибка: пользователь сам передумал, ругаться не за что. */
function isUserRejection(e: unknown): boolean {
  return errorMatches(e, (x) => x.name === "UserRejectedRequestError" || x.code === 4001);
}

/**
 * Текст ошибки коннекта; null — показывать нечего.
 * Отдельный случай «кошелька нет в браузере» принципиален: это самая частая причина
 * неудачи, и без явного сообщения пользователь видит только, что ничего не произошло,
 * и решает, что сломан сайт.
 */
function connectErrorText(e: unknown, connectorName: string): string | null {
  if (isUserRejection(e)) return null;
  const notInstalled = errorMatches(
    e,
    (x) => x.name === "ProviderNotFoundError" || x.name === "ConnectorNotFoundError",
  );
  if (notInstalled) {
    // Generic-инжект — не продукт: «install Browser Wallet» звучало бы бессмыслицей.
    return connectorName === "Injected"
      ? "No browser wallet detected — install one, or open this page in your wallet's browser."
      : `${connectorName} not detected — install it, or open this page in your wallet's browser.`;
  }
  return "Couldn't connect — try again.";
}

export default function ConnectButton({
  wallet,
  onChanged,
}: {
  wallet: string | null;
  onChanged: () => void;
}) {
  // chainId берём ИМЕННО отсюда — это сеть кошелька. `useChainId()` отдаёт сеть
  // из нашего конфига, а в нём один чейн, поэтому он всегда возвращал бы robinhoodChain.id
  // независимо от того, где на самом деле стоит кошелёк.
  const { address, isConnected, chainId: walletChainId } = useAccount();
  const { connectAsync, connectors, isPending } = useConnect();
  const { disconnect } = useDisconnect();
  const { signMessageAsync } = useSignMessage();
  const { switchChainAsync } = useSwitchChain();

  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const linked =
    !!wallet && !!address && wallet.toLowerCase() === address.toLowerCase();
  // Сравниваем с сетью КОШЕЛЬКА. Раньше сравнивался chainId конфига сам с собой,
  // поэтому подсказка не показывалась никогда.
  const otherNetwork =
    isConnected && walletChainId !== undefined && walletChainId !== robinhoodChain.id;

  /**
   * Предлагать переключение имеет смысл только когда сеть реально существует.
   * Без RPC в конфиге chainId — плейсхолдер, добавить такую сеть кошелёк не может,
   * и кнопка гарантированно упиралась бы в ошибку.
   *
   * И это именно ПОДСКАЗКА, а не ошибка: игре сеть кошелька не нужна вообще. Вход —
   * это подпись сообщения (RPC не требует), а баланс $VLTR читает сервер на своём RPC.
   * Транзакций сайт не отправляет. Сеть нужна только чтобы купить/держать токен.
   */
  const canOfferSwitch = otherNetwork && RPC_CONFIGURED;

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
      // Именно connectAsync: обычный connect — fire-and-forget, он не реджектит промис
      // (ошибка уходит в состояние хука). С ним `await` всегда проходил, модалка
      // закрывалась даже при неудаче, а catch был мёртвым кодом.
      await connectAsync({ connector: c });
      setOpen(false); // закрываем только по факту успеха
    } catch (e) {
      setErr(connectErrorText(e, c.name));
    }
  }

  /**
   * switchChainAsync, а не switchChain: у последнего ошибка уходит в состояние хука,
   * промис не реджектится — неудачное переключение проходило бы совсем молча
   * (та же болезнь, что была у connect).
   */
  async function doSwitchChain() {
    setErr(null);
    try {
      await switchChainAsync({ chainId: robinhoodChain.id });
    } catch (e) {
      if (isUserRejection(e)) return;
      setErr(
        `Couldn't switch to ${robinhoodChain.name}. You can add it manually in your wallet — the game works either way.`,
      );
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
        // Сеть, на которой кошелёк РЕАЛЬНО стоит. Кошельки (в частности Phantom)
        // разбирают EIP-4361 и сверяют Chain ID с активной сетью: при несовпадении
        // они просто отказываются подписывать. Сервер сеть не пинит намеренно —
        // для входа она не нужна, а переключить её предлагает кнопка WRONG NET.
        chainId: walletChainId ?? robinhoodChain.id,
        nonce,
        issuedAt,
        expirationTime: new Date(issuedAt.getTime() + SIWE_TTL_MS),
      });

      let signature: `0x${string}`;
      try {
        signature = await signMessageAsync({ message });
      } catch (e) {
        // Ошибку подписи заворачиваем отдельно: иначе она неотличима от отказа сервера,
        // а это совсем разные поломки (кошелёк vs наш бэкенд).
        throw new SignStepError(e);
      }

      const r = await fetch("/api/auth/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message, signature }),
      });
      if (!r.ok) {
        // Сервер называет причину отказа кодом — показываем её, а не общее «не вышло»:
        // "домен не совпал" и "кошелёк не отдал подпись" чинятся по-разному.
        const code = await r
          .json()
          .then((d: { error?: string }) => d?.error ?? "")
          .catch(() => "");
        throw new VerifyRejected(code, r.status);
      }
      onChanged();
    } catch (e) {
      // Отказ подписи в кошельке — не ошибка, просто отмена.
      setErr(isUserRejection(e) ? null : signInErrorText(e));
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
                  {prettyName(c.name).toUpperCase()}
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
      {/*
        Не «WRONG NET»: ничего не сломано. Игре сеть кошелька безразлична — вход это
        подпись, а баланс читает сервер. Это необязательная подсказка для тех, кто хочет
        купить/держать $VLTR, поэтому нейтральный стиль, а не красная кнопка ошибки.
      */}
      {canOfferSwitch && (
        <button
          className="btn btn-ghost"
          onClick={doSwitchChain}
          title={`Optional: switch to ${robinhoodChain.name} to buy or hold $VLTR. The game works on any network.`}
        >
          + {robinhoodChain.name.toUpperCase()}
        </button>
      )}
      <button className="btn btn-wood" onClick={() => setOpen(true)}>
        {shortAddr(address)}
      </button>
      {open && (
        <Modal onClose={() => setOpen(false)} title="WALLET">
          <p className="modal-note">{address}</p>
          <div className="modal-list">
            {/* Прячем, пока сеть — плейсхолдер: добавить несуществующий чейн нельзя. */}
            {RPC_CONFIGURED && (
              <button className="btn btn-wood wide" onClick={doSwitchChain}>
                ADD / SWITCH TO {robinhoodChain.name.toUpperCase()}
              </button>
            )}
            <button className="btn btn-ghost wide" disabled={busy} onClick={logout}>
              DISCONNECT
            </button>
          </div>
          {err && <p className="modal-err">{err}</p>}
          <p className="modal-note dim">
            Your wallet&apos;s network doesn&apos;t affect the game: signing in needs no
            network, and we read your $VLTR balance server-side.
          </p>
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
