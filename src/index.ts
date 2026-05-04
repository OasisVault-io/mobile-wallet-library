import "./bitcoinjs-lib";

export {
  createMobileWallet,
  type BitcoinAddressType,
  type BitcoinGetAddressOptions,
  type BitcoinGetChildOptions,
  type BitcoinMobileWallet,
  type BitcoinSignMessageOptions,
  type BitcoinSignPsbtOptions,
  type BitcoinTransactionToSign,
  type CreatedBitcoinMobileWallet,
  type CreatedEthereumMobileWallet,
  type CreatedMobileWallet,
  type CreateBitcoinMobileWalletOptions,
  type CreateEthereumMobileWalletOptions,
  type CreateMobileWalletOptions,
  type EthereumGetAddressOptions,
  type EthereumGetChildOptions,
  type EthereumMobileWallet,
  type EthereumSignMessageOptions,
  type EthereumSignTransactionOptions,
  type WalletChain,
  type WalletType,
} from "./wallet/wallet";
export { generateMnemonic, validateMnemonic, generateNonce } from "./utils";
export {
  canUsePasskey,
  registerPasskey,
  getPasskey,
  type GetPasskeyOptions,
  type PasskeyPrfResult,
  type PasskeyRelyingParty,
  type PasskeyUser,
  type RegisterPasskeyOptions,
} from "./passkey";
export {
  BITCOIN_DECIMALS,
  BITCOIN_MAINNET_DERIVATION_PATH,
  ETHEREUM_DECIMALS,
  ETHEREUM_DERIVATION_PATH,
} from "./constants";
export {
  LedgerDeviceDisconnectedError,
  isLedgerDeviceDisconnectedError,
  ledgerService,
  type BitcoinSigner,
  type LedgerActionOptions,
  type LedgerActionState,
  type LedgerBitcoinTransactionParams,
  type LedgerDiscoveryOptions,
  type LedgerSessionState,
  type LedgerSessionStatus,
} from "./ledger/ledger";
