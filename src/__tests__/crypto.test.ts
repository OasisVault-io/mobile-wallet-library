import { Buffer } from "buffer";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { byteArrayToBase64String, byteArrayToHexString, generateRandomUint8Array } from "../crypto";

const nativeCryptoMocks = vi.hoisted(() => ({
  fromByteArray: vi.fn((byteArray: Uint8Array) => Buffer.from(byteArray).toString("base64")),
  randomFillSync: vi.fn((array: Uint8Array) => {
    array.set(Array.from({ length: array.length }, (_, index) => index + 1));
    return array;
  }),
}));

vi.mock("react-native-quick-crypto", () => ({
  randomFillSync: nativeCryptoMocks.randomFillSync,
}));

vi.mock("react-native-quick-base64", () => ({
  fromByteArray: nativeCryptoMocks.fromByteArray,
}));

describe("crypto helpers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("generates a random Uint8Array using the native random fill", () => {
    const result = generateRandomUint8Array(4);

    expect(result).toEqual(Uint8Array.from([1, 2, 3, 4]));
    expect(nativeCryptoMocks.randomFillSync).toHaveBeenCalledWith(result);
  });

  it("defaults generated random bytes to 32 bytes", () => {
    expect(generateRandomUint8Array()).toHaveLength(32);
  });

  it("converts bytes to lowercase hex with zero padding", () => {
    expect(byteArrayToHexString(Uint8Array.from([0, 1, 15, 16, 255]))).toBe("00010f10ff");
  });

  it("converts bytes to base64 with the native base64 helper", () => {
    const bytes = Uint8Array.from([104, 101, 108, 108, 111]);

    expect(byteArrayToBase64String(bytes)).toBe("aGVsbG8=");
    expect(nativeCryptoMocks.fromByteArray).toHaveBeenCalledWith(bytes);
  });
});
