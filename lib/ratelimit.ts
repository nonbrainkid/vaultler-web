/**
 * Простой in-memory rate-limit на кранк (анти-спам эндпоинта).
 * Механика и так отклоняет кранк во время завода; это лишь режет частые запросы.
 * Для прода нужен общий стор (Redis/Upstash) — память процесса не шарится между инстансами (см. NOTES.md).
 */
const MIN_INTERVAL_MS = 1000;
const last = new Map<string, number>();

export function allowCrank(identity: string, now: number): boolean {
  const prev = last.get(identity) ?? 0;
  if (now - prev < MIN_INTERVAL_MS) return false;
  last.set(identity, now);
  return true;
}
