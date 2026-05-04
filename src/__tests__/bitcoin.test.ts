import { createHash } from "node:crypto";
import { Buffer } from "buffer";
import * as secp256k1 from "secp256k1";
import * as varuint from "varuint-bitcoin";
import { describe, expect, it, vi } from "vitest";
import { magicHash, signMessage } from "../bitcoin";

vi.mock("react-native-quick-crypto", () => ({
  createHash,
}));

const PRIVATE_KEY = Buffer.from("11".repeat(32), "hex");
const secp256k1Runtime = secp256k1 as typeof secp256k1 & {
  ecdsaVerify: (signature: Uint8Array, message: Uint8Array, publicKey: Uint8Array) => boolean;
  publicKeyCreate: (privateKey: Uint8Array) => Uint8Array;
};

const buildExpectedMagicHash = (
  message: string | Buffer,
  prefix = "\u0018Bitcoin Signed Message:\n",
) => {
  const messageBuffer = Buffer.isBuffer(message) ? message : Buffer.from(message, "utf8");
  const prefixBuffer = Buffer.from(prefix, "utf8");
  const messageVISize = varuint.encodingLength(messageBuffer.length);
  const payload = Buffer.allocUnsafe(prefixBuffer.length + messageVISize + messageBuffer.length);

  prefixBuffer.copy(payload, 0);
  varuint.encode(messageBuffer.length, payload, prefixBuffer.length);
  messageBuffer.copy(payload, prefixBuffer.length + messageVISize);

  return createHash("sha256").update(createHash("sha256").update(payload).digest()).digest();
};

describe("bitcoin message helpers", () => {
  it("computes the Bitcoin signed-message magic hash", async () => {
    const message = "hello bitcoin";

    await expect(magicHash(message, undefined)).resolves.toEqual(buildExpectedMagicHash(message));
  });

  it("supports a custom message prefix when hashing", async () => {
    const message = Buffer.from("hello custom prefix");
    const prefix = "Oasis Signed Message:\n";

    await expect(magicHash(message, prefix)).resolves.toEqual(
      buildExpectedMagicHash(message, prefix),
    );
  });

  it("signs a message with a private key and returns a compact recoverable signature", async () => {
    const message = "hello compact signature";
    const hash = await magicHash(message, undefined);
    const publicKey = secp256k1Runtime.publicKeyCreate(PRIVATE_KEY);

    const signature = await signMessage(message, PRIVATE_KEY, true);
    const recovery = signature[0]! - 27 - 4;

    expect(signature).toHaveLength(65);
    expect(recovery).toBeGreaterThanOrEqual(0);
    expect(recovery).toBeLessThanOrEqual(3);
    expect(secp256k1Runtime.ecdsaVerify(signature.subarray(1), hash, publicKey)).toBe(true);
  });

  it("delegates signing to signer objects and forwards extra entropy", async () => {
    const extraEntropy = Buffer.from("22".repeat(32), "hex");
    const rawSignature = Buffer.from("33".repeat(64), "hex");
    const signer = {
      sign: vi.fn(() => ({
        recovery: 1,
        signature: rawSignature,
      })),
    };

    const signature = await signMessage("hello signer", signer, false, undefined, {
      extraEntropy,
      segwitType: "p2sh(p2wpkh)",
    });

    expect(signature[0]).toBe(36);
    expect(signature.subarray(1)).toEqual(rawSignature);
    expect(signer.sign).toHaveBeenCalledWith(
      await magicHash("hello signer", undefined),
      extraEntropy,
    );
  });

  it("uses the p2wpkh compact header for segwit message signatures", async () => {
    const rawSignature = Buffer.from("44".repeat(64), "hex");
    const signer = {
      sign: vi.fn(() => ({
        recovery: 0,
        signature: rawSignature,
      })),
    };

    const signature = await signMessage("hello segwit", signer, false, undefined, {
      segwitType: "p2wpkh",
    });

    expect(signature[0]).toBe(39);
    expect(signature.subarray(1)).toEqual(rawSignature);
  });

  it("rejects unsupported segwit message signature types", async () => {
    await expect(
      signMessage("hello invalid", PRIVATE_KEY, true, undefined, {
        segwitType: "string",
      }),
    ).rejects.toThrow('Unrecognized segwitType: use "p2sh(p2wpkh)" or "p2wpkh"');
  });
});
