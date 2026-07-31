/**
 * Рассылка веб-пушей: кому и что отправить прямо сейчас, как не задвоить и когда выкинуть
 * мёртвую подписку.
 *
 * Полный аналог `lib/telegram-remind.ts`, и это осознанно: расписание («в какой фазе что
 * уместно») у обоих каналов ОДНО — `lib/reminders.ts`. Различаются только адресация (у
 * Telegram один чат на игрока, у пушей — сколько устройств, столько подписок) и признак
 * «доставить больше нельзя» (403 «bot blocked» против 404/410 от push-сервиса).
 *
 * ПУШИ НЕ МУТИРУЮТ ИГРОВОЙ СТЕЙТ: `duePushReminders` получает уже посчитанные состояния
 * (вызывающий код применяет `settle()` В ПАМЯТИ, как это делает GET /api/state и
 * buildLeaderboard) и только решает, кому что отправить. Ни одного `store.mutate` здесь нет
 * и быть не должно — напоминание не может начислить стек.
 */
import { GAME } from "./game";
import { getKv } from "./kv";
import { endpointFingerprint } from "./push-subscription";
import { DEFAULT_WARN_BEFORE_MS, dueKinds, type ReminderKind } from "./reminders";
import type { PlayerState } from "./game";

/** То, что нужно рассылке от записи стора (полный тип — `PushSubscriptionRecord`). */
export interface PushSubscriptionLike {
  identity: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  /** Подряд неудачных отправок. Растёт на сетевых сбоях, обнуляется успехом. */
  failures: number;
}

export interface DuePush extends PushSubscriptionLike {
  kind: ReminderKind;
  /** Часть ключа идемпотентности — см. `reservePush`. */
  lastCrankAt: number;
}

/**
 * Сколько подряд неудач терпим, прежде чем выкинуть подписку.
 *
 * Не «одна неудача — удалить»: 429 и сетевой сбой у push-сервиса случаются, и живая подписка
 * не должна погибнуть от чужой аварии. Но и не бесконечно: тик крона — 10 минут, событий у
 * игрока до двух за цикл, значит 8 неудач подряд — это часы полной недоступности именно
 * этого endpoint'а. Такие уже не оживают, а место в прогоне занимают.
 */
export const MAX_PUSH_FAILURES = 8;

export function pushFailureExhausted(failures: number): boolean {
  return failures >= MAX_PUSH_FAILURES;
}

/**
 * Какие пуши надо отправить сейчас: по одному на каждую пару (подписка × актуальное событие).
 *
 * Чистая функция: не читает `Date.now()`, не трогает сеть/БД.
 */
export function duePushReminders(
  players: readonly { identity: string; state: PlayerState }[],
  subscriptions: readonly PushSubscriptionLike[],
  now: number,
  warnBeforeMs: number = DEFAULT_WARN_BEFORE_MS,
): DuePush[] {
  if (subscriptions.length === 0) return [];

  const byIdentity = new Map<string, PushSubscriptionLike[]>();
  for (const s of subscriptions) {
    const list = byIdentity.get(s.identity);
    if (list) list.push(s);
    else byIdentity.set(s.identity, [s]);
  }

  const out: DuePush[] = [];
  for (const p of players) {
    const subs = byIdentity.get(p.identity);
    if (!subs) continue; // у игрока нет ни одной подписки — отправлять некуда

    const kinds = dueKinds(p.state, now, warnBeforeMs);
    if (kinds.length === 0) continue;
    // lastCrankAt заведомо не null: dueKinds вернул непустой список только для заведённой машины.
    const lastCrankAt = p.state.lastCrankAt!;
    for (const sub of subs) {
      for (const kind of kinds) out.push({ ...sub, kind, lastCrankAt });
    }
  }
  return out;
}

// ---- Идемпотентность: (endpoint, lastCrankAt, kind) ----
//
// Ключ включает lastCrankAt — он меняется на каждом новом заводе машины, поэтому у нового
// цикла всегда свежий ключ (напоминания приходят снова), а повторный тик крона внутри одного
// цикла — нет. Ключуем по ОТПЕЧАТКУ endpoint'а, а не по identity: у игрока может быть
// телефон и ноутбук, и дедуп по игроку оставил бы второе устройство без уведомления.

const PREFIX = "vltr:pushremind";
const DEDUP_TTL_SEC = Math.ceil((GAME.WIND_MS + GAME.GRACE_MS) / 1000) + 3600;

