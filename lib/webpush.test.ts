/**
 * Проверка криптографии веб-пушей ОФИЦИАЛЬНЫМ тестовым вектором RFC 8291 §5.
 *
 * Это главный аргумент за собственную реализацию вместо npm-пакета: при фиксированных
 * ключах и salt результат должен совпасть со стандартом байт в байт. Опечатка в info-строке
 * («WebPush: info» без нулевого байта), перепутанный порядок публичных ключей в `key_info`,
 * забытый разделитель 0x02 или DER вместо raw в подписи — каждое из этого валит тест здесь,
 * а не в чужом браузере, где отладочной информации нет вообще.
 */
import { describe, expect, it } from "vitest";
import {
  createDecipheriv,
  createECDH,
  createHmac,
  createPublicKey,
  randomBytes,
  verify as verifyRaw,
} from "node:crypto";
import {
  MAX_PAYLOAD_BYTES,
  b64uToBuf,
  bufToB64u,
  encryptPushPayload,
  vapidAuthorization,
} from "./webpush";

// ── Вектор RFC 8291 §5 ──
const V = {
  plaintext: "When I grow up, I want to be a watermelon",
  asPrivate: "yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw",
  asPublic: "BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8",
  uaPublic: "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4",
  authSecret: "BTBZMqHH6r4Tts7J_aSIgg",
  salt: "DGv6ra1nlYgDCS1FRnbzlw",
  header:
    "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8",
  /**
   * Итоговое тело из RFC 8291 §5 (header ‖ ciphertext одной строкой — именно в таком виде
   * стандарт печатает результат). Сверяем с ним, а не с отдельно взятым ciphertext: у
   * заголовка длина 86 байт, то есть не кратна 3, и base64url ciphertext'а «в одиночку»
   * выглядит иначе, чем его же хвост внутри общей строки — на этом легко ошибиться.
   */
  body:
    "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN",
};

const KEYS = { p256dh: V.uaPublic, auth: V.authSecret };

describe("encryptPushPayload — вектор RFC 8291 §5", () => {
  const body = encryptPushPayload(V.plaintext, KEYS, {
    salt: b64uToBuf(V.salt),
    serverPrivateKey: b64uToBuf(V.asPrivate),
  });

  it("тело целиком совпадает с эталоном стандарта", () => {
    expect(bufToB64u(body)).toBe(V.body);
    expect(body.length).toBe(144);
  });

  it("header: salt(16) + rs=4096 + длина ключа(65) + публичный ключ сервера", () => {
    expect(bufToB64u(body.subarray(0, 86))).toBe(V.header);
    expect(body.subarray(0, 16).toString("base64url")).toBe(V.salt);
    expect(body.readUInt32BE(16)).toBe(4096);
    expect(body[20]).toBe(65);
    expect(bufToB64u(body.subarray(21, 86))).toBe(V.asPublic);
  });

  it("ciphertext = plaintext + разделитель 0x02 + тег GCM(16)", () => {
    const ct = body.subarray(86);
    expect(ct.length).toBe(Buffer.byteLength(V.plaintext) + 1 + 16);
  });
});

describe("encryptPushPayload — эфемерность и валидация входа", () => {
  it("без фиксированных параметров два вызова дают разные тела (новая пара + новый salt)", () => {
    // Повтор salt+ключа при том же CEK означал бы повтор nonce в GCM — это ломает не
    // только приватность, но и аутентичность сообщений.
    const a = encryptPushPayload("hi", KEYS);
    const b = encryptPushPayload("hi", KEYS);
    expect(bufToB64u(a)).not.toBe(bufToB64u(b));
    expect(a.subarray(0, 16).equals(b.subarray(0, 16))).toBe(false);
  });

  it("p256dh неверной длины — отказ, а не молчаливая отправка мусора", () => {
    expect(() => encryptPushPayload("hi", { p256dh: "AAAA", auth: V.authSecret })).toThrow();
  });

  it("auth неверной длины — отказ", () => {
    expect(() => encryptPushPayload("hi", { p256dh: V.uaPublic, auth: "AAAA" })).toThrow();
  });

  it("payload больше предела записи — отказ на нашей стороне, а не 413 от сервиса", () => {
    expect(() => encryptPushPayload("x".repeat(MAX_PAYLOAD_BYTES + 1), KEYS)).toThrow();
    expect(() => encryptPushPayload("x".repeat(MAX_PAYLOAD_BYTES), KEYS)).not.toThrow();
  });
});

