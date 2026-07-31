/**
 * Криптография веб-пушей: шифрование payload (RFC 8291 / RFC 8188, `aes128gcm`) и
 * подпись VAPID-заголовка (RFC 8292, ES256).
 *
 * ПОЧЕМУ БЕЗ ЗАВИСИМОСТИ (`web-push` и подобные). Всё, что здесь нужно, есть в
 * `node:crypto`: ECDH на P-256, HKDF-SHA-256 (это два HMAC), AES-128-GCM и подпись ES256.
 * Пакет добавил бы транзитивные зависимости в проект, который держит правило «не тащить
 * непроверенный код» и в котором аудит секретов/бандла — часть процесса. Взамен корректность
 * проверяется НЕ «оно как-то доехало до браузера», а официальным тестовым вектором RFC 8291
 * §5 (`lib/webpush.test.ts`): фиксированные ключи и salt → байт в байт тот же результат, что
 * в стандарте. Ошибка в info-строке или в порядке склейки провалит тест сразу, а не в проде.
 *
 * Модуль чистый в том смысле, что не читает env и не ходит в сеть: ключи и salt приходят
 * аргументами (salt по умолчанию случайный). Конфигурация фичи — `lib/push.ts`.
 */
import {
  createCipheriv,
  createECDH,
  createHmac,
  createPrivateKey,
  randomBytes,
  sign as signRaw,
} from "node:crypto";

/** Размер записи из заголовка `aes128gcm`. 4096 — то, что гарантированно принимают сервисы. */
export const RECORD_SIZE = 4096;

/** Тег GCM (16) + байт-разделитель паддинга (1) в запись тоже входят. */
export const MAX_PAYLOAD_BYTES = RECORD_SIZE - 16 - 1;

const P256_UNCOMPRESSED_LEN = 65; // 0x04 || X(32) || Y(32)
const AUTH_SECRET_LEN = 16;

export function b64uToBuf(s: string): Buffer {
  return Buffer.from(s, "base64url");
}

export function bufToB64u(b: Buffer): string {
  return b.toString("base64url");
}

/** HKDF-Extract = HMAC(salt, ikm). Отдельно от Expand — RFC 8291 использует шаги вразбивку. */
function hkdfExtract(salt: Buffer, ikm: Buffer): Buffer {
  return createHmac("sha256", salt).update(ikm).digest();
}

/**
 * HKDF-Expand на ОДНУ итерацию: все выходы здесь ≤ 32 байт (длина SHA-256), поэтому
 * T(2) и далее не нужны. Если однажды понадобится больше — надо дописать цикл, а не
 * растягивать первый блок.
 */
function hkdfExpand(prk: Buffer, info: Buffer, length: number): Buffer {
  if (length > 32) throw new Error("hkdfExpand: >32 байт требует нескольких итераций");
  return createHmac("sha256", prk)
    .update(Buffer.concat([info, Buffer.from([1])]))
    .digest()
    .subarray(0, length);
}

/** Ключи подписки из браузера (`PushSubscription.getKey`), base64url. */
export interface PushKeys {
  /** Публичный ключ агента, uncompressed P-256 (65 байт). */
  p256dh: string;
  /** Секрет аутентификации подписки (16 байт). */
  auth: string;
}

export interface EncryptOptions {
  /** Только для тестов/векторов: фиксированный salt (16 байт). По умолчанию случайный. */
  salt?: Buffer;
  /** Только для тестов/векторов: фиксированный эфемерный приватный ключ сервера. */
  serverPrivateKey?: Buffer;
}

/**
 * Зашифровать тело пуша по RFC 8291. Возвращает готовое тело запроса
 * (`Content-Encoding: aes128gcm`): header со salt и публичным ключом сервера + ciphertext.
 *
 * Эфемерная пара ключей генерируется НА КАЖДОЕ сообщение — так требует RFC 8291 §3.1, и это
 * не формальность: переиспользование пары вместе с фиксированным salt дало бы повтор nonce
 * при том же CEK, а повтор nonce в GCM ломает не только конфиденциальность, но и
 * аутентичность (по двум сообщениям восстанавливается ключ аутентификации тега).
 */
