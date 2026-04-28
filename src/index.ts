import "./bitcoinjs-lib";

export {
  Wallet,
  createWallet,
  type BitcoinAddressType,
  type BitcoinTransactionToSign,
  type CreatedWallet,
  type CreateWalletOptions,
  type WalletType,
} from "./wallet";
export { generateMnemonic, validateMnemonic, generateNonce } from "./utils";
export { registerPasskey, getPasskey } from "./passkey";
