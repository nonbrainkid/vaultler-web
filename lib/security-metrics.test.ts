import { describe, it, expect } from "vitest";
import {
  ALERT_THRESHOLDS,
  SECURITY_EVENTS,
  alertKey,
  alertText,
  bucketOf,
  buildSnapshot,
  counterKey,
  crossedThreshold,
  snapshotKeys,
} from "./security-metrics";

const HOUR = 60 * 60 * 1000;
// Выровнено по началу ведра: иначе «час минус миллисекунда» пересекает границу, и тест
// проверял бы арифметику собственной константы, а не поведение bucketOf.
const NOW = Math.floor(1_785_250_000_000 / HOUR) * HOUR;

describe("вёдра", () => {
  it("одно ведро на час, соседние часы — разные вёдра", () => {
    expect(bucketOf(NOW)).toBe(bucketOf(NOW + HOUR - 1));
    expect(bucketOf(NOW + HOUR)).toBe(bucketOf(NOW) + 1);
  });

  it("ключи разведены по типу события и по ведру", () => {
    expect(counterKey("bad_origin", 5)).not.toBe(counterKey("bad_signature", 5));
    expect(counterKey("bad_origin", 5)).not.toBe(counterKey("bad_origin", 6));
    expect(alertKey("bad_origin", 5)).not.toBe(counterKey("bad_origin", 5));
  });
});

describe("сводка", () => {
  it("порядок ключей и порядок значений совпадают — иначе счётчик припишется чужому событию", () => {
    const keys = snapshotKeys(NOW);
    expect(keys).toHaveLength(SECURITY_EVENTS.length * 2);
    const b = bucketOf(NOW);
    expect(keys[0]).toBe(counterKey(SECURITY_EVENTS[0], b));
    expect(keys[1]).toBe(counterKey(SECURITY_EVENTS[0], b - 1));
    expect(keys[2]).toBe(counterKey(SECURITY_EVENTS[1], b));
  });

  it("читает текущее и предыдущее ведро для каждого события", () => {
    const values = SECURITY_EVENTS.flatMap((_, i) => [String(i + 1), String((i + 1) * 10)]);
    const snap = buildSnapshot(NOW, values);
    expect(snap.events[0].current).toBe(1);
    expect(snap.events[0].previous).toBe(10);
    expect(snap.events[1].current).toBe(2);
    expect(snap.events[1].previous).toBe(20);
  });

  it("пустой KV — нули, а не NaN и не падение", () => {
    const snap = buildSnapshot(NOW, []);
    expect(snap.events.every((e) => e.current === 0 && e.previous === 0)).toBe(true);
    expect(snap.alerting).toBe(false);
  });

  it("мусор в значении считается нулём, а не ломает сводку", () => {
    const snap = buildSnapshot(NOW, ["не число", null, "-5", "", "0"]);
    expect(snap.events.every((e) => e.current >= 0 && e.previous >= 0)).toBe(true);
    expect(Number.isNaN(snap.events[0].current)).toBe(false);
  });

  it("превышение порога поднимает флаг и по событию, и в целом", () => {
    const values: (string | null)[] = new Array(SECURITY_EVENTS.length * 2).fill(null);
    values[0] = String(ALERT_THRESHOLDS[SECURITY_EVENTS[0]]);
    const snap = buildSnapshot(NOW, values);
    expect(snap.events[0].alerting).toBe(true);
    expect(snap.alerting).toBe(true);
  });
});

describe("порог алерта", () => {
  it("срабатывает РОВНО на пересечении, а не на каждом запросе после него", () => {
    const t = ALERT_THRESHOLDS.bad_origin;
    expect(crossedThreshold("bad_origin", t - 1)).toBe(false);
    expect(crossedThreshold("bad_origin", t)).toBe(true);
    // Иначе каждый следующий запрос в том же часе снова требовал бы отправки, и от
    // спама защищал бы только ключ дедупликации — один барьер вместо двух.
    expect(crossedThreshold("bad_origin", t + 1)).toBe(false);
  });

  it("у событий, которых в норме не бывает, порог ниже, чем у шумных", () => {
    expect(ALERT_THRESHOLDS.bad_origin).toBeLessThan(ALERT_THRESHOLDS.bad_signature);
    expect(ALERT_THRESHOLDS.admin_unauthorized).toBeLessThan(ALERT_THRESHOLDS.rate_limited);
  });
});

describe("текст алерта", () => {
  it("говорит, что это сигнал трафика, а не доказательство взлома", () => {
    const t = alertText("bad_signature", 99);
    expect(t).toContain("bad_signature");
    expect(t).toContain("99");
    expect(t.toLowerCase()).toContain("not proof");
  });

  it("не содержит данных игроков: это сообщение про трафик", () => {
    const t = alertText("bad_origin", 11);
    expect(t).not.toContain("wallet:");
    expect(t).not.toContain("dev:");
    expect(t).not.toMatch(/0x[0-9a-fA-F]{40}/);
  });
});
