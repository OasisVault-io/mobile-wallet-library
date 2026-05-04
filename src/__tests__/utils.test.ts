import { beforeEach, describe, expect, it, vi } from "vitest";
import { generateMnemonic, generateNonce, validateMnemonic } from "../utils";

const cryptoMocks = vi.hoisted(() => ({
  byteArrayToBase64String: vi.fn((byteArray: Uint8Array) =>
    Buffer.from(byteArray).toString("base64"),
  ),
  generateRandomUint8Array: vi.fn((length = 32) => new Uint8Array(length).fill(7)),
}));

vi.mock("../crypto", () => ({
  byteArrayToBase64String: cryptoMocks.byteArrayToBase64String,
  generateRandomUint8Array: cryptoMocks.generateRandomUint8Array,
}));

describe("utils", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("generates a valid 24-word BIP-39 mnemonic", () => {
    const mnemonic = generateMnemonic();

    expect(mnemonic.split(" ")).toHaveLength(24);
    expect(validateMnemonic(mnemonic)).toBe(true);
  });

  it("validates invalid mnemonics", () => {
    expect(validateMnemonic("not a valid mnemonic")).toBe(false);
  });

  it("generates a base64 nonce from random bytes", () => {
    expect(generateNonce(4)).toBe("BwcHBw==");
    expect(cryptoMocks.generateRandomUint8Array).toHaveBeenCalledWith(4);
    expect(cryptoMocks.byteArrayToBase64String).toHaveBeenCalledWith(Uint8Array.from([7, 7, 7, 7]));
  });

  it("uses a 32-byte nonce by default", () => {
    generateNonce();

    expect(cryptoMocks.generateRandomUint8Array).toHaveBeenCalledWith(32);
  });
});