export function encryptPushPayload(
  plaintext: string,
  keys: PushKeys,
  opts: EncryptOptions = {},
): Buffer {
  const uaPublic = b64uToBuf(keys.p256dh);
  const authSecret = b64uToBuf(keys.auth);
  if (uaPublic.length !== P256_UNCOMPRESSED_LEN || uaPublic[0] !== 0x04) {
    throw new Error("webpush: p256dh должен быть uncompressed P-256 (65 байт)");
  }
  if (authSecret.length !== AUTH_SECRET_LEN) {
    throw new Error("webpush: auth должен быть 16 байт");
  }

  const body = Buffer.from(plaintext, "utf8");
  if (body.length > MAX_PAYLOAD_BYTES) {
    // Лучше явная ошибка на нашей стороне, чем 413 от push-сервиса, который в логах
    // выглядит как «подписка сломалась» и провоцирует удалить живую подписку.
    throw new Error(`webpush: payload больше ${MAX_PAYLOAD_BYTES} байт`);
  }

  const salt = opts.salt ?? randomBytes(16);
  if (salt.length !== 16) throw new Error("webpush: salt должен быть 16 байт");

  const ecdh = createECDH("prime256v1");
  if (opts.serverPrivateKey) ecdh.setPrivateKey(opts.serverPrivateKey);
  else ecdh.generateKeys();
  const asPublic = ecdh.getPublicKey();
  const sharedSecret = ecdh.computeSecret(uaPublic);

  // RFC 8291 §3.3–3.4: сначала «сжимаем» ECDH-секрет секретом подписки, затем привязываем
  // результат к ОБОИМ публичным ключам. Привязка ключей — не украшение: без неё сообщение,
  // зашифрованное для одной подписки, можно было бы подсунуть как валидное другой.
  const prkKey = hkdfExtract(authSecret, sharedSecret);
  const keyInfo = Buffer.concat([Buffer.from("WebPush: info\0", "utf8"), uaPublic, asPublic]);
  const ikm = hkdfExpand(prkKey, keyInfo, 32);

  const prk = hkdfExtract(salt, ikm);
  const cek = hkdfExpand(prk, Buffer.from("Content-Encoding: aes128gcm\0", "utf8"), 16);
  const nonce = hkdfExpand(prk, Buffer.from("Content-Encoding: nonce\0", "utf8"), 12);

  // 0x02 — разделитель последней (и единственной) записи. Паддинг не добавляем: длина
  // сообщения и так не секрет (текст напоминания фиксирован и одинаков для всех).
  const cipher = createCipheriv("aes-128-gcm", cek, nonce);
  const ciphertext = Buffer.concat([
    cipher.update(Buffer.concat([body, Buffer.from([2])])),
    cipher.final(),
    cipher.getAuthTag(),
  ]);

  const rs = Buffer.alloc(4);
  rs.writeUInt32BE(RECORD_SIZE, 0);
  const header = Buffer.concat([salt, rs, Buffer.from([asPublic.length]), asPublic]);
  return Buffer.concat([header, ciphertext]);
}

export interface VapidKeys {
  /** base64url, uncompressed P-256 (65 байт) — уходит в заголовок и в браузер. */
  publicKey: string;
  /** base64url, 32 байта. Только на сервере. */
  privateKey: string;
}

/** Срок жизни JWT. RFC 8292 разрешает до 24 ч; берём половину — короче живёт, меньше ущерб. */
const VAPID_TTL_SEC = 12 * 60 * 60;

function jwtSegment(obj: unknown): string {
  return Buffer.from(JSON.stringify(obj), "utf8").toString("base64url");
}

/**
 * Приватный ключ VAPID (32-байтный скаляр) → KeyObject через JWK.
 *
 * Пара проверяется на согласованность ЯВНО: из скаляра выводится публичный ключ и
 * сравнивается с заданным. `createPrivateKey` этого не делает — он принимает JWK с любыми
 * x/y, — а последствие рассогласования неочевидное: заголовок выглядит валидным, но
 * push-сервис отвергает его с 401, и разбираться пришлось бы по чужим логам. Самая вероятная
 * причина рассогласования — перепутанные местами значения `VAPID_PUBLIC_KEY` /
 * `VAPID_PRIVATE_KEY` в панели env.
 */
function vapidPrivateKeyObject(keys: VapidKeys) {
  const pub = b64uToBuf(keys.publicKey);
  const d = b64uToBuf(keys.privateKey);
  if (pub.length !== P256_UNCOMPRESSED_LEN || pub[0] !== 0x04) {
    throw new Error("vapid: публичный ключ должен быть uncompressed P-256 (65 байт)");
  }
  if (d.length !== 32) throw new Error("vapid: приватный ключ должен быть 32 байта");

  const probe = createECDH("prime256v1");
  probe.setPrivateKey(d);
  if (!probe.getPublicKey().equals(pub)) {
    throw new Error("vapid: VAPID_PUBLIC_KEY не соответствует VAPID_PRIVATE_KEY");
  }

  return createPrivateKey({
    key: {
      kty: "EC",
      crv: "P-256",
      x: bufToB64u(pub.subarray(1, 33)),
      y: bufToB64u(pub.subarray(33, 65)),
      d: bufToB64u(d),
    },
    format: "jwk",
  });
}

/**
 * Заголовок `Authorization` для запроса к push-сервису (VAPID, схема из RFC 8292).
 *
 * `aud` — ТОЛЬКО origin эндпоинта: JWT, выписанный для одного сервиса, не должен быть
 * предъявляем другому. `sub` — контакт владельца: сервис обращается по нему, если наша
 * рассылка начинает вести себя как спам, — и это единственная причина, по которой поле есть.
 */
export function vapidAuthorization(
  endpoint: string,
  keys: VapidKeys,
  subject: string,
  now: number,
): string {
  const aud = new URL(endpoint).origin;
  const header = jwtSegment({ typ: "JWT", alg: "ES256" });
  const payload = jwtSegment({
    aud,
    exp: Math.floor(now / 1000) + VAPID_TTL_SEC,
    sub: subject,
  });
  const signingInput = Buffer.from(`${header}.${payload}`, "utf8");
  // `ieee-p1363` — «сырая» подпись R||S (64 байта), как требует JWS/ES256. По умолчанию
  // Node отдаёт DER, и такой JWT молча отвергается всеми push-сервисами.
  const signature = signRaw("sha256", signingInput, {
    key: vapidPrivateKeyObject(keys),
    dsaEncoding: "ieee-p1363",
  });
  return `vapid t=${header}.${payload}.${bufToB64u(signature)}, k=${keys.publicKey}`;
}
