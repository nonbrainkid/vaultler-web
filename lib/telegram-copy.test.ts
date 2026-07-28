/**
 * Гардрейлы копирайтинга (docs/brief-community.md): бот не обещает доходность, не
 * намекает на депозиты/кастодию и — специфично для бота — явно говорит, что ничего не
 * просит. Это тест на РЕАЛЬНЫЕ строки, которые уходят в Telegram, а не на копию текста
 * в тесте (NOTES.md 2026-07-25: тест, подставляющий свой текст вместо константы, однажды
 * пропустил реальный баг).
 */
import { describe, it, expect } from "vitest";
import {
  helpText,
  invalidOrExpiredCodeText,
  linkMovedNoticeText,
  linkedConfirmationText,
  notLinkedText,
  privateChatOnlyText,
  raidWarningText,
  unlinkedConfirmationText,
  windowOpenText,
} from "./telegram-copy";

const ALL_TEXTS: [string, () => string][] = [
  ["windowOpenText", windowOpenText],
  ["raidWarningText", raidWarningText],
  ["linkedConfirmationText", linkedConfirmationText],
  ["linkMovedNoticeText", linkMovedNoticeText],
  ["unlinkedConfirmationText", unlinkedConfirmationText],
  ["notLinkedText", notLinkedText],
  ["privateChatOnlyText", privateChatOnlyText],
  ["invalidOrExpiredCodeText", invalidOrExpiredCodeText],
  ["helpText", helpText],
];

// Слова/фразы, которых в текстах проекта быть не должно (docs/brief-community.md → гардрейлы).
const BANNED = [/\bAPY\b/i, /\bdeposit\b/i, /\bstake\b/i, /\bstaking\b/i, /\bearn\b/i, /\bguarantee/i];

describe("гардрейлы копирайтинга — ни один текст бота их не нарушает", () => {
  for (const [name, fn] of ALL_TEXTS) {
    it(`${name}: без запрещённых слов (APY/deposit/stake/earn/guarantee)`, () => {
      const text = fn();
      for (const re of BANNED) {
        expect(text).not.toMatch(re);
      }
    });
  }

  // Сообщения, которые бот шлёт САМ (не прямой ответ на явную команду игрока) — задание
  // прямо требует строку "бот ничего не просит" как защиту от фишинга под видом
  // "официального" сообщения проекта.
  const PROACTIVE: [string, () => string][] = [
    ["windowOpenText", windowOpenText],
    ["raidWarningText", raidWarningText],
    ["linkedConfirmationText", linkedConfirmationText],
    ["helpText", helpText],
  ];
  for (const [name, fn] of PROACTIVE) {
    it(`${name}: явно говорит, что ничего не просит (seed/подпись/перевод)`, () => {
      const text = fn().toLowerCase();
      expect(text).toContain("never asks");
      expect(text).toContain("seed phrase");
    });
  }

  it("windowOpenText и raidWarningText ведут на канонический домен, не на произвольный URL", () => {
    expect(windowOpenText()).toContain("thevaultler.fun");
    expect(raidWarningText()).toContain("thevaultler.fun");
  });

  it("linkMovedNoticeText не называет ни новый identity, ни chatId — только факт переноса", () => {
    const text = linkMovedNoticeText();
    expect(text).not.toMatch(/wallet:|dev:|0x[0-9a-fA-F]{40}/);
  });
});
