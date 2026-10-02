const DEFAULT_PASSWORD_ITERATIONS = 210_000;
const MIN_PASSWORD_ITERATIONS = 100_000;
const MAX_PASSWORD_ITERATIONS = 1_000_000;
const PASSWORD_BYTES = 32;

export const SESSION_COOKIE = "script_hub_session";
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

export async function hashPassword(
  password: string,
  iterations = DEFAULT_PASSWORD_ITERATIONS,
): Promise<string> {
  if (!Number.isInteger(iterations) || iterations < MIN_PASSWORD_ITERATIONS || iterations > MAX_PASSWORD_ITERATIONS) {
    throw new Error("invalid password iterations");
  }
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await derivePassword(password, salt, iterations);
  return `pbkdf2_sha256$${iterations}$${toHex(salt)}$${toHex(hash)}`;
}

export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const [algorithm, rawIterations, rawSalt, rawHash] = encoded.split("$");
  if (algorithm !== "pbkdf2_sha256" || !rawIterations || !rawSalt || !rawHash) return false;
  const iterations = Number(rawIterations);
  if (!Number.isInteger(iterations) || iterations < MIN_PASSWORD_ITERATIONS || iterations > MAX_PASSWORD_ITERATIONS) return false;
  try {
    const expected = fromHex(rawHash);
    const actual = await derivePassword(password, fromHex(rawSalt), iterations, expected.byteLength);
    return constantTimeEqual(actual, expected);
  } catch {
    return false;
  }
}

export function createSessionToken(): string {
  return toHex(crypto.getRandomValues(new Uint8Array(32)));
}

export async function hashSessionToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return toHex(new Uint8Array(digest));
}

async function derivePassword(
  password: string,
  salt: Uint8Array<ArrayBuffer>,
  iterations: number,
  length = PASSWORD_BYTES,
): Promise<Uint8Array<ArrayBuffer>> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations },
    key,
    length * 8,
  );
  return new Uint8Array(bits);
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function fromHex(value: string): Uint8Array<ArrayBuffer> {
  if (!/^[0-9a-f]+$/i.test(value) || value.length % 2 !== 0) throw new Error("invalid hex");
  const bytes = new Uint8Array(value.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

function constantTimeEqual(left: Uint8Array, right: Uint8Array): boolean {
  let difference = left.length ^ right.length;
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }
  return difference === 0;
}
