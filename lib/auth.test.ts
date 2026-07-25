import { describe, it, expect } from "vitest";
import {
  SIWE_STATEMENT,
  SIWE_STATEMENT_ALLOWED,
  walletIdentity,
  addressFromIdentity,
} from "./auth";

/**
 * Регрессия на поломку, из-за которой вход кошельком не работал вообще.
 *
 * В statement стояло длинное тире «—». EIP-4361 задаёт statement жёсткой ABNF из
 * ASCII-классов RFC 3986, и Phantom проверяет её строго: он отказывался показывать
 * запрос подписи («invalid formatting»), то есть подпись не возвращалась и на сервер
 * ничего не уходило.
 *
 * Тесты этого не поймали, потому что e2e-скрипты подставляли свой ASCII-текст вместо
 * настоящей константы, а сервер statement не проверяет. Теперь скрипты импортируют
 * SIWE_STATEMENT, а charset закреплён здесь.
 */
describe("SIWE_STATEMENT — совместимость с EIP-4361", () => {
  it("только разрешённые ABNF-символы", () => {
    expect(SIWE_STATEMENT).toMatch(SIWE_STATEMENT_ALLOWED);
  });

  it("никаких не-ASCII символов (тире, кавычки-ёлочки, nbsp)", () => {
    const offenders = [...SIWE_STATEMENT]
      .map((ch, i) => ({ i, code: ch.codePointAt(0)! }))
      .filter((x) => x.code > 0x7e || x.code < 0x20);
    expect(offenders).toEqual([]);
  });

  it("без переводов строки — statement обязан быть одной строкой", () => {
    expect(SIWE_STATEMENT).not.toMatch(/[\r\n]/);
  });

  it("сам детектор ловит запрещённые символы", () => {
    // Страховка: если регексп однажды ослабят, проверки выше перестанут что-то значить.
    // Символы собираем из кодов — литеральное тире и nbsp в исходнике невидимы, и любая
    // «нормализация пробелов» тихо убила бы этот тест.
    const EM_DASH = String.fromCodePoint(0x2014);
    const NBSP = String.fromCodePoint(0x00a0);
    const LEFT_QUOTE = String.fromCodePoint(0x201c);

    expect(`no transaction ${EM_DASH} no gas`).not.toMatch(SIWE_STATEMENT_ALLOWED);
    expect(`nbsp${NBSP}inside`).not.toMatch(SIWE_STATEMENT_ALLOWED);
    expect(`smart ${LEFT_QUOTE}quotes`).not.toMatch(SIWE_STATEMENT_ALLOWED);
    expect("plain ascii: ok!").toMatch(SIWE_STATEMENT_ALLOWED);
  });
});

describe("идентичность по кошельку", () => {
  it("адрес приводится к нижнему регистру — один аккаунт на кошелёк", () => {
    expect(walletIdentity("0xAbCdEf0123456789012345678901234567890123")).toBe(
      "wallet:0xabcdef0123456789012345678901234567890123",
    );
  });

  it("адрес достаётся обратно, у анонимной сессии его нет", () => {
    expect(addressFromIdentity("wallet:0xabc")).toBe("0xabc");
    expect(addressFromIdentity("dev:some-uuid")).toBeNull();
  });
});
