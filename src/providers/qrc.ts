import { decodeEntities } from "../core/lrc";
import { inflateSync, unzlibSync } from "fflate";

const QQ_KEY = new TextEncoder().encode("!@#)(*$%123ZXC!@!@#)(NHL");

const SBOXES: readonly (readonly number[])[] = [
  [14, 4, 13, 1, 2, 15, 11, 8, 3, 10, 6, 12, 5, 9, 0, 7, 0, 15, 7, 4, 14, 2, 13, 1, 10, 6, 12, 11, 9, 5, 3, 8, 4, 1, 14, 8, 13, 6, 2, 11, 15, 12, 9, 7, 3, 10, 5, 0, 15, 12, 8, 2, 4, 9, 1, 7, 5, 11, 3, 14, 10, 0, 6, 13],
  [15, 1, 8, 14, 6, 11, 3, 4, 9, 7, 2, 13, 12, 0, 5, 10, 3, 13, 4, 7, 15, 2, 8, 15, 12, 0, 1, 10, 6, 9, 11, 5, 0, 14, 7, 11, 10, 4, 13, 1, 5, 8, 12, 6, 9, 3, 2, 15, 13, 8, 10, 1, 3, 15, 4, 2, 11, 6, 7, 12, 0, 5, 14, 9],
  [10, 0, 9, 14, 6, 3, 15, 5, 1, 13, 12, 7, 11, 4, 2, 8, 13, 7, 0, 9, 3, 4, 6, 10, 2, 8, 5, 14, 12, 11, 15, 1, 13, 6, 4, 9, 8, 15, 3, 0, 11, 1, 2, 12, 5, 10, 14, 7, 1, 10, 13, 0, 6, 9, 8, 7, 4, 15, 14, 3, 11, 5, 2, 12],
  [7, 13, 14, 3, 0, 6, 9, 10, 1, 2, 8, 5, 11, 12, 4, 15, 13, 8, 11, 5, 6, 15, 0, 3, 4, 7, 2, 12, 1, 10, 14, 9, 10, 6, 9, 0, 12, 11, 7, 13, 15, 1, 3, 14, 5, 2, 8, 4, 3, 15, 0, 6, 10, 10, 13, 8, 9, 4, 5, 11, 12, 7, 2, 14],
  [2, 12, 4, 1, 7, 10, 11, 6, 8, 5, 3, 15, 13, 0, 14, 9, 14, 11, 2, 12, 4, 7, 13, 1, 5, 0, 15, 10, 3, 9, 8, 6, 4, 2, 1, 11, 10, 13, 7, 8, 15, 9, 12, 5, 6, 3, 0, 14, 11, 8, 12, 7, 1, 14, 2, 13, 6, 15, 0, 9, 10, 4, 5, 3],
  [12, 1, 10, 15, 9, 2, 6, 8, 0, 13, 3, 4, 14, 7, 5, 11, 10, 15, 4, 2, 7, 12, 9, 5, 6, 1, 13, 14, 0, 11, 3, 8, 9, 14, 15, 5, 2, 8, 12, 3, 7, 0, 4, 10, 1, 13, 11, 6, 4, 3, 2, 12, 9, 5, 15, 10, 11, 14, 1, 7, 6, 0, 8, 13],
  [4, 11, 2, 14, 15, 0, 8, 13, 3, 12, 9, 7, 5, 10, 6, 1, 13, 0, 11, 7, 4, 9, 1, 10, 14, 3, 5, 12, 2, 15, 8, 6, 1, 4, 11, 13, 12, 3, 7, 14, 10, 15, 6, 8, 0, 5, 9, 2, 6, 11, 13, 8, 1, 4, 10, 7, 9, 5, 0, 15, 14, 2, 3, 12],
  [13, 2, 8, 4, 6, 15, 11, 1, 10, 9, 3, 14, 5, 0, 12, 7, 1, 15, 13, 8, 10, 3, 7, 4, 12, 5, 6, 11, 0, 14, 9, 2, 7, 11, 4, 1, 9, 12, 14, 2, 0, 6, 10, 13, 15, 3, 5, 8, 2, 1, 14, 7, 4, 10, 8, 13, 15, 12, 9, 0, 3, 5, 6, 11],
];

const KEY_SHIFTS = [1, 1, 2, 2, 2, 2, 2, 2, 1, 2, 2, 2, 2, 2, 2, 1];
const KEY_PERMUTATION_C = [56, 48, 40, 32, 24, 16, 8, 0, 57, 49, 41, 33, 25, 17, 9, 1, 58, 50, 42, 34, 26, 18, 10, 2, 59, 51, 43, 35];
const KEY_PERMUTATION_D = [62, 54, 46, 38, 30, 22, 14, 6, 61, 53, 45, 37, 29, 21, 13, 5, 60, 52, 44, 36, 28, 20, 12, 4, 27, 19, 11, 3];
const KEY_COMPRESSION = [13, 16, 10, 23, 0, 4, 2, 27, 14, 5, 20, 9, 22, 18, 11, 3, 25, 7, 15, 6, 26, 19, 12, 1, 40, 51, 30, 36, 46, 54, 29, 39, 50, 44, 32, 47, 43, 48, 38, 55, 33, 52, 45, 41, 49, 35, 28, 31];
const PERMUTATION = [15, 6, 19, 20, 28, 11, 27, 16, 0, 14, 22, 25, 4, 17, 30, 9, 1, 7, 23, 13, 31, 26, 2, 8, 18, 12, 29, 5, 21, 10, 3, 24];

