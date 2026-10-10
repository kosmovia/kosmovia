import { createHmac, hkdfSync, randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from "node:crypto";

export * from "./pin-rules.ts";

/**
 * Hash del PIN de pagos. Server-only (node:crypto); las reglas puras están en
 * pin-rules.ts, que sí puede importar el navegador.
 *
 * Un PIN de 6 dígitos son solo un millón de posibilidades, así que el hash por
 * sí solo no basta si alguien se llevara la base de datos. Por eso hay dos capas:
 *
 * 1. Pepper: el PIN pasa primero por HMAC-SHA256 con una clave derivada de
 *    SESSION_SECRET (HKDF, info `kosmovia:pin:v1`). Esa clave NO está en la base,
 *    así que con solo un volcado no se puede probar el millón de PIN.
 * 2. scrypt (N=16384, r=8, p=1, 32 bytes) con una sal aleatoria de 16 bytes por
 *    persona, que vuelve cada intento caro.
 *
 * Formato guardado: `pin_salt` = la sal en base64url; `pin_hash` = `v1$` + el
 * hash en base64url. El prefijo permite cambiar de algoritmo sin romper los PIN
 * existentes. Si se rota SESSION_SECRET los PIN dejan de verificar: la persona
 * entra con una sesión nueva y usa "olvidé mi PIN".
 */

export const PIN_HASH_VERSION = "v1";
const HKDF_INFO = "kosmovia:pin:v1";
const SCRYPT_OPTIONS: ScryptOptions = { N: 16_384, r: 8, p: 1 };
const HASH_BYTES = 32;
const SALT_BYTES = 16;
const MIN_SECRET_BYTES = 32;

export interface StoredPin {
  /** `v1$<base64url>` */
  hash: string;
  /** base64url de 16 bytes */
  salt: string;
}

/** La clave del pepper: HKDF-SHA256 de SESSION_SECRET. Lanza si el secreto es corto. */
export function pepperKey(secret: Buffer): Buffer {
  if (secret.length < MIN_SECRET_BYTES) throw new Error("SESSION_SECRET too short");
  return Buffer.from(hkdfSync("sha256", secret, Buffer.alloc(0), HKDF_INFO, 32));
}

function scryptAsync(password: Buffer, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, HASH_BYTES, SCRYPT_OPTIONS, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

async function derive(pin: string, secret: Buffer, salt: Buffer): Promise<Buffer> {
  const peppered = createHmac("sha256", pepperKey(secret)).update(pin, "utf8").digest();
  return scryptAsync(peppered, salt);
}

/** Hash nuevo con sal aleatoria. `salt` solo se inyecta en tests. */
export async function hashPin(pin: string, secret: Buffer, salt: Buffer = randomBytes(SALT_BYTES)): Promise<StoredPin> {
  const key = await derive(pin, secret, salt);
  return { hash: `${PIN_HASH_VERSION}$${key.toString("base64url")}`, salt: salt.toString("base64url") };
}

/** ¿Este PIN es el guardado? Comparación en tiempo constante. Un formato desconocido es "no". */
export async function verifyPinHash(pin: string, secret: Buffer, stored: StoredPin): Promise<boolean> {
  const [version, encoded, ...rest] = stored.hash.split("$");
  if (version !== PIN_HASH_VERSION || !encoded || rest.length > 0) return false;
  const expected = Buffer.from(encoded, "base64url");
  const salt = Buffer.from(stored.salt, "base64url");
  if (expected.length !== HASH_BYTES || salt.length !== SALT_BYTES) return false;
  const given = await derive(pin, secret, salt);
  return timingSafeEqual(given, expected);
}
