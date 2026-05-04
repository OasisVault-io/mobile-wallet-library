import {
  type DeviceActionIntermediateValue,
  type DeviceManagementKit,
  type DeviceSessionId,
  type ExecuteDeviceActionReturnType,
} from "@ledgerhq/device-management-kit";
import {
  RegisteredWallet,
  SignerBtcBuilder,
  WalletPolicy,
} from "@ledgerhq/device-signer-kit-bitcoin";
import { HDKey } from "@scure/bip32";
import * as bitcoin from "bitcoinjs-lib";
import { Buffer } from "buffer";
import { BITCOIN_MAINNET_DERIVATION_PATH } from "../constants";
import { byteArrayToHexString } from "../crypto";
import type { LedgerActionOptions } from "./ledger";

/** Bitcoin signer metadata used to build Ledger wallet policies and PSBT derivations. */
export type BitcoinSigner = {
  /** App-level signer identifier. */
  id: string;
  /** Ledger signer identifier used by the app. */
  signerId: string;
  /** Optional Ledger wallet policy HMAC. */
  policyHmac: string | null;
  /** Master fingerprint as a hex string. */
  masterFingerprint: string;
  /** Account extended public key for this signer. */
  extendedPublicKey: string;
  /** Base account derivation path, for example `m/49'/0'/0'`. */
  baseDerivationPath: string;
};

/** Parameters required to sign a Bitcoin PSBT with a Ledger device. */
export type LedgerBitcoinTransactionParams = {
  /** PSBT and per-input relative derivation paths. */
  transaction: {
    /** Hex-encoded PSBT to sign. */
    psbtHex: string;
    /** Comma-separated relative derivation paths, one per input. */
    derivationPaths: string;
  };
  /** Signer metadata for the connected Ledger. */
  signer: BitcoinSigner;
  /** Wallet policy metadata used by the Ledger Bitcoin app. */
  wallet: {
    /** Human-readable wallet label shown by Ledger. */
    label: string;
    /** Ledger wallet policy template. */
    policy: string;
    /** All signers referenced by the wallet policy. */
    signers: {
      baseDerivationPath: string;
      masterFingerprint: string;
      extendedPublicKey: string;
    }[];
  };
};

type LedgerBitcoinSignature = {
  r: string;
  s: string;
  v: number;
};

type LedgerPsbtSignature = {
  inputIndex: number;
  pubkey?: Uint8Array;
  signature?: Uint8Array;
  tapleafHash?: Uint8Array;
};

type CreateDevicePsbtParams = {
  psbtHex: string;
  derivationPaths: string[];
  signer: BitcoinSigner;
};

type WaitForLedgerAction = <
  Output,
  Error = unknown,
  IntermediateValue extends DeviceActionIntermediateValue = DeviceActionIntermediateValue,
>(
  action: ExecuteDeviceActionReturnType<Output, Error, IntermediateValue>,
  options?: LedgerActionOptions,
) => Promise<Output>;

type LedgerBitcoinClientOptions = {
  getDmk: () => DeviceManagementKit;
  getSessionId: () => DeviceSessionId;
  normalizeDerivationPath: (derivationPath: string) => string;
  waitForLedgerAction: WaitForLedgerAction;
};

