/**
 * Гардрейлы копирайтинга и приватности для веб-пушей.
 *
 * Тест на РЕАЛЬНЫЕ строки, которые уходят в уведомление (NOTES.md 2026-07-25: тест,
 * подставляющий свою копию текста, однажды пропустил настоящий баг).
 *
 * Отдельно проверяется, что в пайлоаде нет ничего персонального: уведомление всплывает на
 * экране блокировки, и оно же — единственное, что получил бы посторонний, узнавший endpoint
 * подписки.
 */
import { describe, expect, it } from "vitest";
import { MAX_PAYLOAD_BYTES } from "./webpush";
import { pushNotification, pushPayload } from "./push-copy";
import type { ReminderKind } from "./reminders";

const KINDS: ReminderKind[] = ["window_open", "raid_warning"];

// Те же запрещённые слова, что и у текстов Telegram-бота (docs/brief-community.md).
const BANNED = [/\bAPY\b/i, /\bdeposit\b/i, /\bstake\b/i, /\bstaking\b/i, /\bearn\b/i, /\bguarantee/i];

describe("тексты веб-пушей — гардрейлы копирайтинга", () => {
  for (const kind of KINDS) {
    it(`${kind}: без запрещённых слов (APY/deposit/stake/earn/guarantee)`, () => {
      const n = pushNotification(kind);
      for (const re of BANNED) {
        expect(n.title).not.toMatch(re);
        expect(n.body).not.toMatch(re);
      }
    });
  }
});

describe("пайлоад веб-пуша — ничего персонального и ничего внешнего", () => {
  for (const kind of KINDS) {
    const json = pushPayload(kind);

    it(`${kind}: только title/body/url/tag, никаких лишних полей`, () => {
      expect(Object.keys(JSON.parse(json)).sort()).toEqual(["body", "tag", "title", "url"]);
    });

    it(`${kind}: нет адресов кошельков и internal id`, () => {
      expect(json).not.toMatch(/0x[0-9a-fA-F]{6}|wallet:|dev:\w/i);
    });

    it(`${kind}: текст одинаков для всех игроков (зависит только от вида события)`, () => {
      // Пайлоад — чистая функция ОДНОГО аргумента, и это свойство защиты: утёкший endpoint
      // не становится утечкой данных игрока, потому что персонализировать уведомление
      // попросту нечем. Никаких чисел (стек, стрик, место) в тексте нет — только правила
      // петли, которые и так написаны на сайте.
      expect(pushPayload(kind)).toBe(json);
      const n = pushNotification(kind);
      const numbers = `${n.title} ${n.body}`.match(/\d+/g) ?? [];
      expect(numbers.sort()).toEqual(kind === "window_open" ? ["1", "12", "15"] : ["2"]);
    });

    it(`${kind}: url — относительный путь, а не внешний домен`, () => {
      const url = JSON.parse(json).url as string;
      expect(url.startsWith("/")).toBe(true);
      expect(url).not.toContain("//");
    });

    it(`${kind}: влезает в лимит записи RFC 8188 с большим запасом`, () => {
      expect(Buffer.byteLength(json)).toBeLessThan(MAX_PAYLOAD_BYTES / 4);
    });
  }

  it("у видов разные теги — окно и рейдер не затирают друг друга", () => {
    expect(pushNotification("window_open").tag).not.toBe(pushNotification("raid_warning").tag);
  });

  it("TTL предупреждения о рейдере не переживает сам рейд", () => {
    // Доставленное после рейда, оно врало бы игроку, что ещё можно успеть.
    expect(pushNotification("raid_warning").ttlSec).toBeLessThanOrEqual(2 * 60 * 60);
    expect(pushNotification("window_open").ttlSec).toBeGreaterThan(
      pushNotification("raid_warning").ttlSec,
    );
  });
});
