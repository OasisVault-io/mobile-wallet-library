import { type TransactionRequest } from "ethers";
import { generateMnemonic, validateMnemonic } from "../utils";
import { createBitcoinMobileWallet } from "./bitcoin";
import { createEthereumMobileWallet } from "./ethereum";
import type { HDKey } from "@scure/bip32";

/** Supported mainnet chains for mnemonic-based mobile wallets. */
export type WalletChain = "bitcoin" | "ethereum";

/** Alias for {@link WalletChain}. */
export type WalletType = WalletChain;

/**
 * Bitcoin address-format labels kept for apps that model address preferences.
 *
 * Current Bitcoin wallet helpers do not accept an address type; they expose HD
 * child keys, extended public keys, message signing, and PSBT signing.
 */
export type BitcoinAddressType = "p2sh-p2wpkh" | "p2wpkh";

/** PSBT payload and per-input derivation paths for Bitcoin signing. */
export interface BitcoinTransactionToSign {
  /** Hex-encoded PSBT to sign. */
  psbtHex: string;
  /** One derivation path per PSBT input, as an array or comma-separated string. */
  derivationPaths: string | string[];
}

/** Options for creating or restoring an Ethereum mobile wallet. */
export interface CreateEthereumMobileWalletOptions {
  /** Selects the Ethereum wallet flow. */
  chain: "ethereum";
  /** Existing BIP-39 mnemonic. If omitted, a new mnemonic is generated. */
  mnemonic?: string;
  /** Default derivation path used by Ethereum wallet methods. */
  derivationPath?: string;
  /** Derivation path used to compute the returned `address`. */
  addressDerivationPath?: string;
}

/** Options for creating or restoring a Bitcoin mobile wallet. */
export interface CreateBitcoinMobileWalletOptions {
  /** Selects the Bitcoin wallet flow. */
  chain: "bitcoin";
  /** Existing BIP-39 mnemonic. If omitted, a new mnemonic is generated. */
  mnemonic?: string;
  /**
   * Accepted for API compatibility with callers that store a default account path.
   *
   * Bitcoin wallet methods receive their signing or derivation path per call.
   */
  derivationPath?: string;
}

/** Options accepted by {@link createMobileWallet}. */
export type CreateMobileWalletOptions =
  | CreateEthereumMobileWalletOptions
  | CreateBitcoinMobileWalletOptions;

/** Result returned when creating or restoring an Ethereum mobile wallet. */
export interface CreatedEthereumMobileWallet {
  /** Plain-object Ethereum wallet handle. */
  wallet: EthereumMobileWallet;
  /** Generated or restored mnemonic. Storage and encryption are app-owned. */
  mnemonic: string;
  /** Address derived during wallet creation. */
  address: string;
  /** Chain discriminator. */
  chain: "ethereum";
  /** Chain discriminator kept for wallet-type naming consistency. */
  type: "ethereum";
}

/** Result returned when creating or restoring a Bitcoin mobile wallet. */
export interface CreatedBitcoinMobileWallet {
  /** Plain-object Bitcoin wallet handle. */
  wallet: BitcoinMobileWallet;
  /** Generated or restored mnemonic. Storage and encryption are app-owned. */
  mnemonic: string;
  /** Chain discriminator. Bitcoin creation does not derive or return an address. */
  chain: "bitcoin";
  /** Chain discriminator kept for wallet-type naming consistency. */
  type: "bitcoin";
}

/** Chain-specific result returned by {@link createMobileWallet}. */
export type CreatedMobileWallet = CreatedEthereumMobileWallet | CreatedBitcoinMobileWallet;

/** Options for deriving an Ethereum address. */
export interface EthereumGetAddressOptions {
  /** Full Ethereum derivation path. Defaults to the package Ethereum path. */
  derivationPath?: string;
}

/** Options for signing an Ethereum personal message. */
export interface EthereumSignMessageOptions {
  /** Message bytes or string to sign. */
  message: string | Uint8Array;
  /** Full Ethereum derivation path. Defaults to the package Ethereum path. */
  derivationPath?: string;
}

/** Options for signing an Ethereum transaction. */
export interface EthereumSignTransactionOptions {
  /** Ethers transaction request to serialize and sign. */
  transaction: TransactionRequest;
  /** Full Ethereum derivation path. Defaults to the package Ethereum path. */
  derivationPath?: string;
}

/** Options for deriving an Ethereum HD child key. */
export interface EthereumGetChildOptions {
  /** Full Ethereum derivation path. Defaults to the package Ethereum path. */
  derivationPath?: string;
}

