import { BITCOIN_MAINNET_DERIVATION_PATH } from "../constants";
import { HDKey } from "@scure/bip32";
import * as bip39 from "@scure/bip39";
import * as bitcoin from "bitcoinjs-lib";
import { signMessage as signBitcoinMessage } from "../bitcoin";
import type {
  BitcoinGetAddressOptions,
  BitcoinGetChildOptions,
  BitcoinMobileWallet,
  BitcoinSignMessageOptions,
  BitcoinSignPsbtOptions,
  BitcoinTransactionToSign,
} from "./wallet";

const resolveDerivationPath = (baseDerivationPath: string, subPath: string) => {
  if (subPath.startsWith("m/")) {
    return subPath;
  }
  return `${baseDerivationPath}/${subPath.replace(/^\//, "")}`;
};

class BitcoinWallet {
  private _master!: HDKey;

  static async init(seedPhrase: string): Promise<BitcoinWallet> {
    const instance = new BitcoinWallet();
    await instance.initialize(seedPhrase);
    return instance;
  }

  private async initialize(seedPhrase: string) {
    const seed = await bip39.mnemonicToSeed(seedPhrase);
    const master = HDKey.fromMasterSeed(seed);
    this._master = master;
  }

  public async signMessage(message: string, derivationPath: string) {
    const child = this._master.derive(derivationPath);
    if (!child.privateKey) {
      throw new Error("Private key is undefined");
    }
    const signature = await signBitcoinMessage(message, child.privateKey, true);
    return signature.toString("base64");
  }

  public async signTransaction({
    transaction,
    baseDerivationPath,
  }: {
    transaction: BitcoinTransactionToSign;
    baseDerivationPath: string;
  }) {
    const network = bitcoin.networks.bitcoin;

    const psbt = bitcoin.Psbt.fromHex(transaction.psbtHex, { network });
    const subPaths = Array.isArray(transaction.derivationPaths)
      ? transaction.derivationPaths
      : transaction.derivationPaths.split(",");
    const fullPaths = subPaths.map((subPath) =>
      resolveDerivationPath(baseDerivationPath, subPath.trim()),
    );

    psbt.data.inputs.forEach((_input, index) => {
      const fullPath = fullPaths[index];
      if (!fullPath) {
        throw new Error(`Missing derivation path for input ${index}`);
      }
      const child = this._master.derive(fullPath);
      if (!child.publicKey || !child.privateKey) {
        throw new Error(`Missing signing key for input ${index}`);
      }
      const signer: bitcoin.Signer = {
        publicKey: child.publicKey,
        sign: (hash) => child.sign(hash),
      };
      psbt.signInput(index, signer);
    });

    const signedPsbtHex = psbt.toHex();
    return signedPsbtHex;
  }

  public async getAddress(derivationPath: string) {
    const child = this._master.derive(derivationPath);
    if (!child.publicKey) {
      throw new Error("Public key is undefined");
    }

    const xpub = child!.publicExtendedKey;
    return xpub;
  }

  public getChild(derivationPath: string = BITCOIN_MAINNET_DERIVATION_PATH) {
    const child = this._master.derive(derivationPath);
    return child;
  }

  public get master() {
    return this._master;
  }
}

const createBitcoinMobileWalletHandle = (wallet: BitcoinWallet): BitcoinMobileWallet => ({
  getAddress: ({ derivationPath }: BitcoinGetAddressOptions) => wallet.getAddress(derivationPath),
  signMessage: ({ message, derivationPath }: BitcoinSignMessageOptions) =>
    wallet.signMessage(message, derivationPath),
  signPsbt: ({
    psbtHex,
    inputDerivationPaths,
    baseDerivationPath = BITCOIN_MAINNET_DERIVATION_PATH,
  }: BitcoinSignPsbtOptions) =>
    wallet.signTransaction({
      transaction: {
        psbtHex,
        derivationPaths: inputDerivationPaths,
      },
      baseDerivationPath,
    }),
  getChild: ({ derivationPath = BITCOIN_MAINNET_DERIVATION_PATH }: BitcoinGetChildOptions = {}) =>
    wallet.getChild(derivationPath),
  master: wallet.master,
});

/** Creates a Bitcoin mobile wallet handle from a BIP-39 mnemonic. */
export const createBitcoinMobileWallet = async (mnemonic: string) => {
  const bitcoinWallet = await BitcoinWallet.init(mnemonic);
  return createBitcoinMobileWalletHandle(bitcoinWallet);
};