/** Creates the Ledger Bitcoin client used by the public Ledger service. */
export const createLedgerBitcoinClient = ({
  getDmk,
  getSessionId,
  normalizeDerivationPath,
  waitForLedgerAction,
}: LedgerBitcoinClientOptions) => {
  const createSigner = () =>
    new SignerBtcBuilder({
      dmk: getDmk(),
      sessionId: getSessionId(),
    }).build();

  const serializeMessageSignature = (signature: LedgerBitcoinSignature) => {
    const r = Buffer.from(signature.r.replace(/^0x/, ""), "hex");
    const s = Buffer.from(signature.s.replace(/^0x/, ""), "hex");
    // Ledger returns a legacy recovery header, while the software wallet uses
    // a compressed compact header for message signatures.
    const headerValue =
      signature.v < 27 ? signature.v + 31 : signature.v < 31 ? signature.v + 4 : signature.v;
    const header = Buffer.from([headerValue]);

    return Buffer.concat([header, r, s]).toString("base64");
  };

  const getMasterFingerprintHex = async (options: LedgerActionOptions = {}) => {
    const signer = createSigner();
    const { masterFingerprint } = await waitForLedgerAction<{
      masterFingerprint: Uint8Array;
    }>(signer.getMasterFingerprint(), options);

    return byteArrayToHexString(masterFingerprint);
  };

  const buildDevicePsbt = ({
    psbtHex,
    derivationPaths,
    signer,
  }: CreateDevicePsbtParams): bitcoin.Psbt => {
    const psbt = bitcoin.Psbt.fromHex(psbtHex, {
      network: bitcoin.networks.bitcoin,
    });

    if (derivationPaths.length !== psbt.inputCount) {
      throw new Error(
        `Ledger input derivation path count mismatch: expected ${psbt.inputCount}, received ${derivationPaths.length}`,
      );
    }

    derivationPaths.forEach((derivationPath, inputIndex) => {
      const node = HDKey.fromExtendedKey(signer.extendedPublicKey).derive(`m/${derivationPath}`);
      const publicKey = node.publicKey;

      if (!publicKey) {
        throw new Error("Public key not found");
      }

      psbt.updateInput(inputIndex, {
        bip32Derivation: [
          {
            masterFingerprint: Buffer.from(signer.masterFingerprint, "hex"),
            pubkey: publicKey,
            path: `${signer.baseDerivationPath}/${derivationPath}`,
          },
        ],
      });
    });

    return psbt;
  };

  const registerWallet = (
    walletPolicy: WalletPolicy,
    options: LedgerActionOptions = {},
  ): Promise<RegisteredWallet> => {
    const signer = createSigner();

    return waitForLedgerAction<RegisteredWallet>(signer.registerWallet(walletPolicy), options);
  };

  const cleanLabel = (label: string): string => {
    const formattedLabel = label
      .replace(
        /[\u{1F600}-\u{1F64F}]|[\u{1F300}-\u{1F5FF}]|[\u{1F680}-\u{1F6FF}]|[\u{1F1E0}-\u{1F1FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]/gu,
        "",
      ) // Remove emojis
      .replace(/[^a-zA-Z0-9\s]/g, "") // Remove special characters
      .replace(/\s+/g, " ") // Replace multiple spaces with a single space
      .trim(); // Trim leading and trailing spaces
    return formattedLabel;
  };

  return {
    getExtendedPublicKey: async (options: LedgerActionOptions = {}) => {
      const signer = createSigner();
      const { extendedPublicKey } = await waitForLedgerAction<{
        extendedPublicKey: string;
      }>(
        signer.getExtendedPublicKey(normalizeDerivationPath(BITCOIN_MAINNET_DERIVATION_PATH)),
        options,
      );

      return extendedPublicKey;
    },

    getMasterFingerprint: (options: LedgerActionOptions = {}) => getMasterFingerprintHex(options),

    signMessage: async (
      message: string,
      derivationPath: string,
      options: LedgerActionOptions = {},
    ) => {
      const signer = createSigner();
      const signature = await waitForLedgerAction<LedgerBitcoinSignature>(
        signer.signMessage(normalizeDerivationPath(derivationPath), message),
        options,
      );

      return serializeMessageSignature(signature);
    },

    signTransaction: async (
      { transaction: { psbtHex, derivationPaths }, signer, wallet }: LedgerBitcoinTransactionParams,
      options: LedgerActionOptions = {},
    ) => {
      if (!derivationPaths || !signer) {
        throw new Error("Bitcoin derivation paths are required");
      }

      const signerInfo = wallet.signers.map((walletSigner) => {
        const path = walletSigner.baseDerivationPath.replace("m/", "");

        return `[${walletSigner.masterFingerprint}/${path}]${walletSigner.extendedPublicKey}`;
      });

      const multisigPolicy = new WalletPolicy(cleanLabel(wallet.label), wallet.policy, signerInfo);

      const ledgerWallet = await registerWallet(multisigPolicy, options);
      const psbt = buildDevicePsbt({
        psbtHex,
        derivationPaths: derivationPaths.split(","),
        signer,
      });

      const ledgerSigner = createSigner();
      const signatures = await waitForLedgerAction<LedgerPsbtSignature[]>(
        ledgerSigner.signPsbt(ledgerWallet, psbt.toBase64()),
        options,
      );

      signatures.forEach((signature) => {
        if (!signature.pubkey || !signature.signature) {
          return;
        }

        psbt.updateInput(signature.inputIndex, {
          partialSig: [
            {
              pubkey: signature.pubkey,
              signature: signature.signature,
            },
          ],
        });
      });

      return psbt.toHex();
    },
  };
};
