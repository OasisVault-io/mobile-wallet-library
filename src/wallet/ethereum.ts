import { ETHEREUM_DERIVATION_PATH } from "../constants";
import { HDKey } from "@scure/bip32";
import * as bip39 from "@scure/bip39";
import { ethers, type TransactionRequest } from "ethers";
import type {
  EthereumGetAddressOptions,
  EthereumGetChildOptions,
  EthereumMobileWallet,
  EthereumSignMessageOptions,
  EthereumSignTransactionOptions,
} from "./wallet";

const getEthereumWallet = (key: HDKey) => {
  if (!key.privateKey) {
    throw new Error("Private key is undefined");
  }
  return new ethers.Wallet(ethers.hexlify(key.privateKey));
};

class EthereumWallet {
  private _master!: HDKey;

  static async init(seedPhrase: string): Promise<EthereumWallet> {
    const instance = new EthereumWallet();
    await instance.initialize(seedPhrase);
    return instance;
  }

  private async initialize(seedPhrase: string) {
    const seed = await bip39.mnemonicToSeed(seedPhrase);
    const master = HDKey.fromMasterSeed(seed);
    this._master = master;
  }

  public async signMessage(
    message: string | Uint8Array,
    derivationPath: string = ETHEREUM_DERIVATION_PATH,
  ) {
    const child = this._master.derive(derivationPath);
    const wallet = getEthereumWallet(child);

    const signature = await wallet.signMessage(message);
    return signature;
  }

  public async signTransaction(
    transaction: TransactionRequest,
    derivationPath: string = ETHEREUM_DERIVATION_PATH,
  ) {
    const child = this._master.derive(derivationPath);
    const wallet = getEthereumWallet(child);

    const signedTransaction = await wallet.signTransaction(transaction);
    return signedTransaction;
  }

  public async getAddress(derivationPath: string = ETHEREUM_DERIVATION_PATH) {
    const child = this._master.derive(derivationPath);
    const wallet = getEthereumWallet(child);
    const address = wallet.address;
    return address;
  }

  public getChild(derivationPath: string = ETHEREUM_DERIVATION_PATH) {
    const child = this._master.derive(derivationPath);
    return child;
  }
}

const createEthereumMobileWalletHandle = (wallet: EthereumWallet): EthereumMobileWallet => ({
  getAddress: ({ derivationPath }: EthereumGetAddressOptions = {}) =>
    wallet.getAddress(derivationPath),
  signMessage: ({ message, derivationPath }: EthereumSignMessageOptions) =>
    wallet.signMessage(message, derivationPath),
  signTransaction: ({ transaction, derivationPath }: EthereumSignTransactionOptions) =>
    wallet.signTransaction(transaction, derivationPath),
  getChild: ({ derivationPath }: EthereumGetChildOptions = {}) => wallet.getChild(derivationPath),
});

/** Creates an Ethereum mobile wallet handle from a BIP-39 mnemonic. */
export const createEthereumMobileWallet = async (mnemonic: string) => {
  const ethWallet = await EthereumWallet.init(mnemonic);
  return createEthereumMobileWalletHandle(ethWallet);
};
