import { Buffer } from "buffer";
import { HDKey } from "@scure/bip32";
import * as bip39 from "@scure/bip39";
import * as bitcoin from "bitcoinjs-lib";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createBitcoinMobileWallet } from "../bitcoin";

const bitcoinMessageMocks = vi.hoisted(() => ({
  signMessage: vi.fn(),
}));

vi.mock("../../bitcoin", () => ({
  signMessage: bitcoinMessageMocks.signMessage,
}));

const MNEMONIC =
  "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
const ACCOUNT_XPUB =
  "xpub6C6nQwHaWbSrzs5tZ1q7m5R9cPK9eYpNMFesiXsYrgc1P8bvLLAet9JfHjYXKjToD8cBRswJXXbbFpXgwsswVPAZzKMa1jUp2kVkGVUaJa7";
const MESSAGE_PRIVATE_KEY = "464c5dd427dcf1e2791b97a1aa9348647d3a55e1223b4e58cb663b49fd12e0ca";

const createPsbtFixture = async () => {
  const seed = await bip39.mnemonicToSeed(MNEMONIC);
  const signingKey = HDKey.fromMasterSeed(seed).derive("m/49'/0'/0'/0/0");

  if (!signingKey.publicKey) {
    throw new Error("Expected signing public key");
  }

  const pubkey = Buffer.from(signingKey.publicKey);
  const payment = bitcoin.payments.p2wpkh({
    network: bitcoin.networks.bitcoin,
    pubkey,
  });

  if (!payment.output) {
    throw new Error("Expected payment output");
  }

  const psbt = new bitcoin.Psbt({ network: bitcoin.networks.bitcoin });
  psbt.addInput({
    hash: "00".repeat(32),
    index: 0,
    witnessUtxo: {
      script: payment.output,
      value: 100000n,
    },
  });
  psbt.addOutput({
    script: payment.output,
    value: 90000n,
  });

  return {
    psbtHex: psbt.toHex(),
    signingPublicKey: pubkey,
  };
};

describe("createBitcoinMobileWallet", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("derives the default Bitcoin account xpub from a mnemonic", async () => {
    const wallet = await createBitcoinMobileWallet(MNEMONIC);

    await expect(wallet.getExtendedPublicKey({ derivationPath: "m/49'/0'/0'" })).resolves.toBe(
      ACCOUNT_XPUB,
    );
    expect(wallet.getChild().publicExtendedKey).toBe(ACCOUNT_XPUB);
    expect(wallet.master.privateKey).toBeDefined();
  });

  it("signs Bitcoin messages with the selected child private key", async () => {
    const wallet = await createBitcoinMobileWallet(MNEMONIC);
    bitcoinMessageMocks.signMessage.mockResolvedValue(Buffer.from("signed-message"));

    await expect(
      wallet.signMessage({
        derivationPath: "m/49'/0'/0'/0/1",
        message: "hello bitcoin",
      }),
    ).resolves.toBe("c2lnbmVkLW1lc3NhZ2U=");
    expect(bitcoinMessageMocks.signMessage).toHaveBeenCalledWith(
      "hello bitcoin",
      expect.any(Uint8Array),
      true,
    );
    expect(Buffer.from(bitcoinMessageMocks.signMessage.mock.calls[0]?.[1]).toString("hex")).toBe(
      MESSAGE_PRIVATE_KEY,
    );
  });

  it("signs PSBT inputs using relative derivation paths", async () => {
    const wallet = await createBitcoinMobileWallet(MNEMONIC);
    const fixture = await createPsbtFixture();

    const signedPsbtHex = await wallet.signPsbt({
      inputDerivationPaths: "0/0",
      psbtHex: fixture.psbtHex,
    });

    const signedPsbt = bitcoin.Psbt.fromHex(signedPsbtHex, {
      network: bitcoin.networks.bitcoin,
    });
    const partialSignature = signedPsbt.data.inputs[0]?.partialSig?.[0];

    expect(Buffer.from(partialSignature?.pubkey ?? []).toString("hex")).toBe(
      fixture.signingPublicKey.toString("hex"),
    );
    expect(partialSignature?.signature.length).toBeGreaterThan(0);
  });

  it("reports the missing PSBT input derivation path", async () => {
    const wallet = await createBitcoinMobileWallet(MNEMONIC);
    const fixture = await createPsbtFixture();

    await expect(
      wallet.signPsbt({
        inputDerivationPaths: [],
        psbtHex: fixture.psbtHex,
      }),
    ).rejects.toThrow("Missing derivation path for input 0");
  });
});
