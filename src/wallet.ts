import {
  BITCOIN_MAINNET_DERIVATION_PATH,
  BITCOIN_MAINNET_RECOVERY_DERIVATION_PATH,
  ETHEREUM_DERIVATION_PATH,
} from "./constants";
import { HDKey } from "@scure/bip32";
import * as bip39 from "@scure/bip39";
import { ethers, type TransactionRequest } from "ethers";
import * as bitcoin from "bitcoinjs-lib";
import { signMessage as signBitcoinMessage } from "./bitcoin";
import { Buffer } from "buffer";
import { generateMnemonic, validateMnemonic } from "./utils";

export type WalletType = "bitcoin" | "ethereum";
export type BitcoinAddressType = "p2sh-p2wpkh" | "p2wpkh";

export interface CreateWalletOptions {
  type: WalletType;
  mnemonic?: string;
  bitcoinDerivationPath?: string;
  addressDerivationPath?: string;
}

export interface CreatedWallet {
  wallet: Wallet;
  mnemonic: string;
  address: string;
  type: WalletType;
}

export interface BitcoinTransactionToSign {
  psbtHex: string;
  derivationPaths: string | string[];
}

interface WalletInitOptions {
  bitcoinDerivationPath?: string;
}

const getEthereumWallet = (key: HDKey) => {
  if (!key.privateKey) {
    throw new Error("Private key is undefined");
  }
  return new ethers.Wallet(ethers.hexlify(key.privateKey));
};

const resolveDerivationPath = (baseDerivationPath: string, subPath: string) => {
  if (subPath.startsWith("m/")) {
    return subPath;
  }
  return `${baseDerivationPath}/${subPath.replace(/^\//, "")}`;
};

export const createWallet = async ({
  type,
  mnemonic = generateMnemonic(),
  bitcoinDerivationPath,
  addressDerivationPath,
}: CreateWalletOptions): Promise<CreatedWallet> => {
  if (!validateMnemonic(mnemonic)) {
    throw new Error("Invalid mnemonic");
  }

  const wallet = await Wallet.init(mnemonic, type, { bitcoinDerivationPath });
  const address = await wallet.getAddress(addressDerivationPath);

  return {
    wallet,
    mnemonic,
    address,
    type,
  };
};

export class ETHWallet {
  private master!: HDKey;
  private root!: HDKey;

  static async init(seedPhrase: string): Promise<ETHWallet> {
    const instance = new ETHWallet();
    await instance.initialize(seedPhrase);
    return instance;
  }

  private async initialize(seedPhrase: string) {
    const seed = await bip39.mnemonicToSeed(seedPhrase);
    const master = HDKey.fromMasterSeed(seed);
    const root = master.derive(ETHEREUM_DERIVATION_PATH);
    this.root = root;
    this.master = master;
  }

  public getRoot() {
    return this.root;
  }

  public getMaster() {
    return this.master;
  }

  public async signMessage(
    message: string | Uint8Array,
    derivationPath: string = ETHEREUM_DERIVATION_PATH,
  ) {
    const child = this.master.derive(derivationPath);
    const wallet = getEthereumWallet(child);

    const signature = await wallet.signMessage(message);
    return signature;
  }

  public async signTransaction(
    transaction: TransactionRequest,
    derivationPath: string = ETHEREUM_DERIVATION_PATH,
  ) {
    const child = this.master.derive(derivationPath);
    const wallet = getEthereumWallet(child);

    const signedTransaction = await wallet.signTransaction(transaction);
    return signedTransaction;
  }

  public async getAddress(derivationPath: string = ETHEREUM_DERIVATION_PATH) {
    const child = this.master.derive(derivationPath);
    const wallet = getEthereumWallet(child);
    const address = wallet.address;
    return address;
  }
}

export class BitcoinWallet {
  private master!: HDKey;
  private root!: HDKey;

  static async init(
    seedPhrase: string,
    derivationPath: string = BITCOIN_MAINNET_DERIVATION_PATH,
  ): Promise<BitcoinWallet> {
    const instance = new BitcoinWallet();
    await instance.initialize(seedPhrase, derivationPath);
    return instance;
  }

  private async initialize(seedPhrase: string, derivationPath: string) {
    const seed = await bip39.mnemonicToSeed(seedPhrase);
    const master = HDKey.fromMasterSeed(seed);
    const root = master.derive(derivationPath);
    this.root = root;
    this.master = master;
  }

  public getMaster() {
    return this.master;
  }

  public getRoot() {
    return this.root;
  }