/** Ethereum wallet handle returned by {@link createMobileWallet}. */
export interface EthereumMobileWallet {
  /** Derives an Ethereum address. */
  getAddress(options?: EthereumGetAddressOptions): Promise<string>;
  /** Signs an Ethereum personal message. */
  signMessage(options: EthereumSignMessageOptions): Promise<string>;
  /** Signs an Ethereum transaction request. */
  signTransaction(options: EthereumSignTransactionOptions): Promise<string>;
  /** Derives an Ethereum HD child key. */
  getChild(options?: EthereumGetChildOptions): HDKey;
}

/** Options for reading a Bitcoin extended public key. */
export interface BitcoinGetExtendedPublicKeyOptions {
  /** Full Bitcoin derivation path for the extended public key. */
  derivationPath: string;
}

/** Options for signing a Bitcoin message. */
export interface BitcoinSignMessageOptions {
  /** Message string to sign. */
  message: string;
  /** Full Bitcoin derivation path for the signing key. */
  derivationPath: string;
}

/** Options for signing a Bitcoin PSBT. */
export interface BitcoinSignPsbtOptions {
  /** Hex-encoded PSBT to sign. */
  psbtHex: string;
  /** One relative or absolute derivation path per PSBT input. */
  inputDerivationPaths: string | string[];
  /** Base derivation path used to resolve relative input paths. */
  baseDerivationPath?: string;
}

/** Options for deriving a Bitcoin HD child key. */
export interface BitcoinGetChildOptions {
  /** Derivation path. Defaults to the package Bitcoin account path. */
  derivationPath?: string;
}

/** Bitcoin wallet handle returned by {@link createMobileWallet}. */
export interface BitcoinMobileWallet {
  /** Returns the public extended key at the requested derivation path. */
  getExtendedPublicKey(options: BitcoinGetExtendedPublicKeyOptions): Promise<string>;
  /** Signs a Bitcoin message. */
  signMessage(options: BitcoinSignMessageOptions): Promise<string>;
  /** Signs each input in a PSBT and returns the signed PSBT hex. */
  signPsbt(options: BitcoinSignPsbtOptions): Promise<string>;
  /** Derives a Bitcoin HD child key. */
  getChild(options?: BitcoinGetChildOptions): HDKey;
  /** Root HD key created from the mnemonic. */
  master: HDKey;
}

/**
 * Creates or restores an Ethereum mobile wallet from a mnemonic.
 *
 * If `mnemonic` is omitted, a new BIP-39 mnemonic is generated and returned.
 * If `derivationPath` is omitted, the default derivation path is used. (m/44'/60'/0'/0/0)
 */
export function createMobileWallet(
  options: CreateEthereumMobileWalletOptions,
): Promise<CreatedEthereumMobileWallet>;
/**
 * Creates or restores a Bitcoin mobile wallet from a mnemonic.
 *
 * If `mnemonic` is omitted, a new BIP-39 mnemonic is generated and returned.
 * The Bitcoin result does not include an address; use wallet methods to derive
 * HD child keys, read extended public keys, sign messages, or sign PSBTs.
 */
export function createMobileWallet(
  options: CreateBitcoinMobileWalletOptions,
): Promise<CreatedBitcoinMobileWallet>;
/**
 * Creates or restores a chain-specific mobile wallet.
 *
 * If `mnemonic` is omitted, a new BIP-39 mnemonic is generated and returned.
 * For Ethereum, `derivationPath` controls the default address derived during
 * creation unless `addressDerivationPath` is provided.
 * The returned `wallet` is a plain object with chain-specific signing and
 * derivation methods. This library does not store or encrypt the mnemonic.
 */
export async function createMobileWallet(
  options: CreateMobileWalletOptions,
): Promise<CreatedMobileWallet> {
  const mnemonic = options.mnemonic ?? generateMnemonic();

  if (!validateMnemonic(mnemonic)) {
    throw new Error("Invalid mnemonic");
  }

  if (options.chain === "ethereum") {
    const wallet = await createEthereumMobileWallet(mnemonic);
    const address = await wallet.getAddress({
      derivationPath: options.addressDerivationPath ?? options.derivationPath,
    });

    return {
      wallet,
      mnemonic,
      address,
      chain: "ethereum",
      type: "ethereum",
    };
  }

  const wallet = await createBitcoinMobileWallet(mnemonic);

  return {
    wallet,
    mnemonic,
    chain: "bitcoin",
    type: "bitcoin",
  };
}
