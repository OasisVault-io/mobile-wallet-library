import { Buffer } from "buffer";
import { HDKey } from "@scure/bip32";
import * as bitcoin from "bitcoinjs-lib";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createLedgerBitcoinClient } from "../bitcoin";

const signerMocks = vi.hoisted(() => ({
  SignerBtcBuilder: vi.fn(),
  WalletPolicy: vi.fn(),
  build: vi.fn(),
  signer: {
    getExtendedPublicKey: vi.fn(),
    getMasterFingerprint: vi.fn(),
    registerWallet: vi.fn(),
    signMessage: vi.fn(),
    signPsbt: vi.fn(),
  },
}));

vi.mock("@ledgerhq/device-signer-kit-bitcoin", () => ({
  SignerBtcBuilder: signerMocks.SignerBtcBuilder,
  WalletPolicy: signerMocks.WalletPolicy,
}));

vi.mock("../../crypto", () => ({
  byteArrayToHexString: (byteArray: Uint8Array) =>
    Array.from(byteArray, (byte) => ("0" + (byte & 0xff).toString(16)).slice(-2)).join(""),
}));

const createClient = () => {
  const getDmk = vi.fn(() => ({ id: "dmk" }));
  const getSessionId = vi.fn(() => "session-id");
  const normalizeDerivationPath = vi.fn((derivationPath: string) =>
    derivationPath.replace(/^m\//, "").replace(/^\//, ""),
  );
  const waitForLedgerAction = vi.fn(async (action: any) => action.output);

  return {
    client: createLedgerBitcoinClient({
      getDmk: getDmk as any,
      getSessionId: getSessionId as any,
      normalizeDerivationPath,
      waitForLedgerAction,
    }),
    getDmk,
    getSessionId,
    normalizeDerivationPath,
    waitForLedgerAction,
  };
};

const createPsbtFixture = () => {
  const seed = Uint8Array.from(Array.from({ length: 32 }, (_, index) => index + 1));
  const accountNode = HDKey.fromMasterSeed(seed).derive("m/49'/0'/0'");
  const childNode = accountNode.derive("m/0/0");

  if (!childNode.publicKey) {
    throw new Error("Expected child public key");
  }

  const pubkey = Buffer.from(childNode.publicKey);
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
    childPublicKey: pubkey,
    partialSignature: Buffer.from(`30440220${"11".repeat(32)}0220${"22".repeat(32)}01`, "hex"),
    psbtHex: psbt.toHex(),
    xpub: accountNode.publicExtendedKey,
  };
};

