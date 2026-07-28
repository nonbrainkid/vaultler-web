/**
 * Минимальный клиент Redis по REST. Vercel KV и Upstash Redis отдают один и тот же
 * протокол, различаются только именами env — поддерживаем оба набора.
 *
 * Зачем вообще внешний стор: rate-limit в памяти процесса на Vercel не шарится между
 * инстансами. Атака: злоумышленник просто размазывает запросы, каждый попадает в свежий
 * инстанс с пустым счётчиком — лимит перестаёт существовать. Для борда, который делит
 * реальные токены, это открытая дверь (накрутка кранков, брутфорс входа).
 *
 * Почему REST, а не ioredis: на serverless TCP-соединение не переживает инстанс и
 * открывается заново на каждом холодном старте, а пул быстро выедает лимит подключений
 * Redis. REST — обычный fetch: без пула и без нативных бинарников в бандле.
 */

/** Лимитер не имеет права задерживать ответ пользователю — режем по таймауту. */
const TIMEOUT_MS = 1000;

export interface KvConfig {
  url: string;
  token: string;
}

/** Прочитать конфиг из env. null — стор не подключён (dev или прод до настройки). */
export function kvConfig(): KvConfig | null {
  const url = process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL ?? "";
  const token = process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN ?? "";
  if (!url || !token) return null;
  // Слэш на конце ломает конкатенацию путей — срезаем.
  return { url: url.replace(/\/+$/, ""), token };
}

export interface Kv {
  /**
   * `SET key 1 NX EX ttl` — атомарный «поставить, только если ключа нет».
   * true — ключа не было (действие разрешено), false — уже стоит (слишком часто).
   */
  setIfAbsent(key: string, ttlSec: number): Promise<boolean>;
  /**
   * `INCR key` + `EXPIRE key ttl` одним пайплайном (один round-trip).
   * Возвращает новое значение счётчика.
   */
  bumpCounter(key: string, ttlSec: number): Promise<number>;
  /** `SET key value EX ttl` — записать значение с истечением срока. */
  setValue(key: string, value: string, ttlSec: number): Promise<void>;
  /**
   * `GETDEL key` — атомарно прочитать и удалить значение одной командой.
   *
   * Нужен для одноразовых кодов привязки Telegram (lib/telegram-link.ts): код должен
   * сработать РОВНО один раз. Раздельные GET+DEL оставляли бы окно гонки, в которое два
   * почти одновременных запроса оба прочитали бы код как валидный, — GETDEL закрывает
   * его на уровне самого Redis, а не в нашем коде.
   */
  getAndDelete(key: string): Promise<string | null>;
}

type RedisReply = { result?: unknown; error?: string };

async function post(cfg: KvConfig, path: string, body: unknown): Promise<unknown> {
  const res = await fetch(`${cfg.url}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${cfg.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    // Ответы лимитера кэшировать нельзя ни на каком слое.
    cache: "no-store",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`kv http ${res.status}`);
  return res.json();
}

class RestKv implements Kv {
  constructor(private cfg: KvConfig) {}

  async setIfAbsent(key: string, ttlSec: number): Promise<boolean> {
    const raw = (await post(this.cfg, "/", [
      "SET",
      key,
      "1",
      "NX",
      "EX",
      String(ttlSec),
    ])) as RedisReply;
    if (raw.error) throw new Error(`kv: ${raw.error}`);
    // Redis отвечает "OK", если записал, и null — если ключ уже существовал.
    return raw.result === "OK";
  }

  async bumpCounter(key: string, ttlSec: number): Promise<number> {
    const raw = (await post(this.cfg, "/pipeline", [
      ["INCR", key],
      ["EXPIRE", key, String(ttlSec)],
    ])) as RedisReply[];
    if (!Array.isArray(raw) || raw.length === 0) throw new Error("kv: пустой ответ пайплайна");
    if (raw[0].error) throw new Error(`kv: ${raw[0].error}`);
    const n = Number(raw[0].result);
    if (!Number.isFinite(n)) throw new Error("kv: INCR вернул не число");
    return n;
  }

  async setValue(key: string, value: string, ttlSec: number): Promise<void> {
    const raw = (await post(this.cfg, "/", ["SET", key, value, "EX", String(ttlSec)])) as RedisReply;
    if (raw.error) throw new Error(`kv: ${raw.error}`);
  }

  async getAndDelete(key: string): Promise<string | null> {
    const raw = (await post(this.cfg, "/", ["GETDEL", key])) as RedisReply;
    if (raw.error) throw new Error(`kv: ${raw.error}`);
    return typeof raw.result === "string" ? raw.result : null;
  }
}

let cached: Kv | null | undefined;

/** Клиент Redis либо null, если стор не сконфигурирован. Результат кэшируется. */
export function getKv(): Kv | null {
  if (cached !== undefined) return cached;
  const cfg = kvConfig();
  cached = cfg ? new RestKv(cfg) : null;
  return cached;
}

/** Только для тестов: сбросить кэш клиента после подмены env. */
export function resetKvForTests(): void {
  cached = undefined;
}