  public async signMessage(
    message: string,
    derivationPath: string = BITCOIN_MAINNET_RECOVERY_DERIVATION_PATH,
  ) {
    const child = this.master.derive(derivationPath);
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
      const child = this.master.derive(fullPath);
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

  public async getAddress(
    derivationPath: string = BITCOIN_MAINNET_RECOVERY_DERIVATION_PATH,
    addressType: BitcoinAddressType = "p2sh-p2wpkh",
  ) {
    const child = this.master.derive(derivationPath);
    if (!child.publicKey) {
      throw new Error("Public key is undefined");
    }

    const network = bitcoin.networks.bitcoin;
    const pubkey = Buffer.from(child.publicKey);
    const payment =
      addressType === "p2wpkh"
        ? bitcoin.payments.p2wpkh({ pubkey, network })
        : bitcoin.payments.p2sh({
            redeem: bitcoin.payments.p2wpkh({ pubkey, network }),
            network,
          });

    if (!payment.address) {
      throw new Error("Failed to derive Bitcoin address");
    }

    return payment.address;
  }

  public getExtendedPublicKey(derivationPath: string = BITCOIN_MAINNET_DERIVATION_PATH) {
    const child = this.master.derive(derivationPath);
    return child.publicExtendedKey;
  }
}

export class Wallet {
  private ethWallet!: ETHWallet;
  private bitcoinWallet!: BitcoinWallet;
  private type!: WalletType;

  constructor(type: WalletType) {
    this.type = type;
  }

  static async init(
    seedPhrase: string,
    type: WalletType,
    options: WalletInitOptions = {},
  ): Promise<Wallet> {
    const instance = new Wallet(type);
    await instance.initialize(seedPhrase, type, options);
    return instance;
  }

  private async initialize(seedPhrase: string, type: WalletType, options: WalletInitOptions) {
    if (!validateMnemonic(seedPhrase)) {
      throw new Error("Invalid mnemonic");
    }

    if (type === "ethereum") {
      this.ethWallet = await ETHWallet.init(seedPhrase);
    } else if (type === "bitcoin") {
      this.bitcoinWallet = await BitcoinWallet.init(seedPhrase, options.bitcoinDerivationPath);
    }
  }

  public getRoot() {
    if (this.type === "ethereum") {
      return this.ethWallet.getRoot();
    } else if (this.type === "bitcoin") {
      return this.bitcoinWallet.getRoot();
    }
    throw new Error(`Unsupported wallet type: ${this.type}`);
  }

  public getMaster() {
    if (this.type === "bitcoin") {
      return this.bitcoinWallet.getMaster();
    } else if (this.type === "ethereum") {
      return this.ethWallet.getMaster();
    }
    throw new Error(`Unsupported wallet type: ${this.type}`);
  }

  public async signMessage(message: string | Uint8Array, derivationPath?: string) {
    if (this.type === "ethereum") {
      return this.ethWallet.signMessage(message, derivationPath);
    } else if (this.type === "bitcoin") {
      if (typeof message !== "string") {
        throw new Error("Bitcoin message signing expects a string message");
      }
      return this.bitcoinWallet.signMessage(message, derivationPath);
    }
    throw new Error(`Unsupported wallet type: ${this.type}`);
  }

  public async signTransaction(
    transaction: BitcoinTransactionToSign | TransactionRequest,
    baseDerivationPath?: string,
  ) {
    if (this.type === "ethereum") {
      if ("psbtHex" in transaction) {
        throw new Error("Invalid transaction type for Ethereum");
      }
      return this.ethWallet.signTransaction(transaction);
    } else if (this.type === "bitcoin") {
      if (!("psbtHex" in transaction)) {
        throw new Error("Invalid transaction type for Bitcoin");
      }
      return this.bitcoinWallet.signTransaction({
        transaction,
        baseDerivationPath: baseDerivationPath ?? BITCOIN_MAINNET_DERIVATION_PATH,
      });
    }
    throw new Error(`Unsupported wallet type: ${this.type}`);
  }

  public async getAddress(derivationPath?: string) {
    if (this.type === "ethereum") {
      return this.ethWallet.getAddress(derivationPath);
    } else if (this.type === "bitcoin") {
      return this.bitcoinWallet.getAddress(derivationPath);
    }
    throw new Error(`Unsupported wallet type: ${this.type}`);
  }

  public getExtendedPublicKey(derivationPath?: string) {
    if (this.type !== "bitcoin") {
      throw new Error("Extended public keys are only available for Bitcoin");
    }
    return this.bitcoinWallet.getExtendedPublicKey(derivationPath);
  }
}