describe("createLedgerBitcoinClient", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    signerMocks.build.mockReturnValue(signerMocks.signer);
    signerMocks.SignerBtcBuilder.mockImplementation(function SignerBtcBuilder() {
      return {
        build: signerMocks.build,
      };
    });
    signerMocks.WalletPolicy.mockImplementation(function WalletPolicy(
      label: string,
      policy: string,
      signerInfo: string[],
    ) {
      return {
        label,
        policy,
        signerInfo,
      };
    });
  });

  it("reads the default Bitcoin account xpub through the connected Ledger session", async () => {
    const { client, getDmk, getSessionId, normalizeDerivationPath, waitForLedgerAction } =
      createClient();
    const options = { onStateChange: vi.fn() };
    const action = { output: { extendedPublicKey: "xpub-ledger" } };

    signerMocks.signer.getExtendedPublicKey.mockReturnValue(action);

    await expect(client.getExtendedPublicKey(options)).resolves.toBe("xpub-ledger");
    expect(getDmk).toHaveBeenCalledOnce();
    expect(getSessionId).toHaveBeenCalledOnce();
    expect(signerMocks.SignerBtcBuilder).toHaveBeenCalledWith({
      dmk: { id: "dmk" },
      sessionId: "session-id",
    });
    expect(normalizeDerivationPath).toHaveBeenCalledWith("m/49'/0'/0'");
    expect(signerMocks.signer.getExtendedPublicKey).toHaveBeenCalledWith("49'/0'/0'");
    expect(waitForLedgerAction).toHaveBeenCalledWith(action, options);
  });

  it("reads the master fingerprint as lowercase hex", async () => {
    const { client } = createClient();
    const action = {
      output: {
        masterFingerprint: Uint8Array.from([0xde, 0xad, 0xbe, 0xef]),
      },
    };

    signerMocks.signer.getMasterFingerprint.mockReturnValue(action);

    await expect(client.getMasterFingerprint()).resolves.toBe("deadbeef");
  });

  it("signs messages and converts Ledger recovery headers to compact format", async () => {
    const { client, waitForLedgerAction } = createClient();
    const options = { onStateChange: vi.fn() };
    const signature = {
      r: `0x${"11".repeat(32)}`,
      s: `0x${"22".repeat(32)}`,
      v: 27,
    };
    const action = { output: signature };
    const expectedSignature = Buffer.concat([
      Buffer.from([31]),
      Buffer.from("11".repeat(32), "hex"),
      Buffer.from("22".repeat(32), "hex"),
    ]).toString("base64");

    signerMocks.signer.signMessage.mockReturnValue(action);

    await expect(client.signMessage("hello", "m/49'/0'/0'/0/1", options)).resolves.toBe(
      expectedSignature,
    );
    expect(signerMocks.signer.signMessage).toHaveBeenCalledWith("49'/0'/0'/0/1", "hello");
    expect(waitForLedgerAction).toHaveBeenCalledWith(action, options);
  });

  it("rejects Bitcoin transaction signing without input derivation paths", async () => {
    const { client } = createClient();

    await expect(
      client.signTransaction({
        transaction: {
          psbtHex: "00",
          derivationPaths: "",
        },
        signer: {
          id: "signer-id",
          signerId: "ledger-signer-id",
          policyHmac: null,
          masterFingerprint: "deadbeef",
          extendedPublicKey: "xpub",
          baseDerivationPath: "m/49'/0'/0'",
        },
        wallet: {
          label: "Vault",
          policy: "wsh(sortedmulti(2,@0/**,@1/**))",
          signers: [],
        },
      }),
    ).rejects.toThrow("Bitcoin derivation paths are required");
    expect(signerMocks.signer.registerWallet).not.toHaveBeenCalled();
    expect(signerMocks.signer.signPsbt).not.toHaveBeenCalled();
  });

  it("registers the wallet policy and appends Ledger PSBT signatures", async () => {
    const { client, waitForLedgerAction } = createClient();
    const fixture = createPsbtFixture();
    const options = { onStateChange: vi.fn() };
    const registeredWallet = { id: "registered-wallet" };
    const registerAction = { output: registeredWallet };
    const signAction = {
      output: [
        {
          inputIndex: 0,
          pubkey: fixture.childPublicKey,
          signature: fixture.partialSignature,
        },
      ],
    };

    signerMocks.signer.registerWallet.mockReturnValue(registerAction);
    signerMocks.signer.signPsbt.mockReturnValue(signAction);

    const signedPsbtHex = await client.signTransaction(
      {
        transaction: {
          derivationPaths: "0/0",
          psbtHex: fixture.psbtHex,
        },
        signer: {
          id: "signer-id",
          signerId: "ledger-signer-id",
          policyHmac: null,
          masterFingerprint: "deadbeef",
          extendedPublicKey: fixture.xpub,
          baseDerivationPath: "m/49'/0'/0'",
        },
        wallet: {
          label: "Vault #1 🚀",
          policy: "wsh(sortedmulti(2,@0/**,@1/**))",
          signers: [
            {
              baseDerivationPath: "m/49'/0'/0'",
              masterFingerprint: "deadbeef",
              extendedPublicKey: fixture.xpub,
            },
          ],
        },
      },
      options,
    );

    expect(signerMocks.WalletPolicy).toHaveBeenCalledWith(
      "Vault 1",
      "wsh(sortedmulti(2,@0/**,@1/**))",
      [`[deadbeef/49'/0'/0']${fixture.xpub}`],
    );
    expect(signerMocks.signer.registerWallet).toHaveBeenCalledWith(
      signerMocks.WalletPolicy.mock.results[0]?.value,
    );
    expect(signerMocks.signer.signPsbt).toHaveBeenCalledWith(registeredWallet, expect.any(String));
    expect(waitForLedgerAction).toHaveBeenCalledWith(registerAction, options);
    expect(waitForLedgerAction).toHaveBeenCalledWith(signAction, options);

    const devicePsbt = bitcoin.Psbt.fromBase64(signerMocks.signer.signPsbt.mock.calls[0]?.[1], {
      network: bitcoin.networks.bitcoin,
    });
    const derivation = devicePsbt.data.inputs[0]?.bip32Derivation?.[0];
    expect(Buffer.from(derivation?.masterFingerprint ?? []).toString("hex")).toBe("deadbeef");
    expect(Buffer.from(derivation?.pubkey ?? []).toString("hex")).toBe(
      fixture.childPublicKey.toString("hex"),
    );
    expect(derivation?.path).toBe("m/49'/0'/0'/0/0");

    const signedPsbt = bitcoin.Psbt.fromHex(signedPsbtHex, {
      network: bitcoin.networks.bitcoin,
    });
    const partialSignature = signedPsbt.data.inputs[0]?.partialSig?.[0];
    expect(Buffer.from(partialSignature?.pubkey ?? []).toString("hex")).toBe(
      fixture.childPublicKey.toString("hex"),
    );
    expect(Buffer.from(partialSignature?.signature ?? []).toString("hex")).toBe(
      fixture.partialSignature.toString("hex"),
    );
  });
});
