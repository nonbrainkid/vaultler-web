import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  sendTelegramMessage,
  telegramConfigured,
  telegramStatus,
  verifyCronSecret,
  verifyWebhookPath,
  verifyWebhookSecret,
  webhookUrl,
} from "./telegram";

const ORIGINAL_ENV = { ...process.env };
const SECRET32 = "a".repeat(32);
const CRON_SECRET = "0123456789abcdef";

beforeEach(() => {
  delete process.env.TELEGRAM_BOT_TOKEN;
  delete process.env.TELEGRAM_WEBHOOK_SECRET;
  delete process.env.CRON_SECRET;
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.unstubAllGlobals();
});

describe("telegramStatus/telegramConfigured — фича включается ТОЛЬКО всеми тремя env разом", () => {
  it("ничего не задано → off", () => {
    expect(telegramStatus()).toBe("off");
    expect(telegramConfigured()).toBe(false);
  });

  it("только токен → misconfigured, не «частично работает»", () => {
    process.env.TELEGRAM_BOT_TOKEN = "123456789:AAfake-token-for-tests-only";
    expect(telegramStatus()).toBe("misconfigured");
    expect(telegramConfigured()).toBe(false);
  });

  it("секрет вебхука короче 32 символов не считается заданным", () => {
    process.env.TELEGRAM_BOT_TOKEN = "123456789:AAfake-token-for-tests-only";
    process.env.TELEGRAM_WEBHOOK_SECRET = "short";
    process.env.CRON_SECRET = CRON_SECRET;
    expect(telegramStatus()).toBe("misconfigured");
  });

  it("секрет крона короче 16 символов не считается заданным", () => {
    process.env.TELEGRAM_BOT_TOKEN = "123456789:AAfake-token-for-tests-only";
    process.env.TELEGRAM_WEBHOOK_SECRET = SECRET32;
    process.env.CRON_SECRET = "short";
    expect(telegramStatus()).toBe("misconfigured");
  });

  it("все три заданы корректно → on", () => {
    process.env.TELEGRAM_BOT_TOKEN = "123456789:AAfake-token-for-tests-only";
    process.env.TELEGRAM_WEBHOOK_SECRET = SECRET32;
    process.env.CRON_SECRET = CRON_SECRET;
    expect(telegramStatus()).toBe("on");
    expect(telegramConfigured()).toBe(true);
  });
});

describe("verifyWebhookSecret — главный контроль вебхука", () => {
  beforeEach(() => {
    process.env.TELEGRAM_WEBHOOK_SECRET = SECRET32;
  });

  it("верный секрет проходит", () => {
    expect(verifyWebhookSecret(SECRET32)).toBe(true);
  });
  it("неверный секрет — нет", () => {
    expect(verifyWebhookSecret("b".repeat(32))).toBe(false);
  });
  it("null/undefined — нет", () => {
    expect(verifyWebhookSecret(null)).toBe(false);
    expect(verifyWebhookSecret(undefined)).toBe(false);
  });
  it("секрет не задан в env → всегда false (сравнивать не с чем)", () => {
    delete process.env.TELEGRAM_WEBHOOK_SECRET;
    expect(verifyWebhookSecret(SECRET32)).toBe(false);
  });
});

describe("verifyCronSecret", () => {
  beforeEach(() => {
    process.env.CRON_SECRET = CRON_SECRET;
  });
  it("верный Bearer проходит", () => {
    expect(verifyCronSecret(`Bearer ${CRON_SECRET}`)).toBe(true);
  });
  it("неверный токен — нет", () => {
    expect(verifyCronSecret("Bearer wrong-secret-value")).toBe(false);
  });
  it("без префикса 'Bearer ' — нет", () => {
    expect(verifyCronSecret(CRON_SECRET)).toBe(false);
  });
  it("отсутствующий заголовок — нет", () => {
    expect(verifyCronSecret(null)).toBe(false);
    expect(verifyCronSecret(undefined)).toBe(false);
  });
});

describe("sendTelegramMessage", () => {
  beforeEach(() => {
    process.env.TELEGRAM_BOT_TOKEN = "123456789:AAfake-token-for-tests-only";
  });

  it("без токена — ok:false, сеть вообще не трогаем", async () => {
    delete process.env.TELEGRAM_BOT_TOKEN;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(await sendTelegramMessage(1, "hi")).toEqual({ ok: false, blocked: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("успех → ok:true", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ ok: true }) }),
    );
    expect(await sendTelegramMessage(1, "hi")).toEqual({ ok: true, blocked: false });
  });

  it("403 (bot was blocked by the user) → blocked:true", async () => {
    // Единственный сигнал, по которому мы обязаны сами удалить привязку
    // (docs/brief-engineer.md → приватность/отписка), иначе долбимся вечно.
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 403, json: async () => ({}) }),
    );
    expect(await sendTelegramMessage(1, "hi")).toEqual({ ok: false, blocked: true });
  });

  it("429 → отдаёт retryAfterSec из тела ответа Telegram", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 429,
        json: async () => ({ parameters: { retry_after: 7 } }),
      }),
    );
    const res = await sendTelegramMessage(1, "hi");
    expect(res).toEqual({ ok: false, blocked: false, retryAfterSec: 7 });
  });

  it("сетевая ошибка/таймаут не бросает исключение наружу", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNRESET")));
    await expect(sendTelegramMessage(1, "hi")).resolves.toEqual({ ok: false, blocked: false });
  });
});

describe("webhookUrl", () => {
  /**
   * Главная регрессия правки 2026-07-28: в пути НЕ должно быть самого секрета. Раньше он
   * стоял там дословно, и любая утечка URL (логи платформы, история терминала, вывод
   * setWebhook, база Telegram) отдавала вместе с ним заголовок, которым запрос реально
   * аутентифицируется, — два барьера превращались в один.
   */
  it("в пути стоит производная, а не сам секрет", () => {
    process.env.TELEGRAM_WEBHOOK_SECRET = SECRET32;
    const url = webhookUrl("https://thevaultler.fun/");
    expect(url).not.toContain(SECRET32);
    expect(url).toMatch(/^https:\/\/thevaultler\.fun\/api\/telegram\/webhook\/[0-9a-f]{64}$/);
  });

  it("сегмент пути детерминирован: setWebhook и роут обязаны сойтись", () => {
    process.env.TELEGRAM_WEBHOOK_SECRET = SECRET32;
    const segment = webhookUrl("https://thevaultler.fun").split("/").pop()!;
    expect(verifyWebhookPath(segment)).toBe(true);
    expect(verifyWebhookPath(SECRET32)).toBe(false); // старый путь больше не принимается
  });

  it("путь и заголовок — разные значения, одно не проходит вместо другого", () => {
    process.env.TELEGRAM_WEBHOOK_SECRET = SECRET32;
    const segment = webhookUrl("https://thevaultler.fun").split("/").pop()!;
    expect(verifyWebhookSecret(segment)).toBe(false);
    expect(verifyWebhookSecret(SECRET32)).toBe(true);
  });

  it("без секрета в env — бросает, а не строит URL со значением 'undefined'", () => {
    expect(() => webhookUrl("https://thevaultler.fun")).toThrow();
  });
});
