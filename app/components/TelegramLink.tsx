"use client";

import { useCallback, useEffect, useState } from "react";
import { TELEGRAM_BOT_USERNAME } from "@/lib/links";

interface LinkStatus {
  /** Владелец ещё не завёл бота (env не заданы) — виджет вообще не показываем. */
  configured: boolean;
  linked: boolean;
}
interface IssuedCode {
  code: string;
  expiresInSec: number;
}

const ERRORS: Record<string, string> = {
  rate_limited: "slow down a moment",
  not_configured: "reminders aren't set up yet",
};

/**
 * Виджет привязки Telegram-напоминаний. Работает и для анонимной сессии, и для
 * кошелька — привязка идентична для обеих (docs/brief-engineer.md → 1.1): это 30 игроков
 * из 34, и ровно та аудитория, которую нужно удержать в первую очередь.
 *
 * Сама привязка происходит НЕ в этом компоненте, а когда игрок отправляет боту
 * `/start <код>` — виджет только выдаёт код и опрашивает "привязан ли я уже".
 */
export default function TelegramLink() {
  const [status, setStatus] = useState<LinkStatus | null>(null);
  const [issued, setIssued] = useState<IssuedCode | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const refreshStatus = useCallback(async () => {
    try {
      const r = await fetch("/api/telegram/link", { cache: "no-store" });
      if (!r.ok) return;
      const d = (await r.json()) as LinkStatus;
      setStatus(d);
      if (d.linked) setIssued(null); // код больше не нужен показывать после привязки
    } catch {
      // Тихий отказ: это вспомогательный виджет, не игровой цикл — банить экран баннером
      // "нет связи" ради него не стоит, игра сама покажет свой netbanner при реальных проблемах.
    }
  }, []);

  useEffect(() => {
    refreshStatus();
    // Обновляем при возврате на вкладку: игрок мог привязать бота, переключившись в Telegram.
    const onVis = () => {
      if (document.visibilityState === "visible") refreshStatus();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [refreshStatus]);

  async function getCode() {
    if (busy) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch("/api/telegram/link", { method: "POST", cache: "no-store" });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setErr(ERRORS[d.error] ?? "could not get a code");
        return;
      }
      setIssued(d as IssuedCode);
    } catch {
      setErr("network error");
    } finally {
      setBusy(false);
    }
  }

  async function unlink() {
    if (busy) return;
    setBusy(true);
    try {
      const r = await fetch("/api/telegram/unlink", { method: "POST", cache: "no-store" });
      if (r.ok) {
        setStatus({ configured: true, linked: false });
        setIssued(null);
      }
    } finally {
      setBusy(false);
    }
  }

  async function copyCode() {
    if (!issued) return;
    try {
      await navigator.clipboard.writeText(`/start ${issued.code}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Буфер обмена недоступен (нет прав / не https) — код и так виден текстом ниже.
    }
  }

  // Фича выключена владельцем (env не заданы) — ничего не рисуем, даже плейсхолдер:
  // "скоро" на кнопке напоминаний было бы лишним обещанием даты (docs/frontend.md → гардрейлы).
  if (status !== null && !status.configured) return null;

  return (
    <div className="card telegram-link">
      <h3 className="card-h neon">TELEGRAM REMINDERS</h3>

      {status?.linked ? (
        <>
          <p className="muted-note">
            Linked. You&apos;ll get a nudge when your window opens and a warning before the
            raider comes.
          </p>
          <button className="btn btn-ghost sm" disabled={busy} onClick={unlink}>
            {busy ? "…" : "UNLINK"}
          </button>
        </>
      ) : issued ? (
        <>
          <p className="muted-note">
            Send this to the bot within {Math.max(1, Math.round(issued.expiresInSec / 60))} min:
          </p>
          <p className="tg-code">/start {issued.code}</p>
          <div className="nick-row">
            {/* Один и тот же TELEGRAM_BOT_USERNAME, что и в ссылке "REMINDER BOT" в шапке/
                футере (lib/links.ts) — иначе сайт рекламировал бы одного бота, пока
                привязка идёт к другому. */}
            <a
              className="btn btn-neon"
              href={`https://t.me/${TELEGRAM_BOT_USERNAME}?start=${issued.code}`}
              target="_blank"
              rel="noreferrer"
            >
              OPEN IN TELEGRAM
            </a>
            <button className="btn btn-ghost sm" onClick={copyCode}>
              {copied ? "✓ COPIED" : "COPY"}
            </button>
          </div>
          <button
            className="btn btn-ghost sm tg-check"
            disabled={busy}
            onClick={refreshStatus}
          >
            I SENT IT — CHECK
          </button>
          {err && <p className="nick-err">{err}</p>}
        </>
      ) : (
        <>
          <p className="muted-note">
            Get pinged when the window opens, and again 2 hours before the raider. Works
            with or without a wallet. <b>The bot never asks for your seed phrase, a
            signature, or a transfer — it only sends text.</b>
          </p>
          <button className="btn btn-neon" disabled={busy} onClick={getCode}>
            {busy ? "…" : "GET REMINDERS ON TELEGRAM"}
          </button>
          {err && <p className="nick-err">{err}</p>}
        </>
      )}
    </div>
  );
}