type Schedule = number[][];
type TripleSchedule = [Schedule, Schedule, Schedule];

function u32(value: number): number {
  return value >>> 0;
}

function sourceBit(bytes: Uint8Array, bit: number): number {
  const index = Math.floor(bit / 32) * 4 + 3 - Math.floor((bit % 32) / 8);
  return ((bytes[index] ?? 0) >> (7 - (bit % 8))) & 1;
}

function keySchedule(key: Uint8Array, encrypt: boolean): Schedule {
  let c = 0;
  let d = 0;
  for (let index = 0; index < 28; index += 1) {
    c = u32(c | (sourceBit(key, KEY_PERMUTATION_C[index] ?? 0) << (31 - index)));
    d = u32(d | (sourceBit(key, KEY_PERMUTATION_D[index] ?? 0) << (31 - index)));
  }
  const schedule = Array.from({ length: 16 }, () => Array(6).fill(0));
  for (let round = 0; round < 16; round += 1) {
    const shift = KEY_SHIFTS[round] ?? 1;
    c = u32(((c << shift) | (c >>> (28 - shift))) & 0xfffffff0);
    d = u32(((d << shift) | (d >>> (28 - shift))) & 0xfffffff0);
    const row = encrypt ? round : 15 - round;
    const rowSchedule = schedule[row] ?? Array(6).fill(0);
    schedule[row] = rowSchedule;
    for (let index = 0; index < 48; index += 1) {
      const value = index < 24 ? c : d;
      const source = (KEY_COMPRESSION[index] ?? 0) - (index < 24 ? 0 : 27);
      const byteIndex = Math.floor(index / 8);
      rowSchedule[byteIndex] =
        (rowSchedule[byteIndex] ?? 0) |
        ((((value >>> (31 - source)) & 1) << (7 - (index % 8))) & 0xff);
    }
  }
  return schedule;
}

function tripleSchedule(key: Uint8Array, encrypt: boolean): TripleSchedule {
  const first = key.slice(0, 8);
  const second = key.slice(8, 16);
  const third = key.slice(16, 24);
  return encrypt
    ? [
        keySchedule(first, true),
        keySchedule(second, false),
        keySchedule(third, true),
      ]
    : [
        keySchedule(third, false),
        keySchedule(second, true),
        keySchedule(first, false),
      ];
}

const SP_TABLES = SBOXES.map((box, boxIndex) =>
  box.map((value) => {
    const packed = u32(value << (28 - boxIndex * 4));
    let result = 0;
    for (let index = 0; index < 32; index += 1) {
      result = u32(
        result |
          ((packed >>> (31 - (PERMUTATION[index] ?? 0))) & 1) <<
            (31 - index),
      );
    }
    return result;
  }),
);

function wrappedShift(value: number, shift: number, offset: number): number {
  return u32(((value << shift) & 0x80000000) >>> offset);
}

function round(state: number, key: number[]): number {
  state = u32(state);
  const t1 = u32(
    wrappedShift(state, 31, 0) |
      ((state & 0xf0000000) >>> 1) |
      wrappedShift(state, 4, 5) |
      wrappedShift(state, 3, 6) |
      ((state & 0x0f000000) >>> 3) |
      wrappedShift(state, 8, 11) |
      wrappedShift(state, 7, 12) |
      ((state & 0x00f00000) >>> 5) |
      wrappedShift(state, 12, 17) |
      wrappedShift(state, 11, 18) |
      ((state & 0x000f0000) >>> 7) |
      wrappedShift(state, 16, 23),
  );
  const t2 = u32(
    wrappedShift(state, 15, 0) |
      ((state & 0x0000f000) << 15) |
      wrappedShift(state, 20, 5) |
      wrappedShift(state, 19, 6) |
      ((state & 0x00000f00) << 13) |
      wrappedShift(state, 24, 11) |
      wrappedShift(state, 23, 12) |
      ((state & 0x000000f0) << 11) |
      wrappedShift(state, 28, 17) |
      wrappedShift(state, 27, 18) |
      ((state & 0x0000000f) << 9) |
      wrappedShift(state, 0, 23),
  );
  const a = ((t1 >>> 24) & 0xff) ^ (key[0] ?? 0);
  const b = ((t1 >>> 16) & 0xff) ^ (key[1] ?? 0);
  const c = ((t1 >>> 8) & 0xff) ^ (key[2] ?? 0);
  const d = ((t2 >>> 24) & 0xff) ^ (key[3] ?? 0);
  const e = ((t2 >>> 16) & 0xff) ^ (key[4] ?? 0);
  const f = ((t2 >>> 8) & 0xff) ^ (key[5] ?? 0);
  const sbox = (value: number): number =>
    (value & 0x20) | ((value & 0x1f) >>> 1) | ((value & 1) << 4);
  return u32(
    (SP_TABLES[0]?.[sbox(a >>> 2)] ?? 0) |
      (SP_TABLES[1]?.[sbox(((a & 3) << 4) | (b >>> 4))] ?? 0) |
      (SP_TABLES[2]?.[sbox(((b & 15) << 2) | (c >>> 6))] ?? 0) |
      (SP_TABLES[3]?.[sbox(c & 63)] ?? 0) |
      (SP_TABLES[4]?.[sbox(d >>> 2)] ?? 0) |
      (SP_TABLES[5]?.[sbox(((d & 3) << 4) | (e >>> 4))] ?? 0) |
      (SP_TABLES[6]?.[sbox(((e & 15) << 2) | (f >>> 6))] ?? 0) |
      (SP_TABLES[7]?.[sbox(f & 63)] ?? 0),
  );
}

