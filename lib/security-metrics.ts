/**
 * Счётчики отказов безопасности (задача 1.5, docs/brief-engineer.md).
 *
 * Проблема, которую это закрывает: всплеск 401 `bad_signature` / 403 `bad_origin` / 429 —
 * это сигнал атаки, но до сих пор он уходил ТОЛЬКО клиенту, то есть атакующему. Владелец
 * узнал бы об инциденте последним, уже по последствиям. Сценарий D в `docs/growth-plan.md`
 * прямо называет это дырой в рантбуке: «мы обнаружим атаку последними».
 *
 * Устройство намеренно примитивное — это счётчики, а не система наблюдаемости:
 *
 *  - события кладутся в почасовые вёдра в KV (он уже подключён и общий для всех инстансов,
 *    в отличие от памяти процесса, где на serverless каждый запрос попадает в свежий счётчик);
 *  - сводка читает текущее ведро и предыдущее — этого достаточно, чтобы отличить «фон» от
 *    «сейчас что-то происходит», и не требует ни хранилища рядов, ни графиков;
 *  - алерт шлётся не чаще раза в час на тип события, иначе первый же всплеск превращает
 *    наш собственный бот в спамера и его перестают читать ровно тогда, когда он нужен.
 *
 * ВАЖНО: счётчики наружу не отдаются. Публичный эндпоинт со статистикой отказов — это
 * подсказка атакующему: по нему видно, срабатывает ли подбор и не пора ли сменить тактику.
 * Читает их только владелец через `ADMIN_SECRET` (тот же барьер, что у close-week).
 */

/** Типы отказов, которые имеет смысл считать. Не всякий 4xx — сигнал. */
export const SECURITY_EVENTS = [
  /** Подпись SIWE не сошлась: подбор или релей чужой подписи. */
  "bad_signature",
  /** POST с чужого origin: попытка CSRF. */
  "bad_origin",
  /** Упёрлись в rate-limit: флуд или перебор. */
  "rate_limited",
  /** Неверный ADMIN_SECRET: кто-то нашёл админский роут и подбирает. */
  "admin_unauthorized",
  /** Вебхук Telegram с неверным секретом: URL утёк либо его подбирают. */
  "webhook_rejected",
] as const;

export type SecurityEvent = (typeof SECURITY_EVENTS)[number];

/**
 * Пороги на час. Подобраны так, чтобы обычный день не шумел:
 *
 * - `bad_origin` и `admin_unauthorized` в норме РАВНЫ НУЛЮ — легитимный клиент их не
 *   производит вовсе, поэтому порог низкий: несколько штук уже означают, что кто-то
 *   целенаправленно ковыряет;
 * - `bad_signature` бывает и от честного игрока (отказался подписывать, старый nonce),
 *   поэтому порог заметно выше;
 * - `rate_limited` шумит больше всех: в него упирается и просто нетерпеливый клиент.
 */
export const ALERT_THRESHOLDS: Record<SecurityEvent, number> = {
  bad_signature: 40,
  bad_origin: 10,
  rate_limited: 300,
  admin_unauthorized: 5,
  webhook_rejected: 20,
};

const HOUR_MS = 60 * 60 * 1000;
/** Держим три часа: сводке нужно два ведра, третье — запас на границе. */
export const BUCKET_TTL_SEC = 3 * 60 * 60;

/** Номер почасового ведра. Обычное деление — вёдра не обязаны совпадать с календарём. */
export function bucketOf(now: number): number {
  return Math.floor(now / HOUR_MS);
}

export function counterKey(event: SecurityEvent, bucket: number): string {
  return `vltr:sec:${event}:${bucket}`;
}

/** Ключ дедупликации алерта: один на тип события в час. */
export function alertKey(event: SecurityEvent, bucket: number): string {
  return `vltr:sec:alerted:${event}:${bucket}`;
}

export interface EventCounts {
  event: SecurityEvent;
  /** Сколько за текущий (неполный) час. */
  current: number;
  /** Сколько за предыдущий полный час — база для сравнения. */
  previous: number;
  /** Порог, при достижении которого шлём алерт. */
  threshold: number;
  /** Превышен ли порог прямо сейчас. */
  alerting: boolean;
}

export interface SecuritySnapshot {
  bucket: number;
  events: EventCounts[];
  /** Есть ли хоть одно событие за порогом — короткий ответ на «всё ли спокойно». */
  alerting: boolean;
}

/** Ключи, которые нужно прочитать для сводки: по два ведра на событие, в стабильном порядке. */
export function snapshotKeys(now: number): string[] {
  const b = bucketOf(now);
  return SECURITY_EVENTS.flatMap((e) => [counterKey(e, b), counterKey(e, b - 1)]);
}

function toCount(raw: string | null): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * Сырые значения из KV → сводка. Порядок значений обязан совпадать с `snapshotKeys`;
 * функция чистая, поэтому её легко проверить тестом, не поднимая Redis.
 */
export function buildSnapshot(now: number, values: readonly (string | null)[]): SecuritySnapshot {
  const events = SECURITY_EVENTS.map((event, i) => {
    const current = toCount(values[i * 2] ?? null);
    const previous = toCount(values[i * 2 + 1] ?? null);
    const threshold = ALERT_THRESHOLDS[event];
    return { event, current, previous, threshold, alerting: current >= threshold };
  });
  return { bucket: bucketOf(now), events, alerting: events.some((e) => e.alerting) };
}

/**
 * Нужно ли слать алерт по этому событию.
 *
 * Отдельно от `buildSnapshot`, потому что решение об отправке принимается в момент
 * инкремента (когда мы знаем новое значение счётчика), а сводка читается отдельно и
 * ничего не отправляет.
 */
export function crossedThreshold(event: SecurityEvent, countAfterIncrement: number): boolean {
  // Строгое равенство, а не `>=`: алерт должен сработать РОВНО на пересечении порога.
  // При `>=` каждый следующий запрос в том же часе снова считался бы поводом, и защитой
  // от спама остался бы только ключ дедупликации — то есть один барьер вместо двух.
  return countAfterIncrement === ALERT_THRESHOLDS[event];
}

/** Текст алерта. Без адресов, id и прочих данных игроков — это сообщение про трафик. */
export function alertText(event: SecurityEvent, count: number): string {
  return (
    `⚠️ VAULTLER security\n\n` +
    `${event}: ${count} in the last hour (threshold ${ALERT_THRESHOLDS[event]}).\n\n` +
    `This is a traffic signal, not proof of a breach. Check /api/admin/security.`
  );
}