describe("encryptPushPayload — расшифровка на стороне «браузера»", () => {
  /**
   * Обратный проход со СЛУЧАЙНЫМИ ключами: вектор RFC проверяет фиксированный случай, а этот
   * тест — путь с эфемерной парой на каждое сообщение. Ловит целый класс ошибок, который
   * вектор не увидел бы: в header попал не тот публичный ключ, что использован в ECDH. В
   * проде это выглядело бы как «уведомления уходят, но браузер их молча выбрасывает».
   */
  it("payload, зашифрованный для подписки, читается её приватным ключом", () => {
    const ua = createECDH("prime256v1");
    ua.generateKeys();
    const authSecret = randomBytes(16);
    const plaintext = '{"title":"🔓 The window is open","body":"Crank now."}';

    const body = encryptPushPayload(plaintext, {
      p256dh: bufToB64u(ua.getPublicKey()),
      auth: bufToB64u(authSecret),
    });

    // Разбор по RFC 8188: salt(16) | rs(4) | idlen(1) | as_public(idlen) | ciphertext
    const salt = body.subarray(0, 16);
    const idlen = body[20];
    const asPublic = body.subarray(21, 21 + idlen);
    const ciphertext = body.subarray(21 + idlen);

    const shared = ua.computeSecret(asPublic);
    const ext = (s: Buffer, ikm: Buffer) => createHmac("sha256", s).update(ikm).digest();
    const exp = (prk: Buffer, info: string, len: number) =>
      createHmac("sha256", prk)
        .update(Buffer.concat([Buffer.from(info, "utf8"), Buffer.from([1])]))
        .digest()
        .subarray(0, len);

    const prkKey = ext(authSecret, shared);
    const keyInfo = Buffer.concat([
      Buffer.from("WebPush: info\0", "utf8"),
      ua.getPublicKey(),
      asPublic,
    ]);
    const ikm = createHmac("sha256", prkKey)
      .update(Buffer.concat([keyInfo, Buffer.from([1])]))
      .digest();
    const prk = ext(salt, ikm);
    const cek = exp(prk, "Content-Encoding: aes128gcm\0", 16);
    const nonce = exp(prk, "Content-Encoding: nonce\0", 12);

    const decipher = createDecipheriv("aes-128-gcm", cek, nonce);
    decipher.setAuthTag(ciphertext.subarray(ciphertext.length - 16));
    const padded = Buffer.concat([
      decipher.update(ciphertext.subarray(0, ciphertext.length - 16)),
      decipher.final(),
    ]);

    expect(padded[padded.length - 1]).toBe(2); // разделитель последней записи
    expect(padded.subarray(0, padded.length - 1).toString("utf8")).toBe(plaintext);
  });
});

describe("vapidAuthorization — RFC 8292", () => {
  // Пара сгенерирована на месте: держать даже тестовые VAPID-ключи в файле не нужно,
  // а согласованность d/x/y проверяется самим createPrivateKey внутри реализации.
  const { publicKey, privateKey } = (() => {
    const ecdh = createECDH("prime256v1");
    ecdh.generateKeys();
    return {
      publicKey: bufToB64u(ecdh.getPublicKey()),
      privateKey: bufToB64u(ecdh.getPrivateKey()),
    };
  })();
  const keys = { publicKey, privateKey };
  const NOW = 2_000_000_000_000;
  const endpoint = "https://push.example.com/send/abc?x=1";

  it("схема vapid: t=<jwt>, k=<публичный ключ>", () => {
    const h = vapidAuthorization(endpoint, keys, "mailto:owner@example.com", NOW);
    expect(h.startsWith("vapid t=")).toBe(true);
    expect(h).toContain(`, k=${publicKey}`);
  });

  it("aud — только origin эндпоинта (не путь и не query)", () => {
    const h = vapidAuthorization(endpoint, keys, "mailto:owner@example.com", NOW);
    const jwt = h.slice("vapid t=".length).split(",")[0];
    const payload = JSON.parse(Buffer.from(jwt.split(".")[1], "base64url").toString());
    expect(payload.aud).toBe("https://push.example.com");
    expect(payload.sub).toBe("mailto:owner@example.com");
    expect(payload.exp).toBe(Math.floor(NOW / 1000) + 12 * 60 * 60);
  });

  it("подпись — сырая R||S (64 байта) и проверяется публичным ключом", () => {
    const h = vapidAuthorization(endpoint, keys, "mailto:owner@example.com", NOW);
    const jwt = h.slice("vapid t=".length).split(",")[0];
    const [head, payload, sig] = jwt.split(".");
    const signature = b64uToBuf(sig);
    expect(signature.length).toBe(64); // DER был бы ~70 и переменной длины

    const pub = b64uToBuf(publicKey);
    const key = createPublicKey({
      key: {
        kty: "EC",
        crv: "P-256",
        x: bufToB64u(pub.subarray(1, 33)),
        y: bufToB64u(pub.subarray(33, 65)),
      },
      format: "jwk",
    });
    const okSig = verifyRaw(
      "sha256",
      Buffer.from(`${head}.${payload}`, "utf8"),
      { key, dsaEncoding: "ieee-p1363" },
      signature,
    );
    expect(okSig).toBe(true);
  });

  it("несогласованная пара ключей отвергается сразу, а не 401 от push-сервиса", () => {
    const other = (() => {
      const e = createECDH("prime256v1");
      e.generateKeys();
      return bufToB64u(e.getPrivateKey());
    })();
    expect(() =>
      vapidAuthorization(endpoint, { publicKey, privateKey: other }, "mailto:a@b.c", NOW),
    ).toThrow();
  });
});
