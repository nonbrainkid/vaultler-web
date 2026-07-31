"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Виджет браузерных напоминаний — второй канал возврата игрока (первый — Telegram).
 *
 * Зачем второй канал: у ВСЕХ игроков в проде стрик = 1, то есть никто ни разу не вернулся в
 * 12-часовое окно. Telegram требует и самого Telegram, и привязки кодом; здесь — одна кнопка
 * и системное разрешение браузера.
 *
 * Состояния честные: «браузер не умеет», «разрешение отклонено» и «включено» — разные вещи, и
 * подменять их одним «не получилось» нельзя. Отклонённое разрешение мы НЕ можем вернуть из
 * кода (браузер запоминает отказ на весь сайт) — единственный честный текст в этом случае
 * объясняет, где это меняется руками.
 *
 * Никаких CSS-правок этот компонент не требует: используются только существующие классы
 * (`card`, `btn-*`, `muted-note`, `nick-err`) из globals.css.
 */

interface PushStatus {
  /** Владелец не задал VAPID-ключи — виджета нет вовсе, как у Telegram без токена. */
  configured: boolean;
  publicKey: string | null;
  /** Сколько устройств этой сессии подписано (endpoint'ы наружу не отдаются). */
  subscriptions: number;
}

type UiState =
  | "loading"
  | "unsupported" // браузер не умеет пуши (или это iOS вне установленного приложения)
  | "denied" // разрешение отклонено — из кода не переспросить
  | "off"
  | "on";

const ERRORS: Record<string, string> = {
  rate_limited: "slow down a moment",
  not_configured: "reminders aren't set up yet",
  bad_endpoint: "your browser returned a push address we can't use",
  bad_subscription: "your browser returned keys we can't use",
};

/**
 * base64url → ArrayBuffer: `applicationServerKey` принимает только байты, а публичный ключ
 * приходит с сервера строкой. Вручную, без зависимостей — `atob` есть во всех браузерах,
 * которые вообще умеют пуши.
 */
function keyToBytes(base64url: string): ArrayBuffer {
  const padded = base64url.replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out.buffer;
}

function pushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

export default function PushReminders() {
  const [status, setStatus] = useState<PushStatus | null>(null);
  const [ui, setUi] = useState<UiState>("loading");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  /**
   * Синхронизировать вид с ФАКТИЧЕСКИМ состоянием браузера, а не с тем, что мы записали в
   * стор: игрок мог отозвать разрешение в настройках сайта, и тогда сервер считает подписку
   * живой, а уведомлений нет. Браузер здесь — источник правды о разрешении (стек и стрик
   * по-прежнему только серверные, это разные вопросы).
   */
  const refresh = useCallback(async () => {
    let data: PushStatus | null = null;
    try {
      const r = await fetch("/api/push/subscribe", { cache: "no-store" });
      if (r.ok) data = (await r.json()) as PushStatus;
    } catch {
      // Тихий отказ: вспомогательный виджет, а не игровой цикл — свой баннер «нет связи»
      // покажет сама игра.
    }
    setStatus(data);
    if (!data?.configured) return;

    if (!pushSupported()) {
      setUi("unsupported");
      return;
    }
    if (Notification.permission === "denied") {
      setUi("denied");
      return;
    }
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = reg ? await reg.pushManager.getSubscription() : null;
    setUi(sub && Notification.permission === "granted" ? "on" : "off");
  }, []);

  useEffect(() => {
    refresh();
    // Возврат на вкладку: разрешение могли поменять в настройках браузера, пока нас не было.
    const onVis = () => {
      if (document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [refresh]);

  async function enable() {
    if (busy || !status?.publicKey) return;
    setBusy(true);
    setErr(null);
    try {
      // Разрешение спрашиваем ТОЛЬКО по клику. Спонтанный запрос при загрузке — то, за что
      // браузеры блокируют сайту уведомления навсегда, а игрок помнит как наглость.
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setUi(permission === "denied" ? "denied" : "off");
        return;
      }

      const reg = await navigator.serviceWorker.register("/sw.js");
      // Ждём готовности: сразу после register() у регистрации может не быть активного
      // воркера, и подписка упала бы с невнятной ошибкой.
      await navigator.serviceWorker.ready;

      const sub =
        (await reg.pushManager.getSubscription()) ??
        (await reg.pushManager.subscribe({
          // Без этого флага браузеры (Chrome) отказывают: пуш обязан быть видимым для
          // пользователя. Нам это и нужно — «тихих» пушей у нас нет по замыслу.
          userVisibleOnly: true,
          applicationServerKey: keyToBytes(status.publicKey),
        }));

      const r = await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "content-type": "application/json" },
        cache: "no-store",
        body: JSON.stringify(sub.toJSON()),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setErr(ERRORS[d.error] ?? "could not turn reminders on");
        return;
      }
      setStatus((s) => (s ? { ...s, subscriptions: d.subscriptions ?? s.subscriptions } : s));
      setUi("on");
    } catch {
      setErr("your browser refused the subscription");
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    if (busy) return;
    setBusy(true);
    setErr(null);
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = reg ? await reg.pushManager.getSubscription() : null;
      if (sub) {
        // Сначала говорим серверу (иначе после локальной отписки мы бы не знали, какой
        // endpoint удалять, и запись жила бы до первого 410), потом отписываемся в браузере.
        await fetch("/api/push/unsubscribe", {
          method: "POST",
          headers: { "content-type": "application/json" },
          cache: "no-store",
          body: JSON.stringify({ endpoint: sub.endpoint }),
        }).catch(() => null);
        await sub.unsubscribe();
      }
      setUi("off");
      setStatus((s) => (s ? { ...s, subscriptions: 0 } : s));
    } finally {
      setBusy(false);
    }
  }

  // Фича выключена владельцем (нет VAPID-ключей) — не рисуем даже плейсхолдер: «скоро» было
  // бы обещанием даты (docs/frontend.md → гардрейлы копирайтинга).
  if (status !== null && !status.configured) return null;
  if (ui === "loading") return null;

  return (
    <div className="card telegram-link">
      <h3 className="card-h neon">BROWSER REMINDERS</h3>

      {ui === "on" ? (
        <>
          <p className="muted-note">
            On for this device. You&apos;ll get a nudge when your window opens and a warning
            before the raider comes. Add the site to your home screen to keep them after
            closing the browser.
          </p>
          <button className="btn btn-ghost sm" disabled={busy} onClick={disable}>
            {busy ? "…" : "TURN OFF"}
          </button>
        </>
      ) : ui === "denied" ? (
        <p className="muted-note">
          Notifications are blocked for this site in your browser settings, so we can&apos;t ask
          again from here. Allow them in the site settings (the lock icon next to the address),
          then reload. Telegram reminders above work either way.
        </p>
      ) : ui === "unsupported" ? (
        <p className="muted-note">
          This browser can&apos;t do web notifications. On iPhone, add the site to your home
          screen first — Safari only allows them for installed apps. Telegram reminders above
          work anywhere.
        </p>
      ) : (
        <>
          <p className="muted-note">
            Get a browser notification when the window opens, and again 2 hours before the
            raider. No account, no Telegram, works without a wallet.{" "}
            <b>
              We only send those two reminders — never a link asking for a signature, a seed
              phrase, or a transfer.
            </b>
          </p>
          <button className="btn btn-neon" disabled={busy} onClick={enable}>
            {busy ? "…" : "TURN ON BROWSER REMINDERS"}
          </button>
          {err && <p className="nick-err">{err}</p>}
        </>
      )}
    </div>
  );
}