function cryptBlock(input: Uint8Array, schedule: Schedule): Uint8Array {
  const state = [0, 0];
  for (let row = 0; row < 2; row += 1) {
    for (let index = 0; index < 32; index += 1) {
      const source =
        (row === 0 ? 57 : 56) -
        (index % 8) * 8 +
        Math.floor(index / 8) * 2;
      state[row] = u32(
        (state[row] ?? 0) |
          (sourceBit(input, source) << (31 - index)),
      );
    }
  }
  for (let index = 0; index < 15; index += 1) {
    const previousRight = state[1] ?? 0;
    state[1] = u32(round(previousRight, schedule[index] ?? []) ^ (state[0] ?? 0));
    state[0] = previousRight;
  }
  state[0] = u32(round(state[1] ?? 0, schedule[15] ?? []) ^ (state[0] ?? 0));

  const output = new Uint8Array(8);
  for (let byte = 0; byte < 8; byte += 1) {
    const bit = (byte + 4) % 8;
    let value = 0;
    for (let index = 0; index < 4; index += 1) {
      value |=
        (((state[1] ?? 0) >>> (31 - (bit + index * 8))) & 1) <<
        (7 - index * 2);
      value |=
        (((state[0] ?? 0) >>> (31 - (bit + index * 8))) & 1) <<
        (6 - index * 2);
    }
    output[byte] = value & 0xff;
  }
  return output;
}

function tripleCrypt(input: Uint8Array, schedules: TripleSchedule): Uint8Array {
  return cryptBlock(
    cryptBlock(cryptBlock(input, schedules[0]), schedules[1]),
    schedules[2],
  );
}

export function qrcTripleCrypt(
  input: Uint8Array,
  key: Uint8Array,
  encrypt: boolean,
): Uint8Array {
  if (input.length !== 8) throw new Error("QRC DES requires an 8-byte block.");
  if (key.length !== 24) throw new Error("QRC 3DES requires a 24-byte key.");
  return tripleCrypt(input, tripleSchedule(key, encrypt));
}

function decryptBlocks(input: Uint8Array): Uint8Array {
  if (input.length % 8 !== 0) {
    throw new Error("QRC ciphertext length is not a multiple of 8.");
  }
  const schedules = tripleSchedule(QQ_KEY, false);
  const output = new Uint8Array(input.length);
  for (let offset = 0; offset < input.length; offset += 8) {
    output.set(
      tripleCrypt(input.slice(offset, offset + 8), schedules),
      offset,
    );
  }
  return output;
}

function extractQrcContent(text: string): string {
  const match = text.match(/LyricContent\s*=\s*"([\s\S]*?)"/i);
  if (!match?.[1]) return text;
  return decodeEntities(match[1].replace(/\\"/g, '"'));
}

async function inflateDeflate(bytes: Uint8Array): Promise<Uint8Array> {
  try {
    return unzlibSync(bytes);
  } catch {
    // Some QRC variants use raw deflate without a zlib wrapper.
  }
  return inflateSync(bytes);
}

export async function decryptQrc(encryptedHex: string): Promise<string> {
  const hex = encryptedHex.trim();
  if (!hex || hex.length % 2 !== 0 || !/^[0-9a-f]+$/i.test(hex)) return "";
  const encrypted = new Uint8Array(hex.length / 2);
  for (let index = 0; index < encrypted.length; index += 1) {
    encrypted[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }
  const inflated = await inflateDeflate(decryptBlocks(encrypted));
  let text = new TextDecoder("utf-8", { fatal: false }).decode(inflated);
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  return extractQrcContent(text);
}

