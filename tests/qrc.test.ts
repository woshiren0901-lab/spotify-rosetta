import { describe, expect, it } from "vitest";
import { zlibSync } from "fflate";
import {
  decryptQrc,
  qrcTripleCrypt,
} from "../src/providers/qrc";

const key = new TextEncoder().encode("!@#)(*$%123ZXC!@!@#)(NHL");

function encryptQrcPayload(text: string): string {
  const compressed = zlibSync(new TextEncoder().encode(text));
  const padding = (8 - (compressed.length % 8)) % 8;
  const padded = new Uint8Array(compressed.length + padding);
  padded.set(compressed);
  const encrypted = new Uint8Array(padded.length);
  for (let offset = 0; offset < padded.length; offset += 8) {
    encrypted.set(
      qrcTripleCrypt(padded.slice(offset, offset + 8), key, true),
      offset,
    );
  }
  return [...encrypted]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
}

describe("QQ QRC decryption", () => {
  it("round-trips modified 3DES blocks", () => {
    const plain = new TextEncoder().encode("12345678");
    const encrypted = qrcTripleCrypt(plain, key, true);
    const decrypted = qrcTripleCrypt(encrypted, key, false);
    expect(new TextDecoder().decode(decrypted)).toBe("12345678");
  });

  it("decrypts zlib-compressed QRC XML", async () => {
    const xml =
      '<?xml version="1.0"?><QrcInfos><LyricInfo><Lyric_1 ' +
      'LyricContent="[1000,2000]Hello(1000,500) world(1500,500)"/></LyricInfo></QrcInfos>';
    const decrypted = await decryptQrc(encryptQrcPayload(xml));
    expect(decrypted).toBe(
      "[1000,2000]Hello(1000,500) world(1500,500)",
    );
  });
});