// Фолбэк в память процесса — тот же компромисс, что в lib/ratelimit.ts и
// lib/telegram-remind.ts: без общего KV перезапуск/масштабирование инстансов может повторно
// прислать уведомление, но сайт не падает.
const seen = new Map<string, number>();
function memSetIfAbsent(key: string, ttlSec: number, now: number): boolean {
  const exp = seen.get(key);
  if (exp !== undefined && exp > now) return false;
  seen.set(key, now + ttlSec * 1000);
  if (seen.size > 5000) {
    for (const [k, e] of seen) if (e <= now) seen.delete(k);
  }
  return true;
}

let lastWarnAt: number | null = null;
function warnKvDown(err: unknown, now: number): void {
  if (lastWarnAt !== null && now - lastWarnAt < 60_000) return;
  lastWarnAt = now;
  console.warn("[push-remind] общий стор недоступен, откат в память процесса:", err);
}

/** Зарезервировать право отправить именно ЭТО уведомление. false — уже отправлено. */
export async function reservePush(r: DuePush, now: number): Promise<boolean> {
  const key = `${PREFIX}:${endpointFingerprint(r.endpoint)}:${r.lastCrankAt}:${r.kind}`;
  const kv = getKv();
  if (kv) {
    try {
      return await kv.setIfAbsent(key, DEDUP_TTL_SEC);
    } catch (err) {
      warnKvDown(err, now);
    }
  }
  return memSetIfAbsent(key, DEDUP_TTL_SEC, now);
}

// ---- Прогон рассылки (IO вынесено в зависимости — тестируется без сети) ----

export interface PushRunDeps {
  send: (target: DuePush) => Promise<{ ok: boolean; gone: boolean }>;
  /** Физически удалить подписку по endpoint'у (мертва или исчерпала попытки). */
  drop: (endpoint: string) => Promise<void>;
  /** Записать результат отправки; возвращает новое число подряд неудач. */
  noteResult: (endpoint: string, ok: boolean) => Promise<number>;
  reserve: (r: DuePush, now: number) => Promise<boolean>;
}

export interface PushRunSummary {
  sent: number;
  skippedDuplicate: number;
  /** Удалено, потому что push-сервис ответил 404/410 (подписка отозвана). */
  droppedGone: number;
  /** Удалено, потому что подряд провалило MAX_PUSH_FAILURES отправок. */
  droppedExhausted: number;
  /** Не доставлено по временной причине (сеть, 429) — подписка сохранена. */
  failed: number;
}

/**
 * Прогнать список: бронируем слот идемпотентности, отправляем, чистим мёртвое.
 * Зависимости параметрами — юнит-тест не трогает ни сеть, ни KV, ни стор.
 */
export async function runPushReminders(
  due: readonly DuePush[],
  now: number,
  deps: PushRunDeps,
): Promise<PushRunSummary> {
  const summary: PushRunSummary = {
    sent: 0,
    skippedDuplicate: 0,
    droppedGone: 0,
    droppedExhausted: 0,
    failed: 0,
  };
  /** Уже удалённые в этом прогоне endpoint'ы: у подписки бывает два due-события разом. */
  const dropped = new Set<string>();

  for (const r of due) {
    if (dropped.has(r.endpoint)) continue;

    // Слот бронируем ДО отправки: сдвоенный или запоздавший тик крона не должен показать
    // одно и то же уведомление дважды. Плата — при последующем сбое отправки напоминание
    // для этого цикла «сгорает». Это дешевле, чем задвоить сообщение.
    if (!(await deps.reserve(r, now))) {
      summary.skippedDuplicate++;
      continue;
    }

    const res = await deps.send(r);
    if (res.ok) {
      summary.sent++;
      // Пишем в стор только если счётчик реально надо обнулить — иначе успешный прогон
      // делал бы запись в БД на каждое уведомление без всякой пользы.
      if (r.failures > 0) await deps.noteResult(r.endpoint, true);
      continue;
    }

    if (res.gone) {
      // 404/410: подписки больше нет (разрешение отозвано, браузер очищен). Удаляем сами,
      // иначе будем стучаться в неё на каждом тике до конца времён.
      await deps.drop(r.endpoint);
      dropped.add(r.endpoint);
      summary.droppedGone++;
      continue;
    }

    const failures = await deps.noteResult(r.endpoint, false);
    if (pushFailureExhausted(failures)) {
      await deps.drop(r.endpoint);
      dropped.add(r.endpoint);
      summary.droppedExhausted++;
    } else {
      summary.failed++;
    }
  }
  return summary;
}

/** Только для тестов: сбросить карту дедупа в памяти между кейсами. */
export function resetPushRemindMemoryForTests(): void {
  seen.clear();
  lastWarnAt = null;
}
