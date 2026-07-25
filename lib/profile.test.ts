import { describe, it, expect } from "vitest";
import { validateNickname, nicknameKey } from "./profile";

describe("validateNickname", () => {
  it("принимает нормальные ники", () => {
    expect(validateNickname("Slim_Pete").ok).toBe(true);
    expect(validateNickname("  Rook42  ").value).toBe("Rook42"); // тримит
  });

  it("режет по длине", () => {
    expect(validateNickname("ab").error).toBe("too_short");
    expect(validateNickname("a".repeat(17)).error).toBe("too_long");
  });

  it("только буквы/цифры/подчёркивание", () => {
    expect(validateNickname("bad name").error).toBe("bad_chars");
    expect(validateNickname("emoji😀").error).toBe("bad_chars");
    expect(validateNickname("drop;table").error).toBe("bad_chars");
  });

  it("запрещает зарезервированные (анти-импертонация)", () => {
    expect(validateNickname("anon").error).toBe("reserved");
    expect(validateNickname("ADMIN").error).toBe("reserved");
    expect(validateNickname("Vaultler").error).toBe("reserved");
  });

  it("запрещает ники, маскирующиеся под адрес (0x…)", () => {
    expect(validateNickname("0xDEADBEEF").error).toBe("reserved");
    expect(validateNickname("0Xabc123").error).toBe("reserved");
  });

  it("ключ уникальности без регистра", () => {
    expect(nicknameKey("SlimPete")).toBe(nicknameKey("slimpete"));
  });
});
