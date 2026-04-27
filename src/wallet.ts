import {
  BITCOIN_MAINNET_DERIVATION_PATH,
  BITCOIN_MAINNET_RECOVERY_DERIVATION_PATH,
  ETHEREUM_DERIVATION_PATH,
} from "./constants";
import { HDKey } from "@scure/bip32";
import * as bip39 from "@scure/bip39";
import { ethers } from "ethers";
import * as bitcoin from "bitcoinjs-lib";
import { byteArrayToHexString } from "./crypto";
import { signMessage as signBitcoinMessage } from "./bitcoin";

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

  public async signMessage(message: string) {
    if (!this.root.privateKey) {
      throw new Error("Failed to get private key");
    }
    const privateKey = byteArrayToHexString(this.root.privateKey);
    const wallet = new ethers.Wallet(privateKey);

    const signature = await wallet.signMessage(message);
    return signature;
  }

  public async signTransaction(transaction: string) {
    if (!this.root.privateKey) {
      throw new Error("Failed to get private key");
    }
    const privateKey = byteArrayToHexString(this.root.privateKey);
    const wallet = new ethers.Wallet(privateKey);
    const transactionBytes = ethers.getBytes(transaction);

    const signature = await wallet.signMessage(transactionBytes);
    return signature;
  }

  public async getAddress(derivationPath: string) {
    const child = this.master.derive(derivationPath);
    if (!child.privateKey) {
      throw new Error("Private key is undefined");
    }
    const privateKey = byteArrayToHexString(child.privateKey);
    const wallet = new ethers.Wallet(privateKey);
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
    transaction: { psbtHex, derivationPaths },
    baseDerivationPath,
  }: {
    transaction: {
      psbtHex: string;
      derivationPaths: string;
    };
    baseDerivationPath: string;
  }) {
    const network = bitcoin.networks.bitcoin;

    let psbt = bitcoin.Psbt.fromHex(psbtHex, { network });
    const subPaths = derivationPaths.split(",");
    const fullPaths = subPaths.map(
      (subPath) => baseDerivationPath + "/" + subPath,
    );

    psbt.data.inputs.forEach((input, index) => {
      const child = this.master.derive(fullPaths[index]);
      const signer: bitcoin.Signer = {
        publicKey: child.publicKey as Uint8Array,
        sign: (hash, extraEntropy) => child.sign(hash),
      };
      psbt.signInput(index, signer);
    });

    const signedPsbtHex = psbt.toHex();
    return signedPsbtHex;
  }

  public async getAddress(derivationPath: string) {
    const child = this.master.derive(derivationPath);
    const xpub = child!.publicExtendedKey;
    return xpub;
  }
}

export class Wallet {
  private ethWallet!: ETHWallet;
  private bitcoinWallet!: BitcoinWallet;
  private type!: "bitcoin" | "ethereum";

  constructor(type: "bitcoin" | "ethereum") {
    this.type = type;
  }

  static async init(
    seedPhrase: string,
    type: "bitcoin" | "ethereum",
  ): Promise<Wallet> {
    const instance = new Wallet(type);
    await instance.initialize(seedPhrase, type);
    return instance;
  }

  private async initialize(seedPhrase: string, type: "bitcoin" | "ethereum") {
    if (type === "ethereum") {
      this.ethWallet = await ETHWallet.init(seedPhrase);
    } else if (type === "bitcoin") {
      this.bitcoinWallet = await BitcoinWallet.init(seedPhrase);
    }
  }

  public getRoot() {
    if (this.type === "ethereum") {
      return this.ethWallet.getRoot();
    } else if (this.type === "bitcoin") {
      return this.bitcoinWallet.getRoot();
    }
  }

  public getMaster() {
    if (this.type === "bitcoin") {
      return this.bitcoinWallet.getMaster();
    }
    return null;
  }

  public async signMessage(message: string) {
    if (this.type === "ethereum") {
      return this.ethWallet.signMessage(message);
    } else if (this.type === "bitcoin") {
      return this.bitcoinWallet.signMessage(message);
    }
    return "";
  }

  public async signTransaction(
    transaction: { psbtHex: string; derivationPaths: string } | string,
    baseDerivationPath?: string,
  ) {
    if (this.type === "ethereum") {
      if (typeof transaction === "string") {
        return this.ethWallet.signTransaction(transaction);
      }
      throw new Error("Invalid transaction type for Ethereum");
    } else if (this.type === "bitcoin") {
      if (typeof transaction !== "string" && baseDerivationPath) {
        return this.bitcoinWallet.signTransaction({
          transaction,
          baseDerivationPath,
        });
      }
      throw new Error("Invalid transaction type for Bitcoin");
    }
  }

  public async getAddress(derivationPath: string) {
    if (this.type === "ethereum") {
      return this.ethWallet.getAddress(derivationPath);
    } else if (this.type === "bitcoin") {
      return this.bitcoinWallet.getAddress(derivationPath);
    }
  }
}
