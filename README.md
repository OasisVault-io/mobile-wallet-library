# rn-multisig-wallet

React Native helpers for mobile wallets that use BTC and ETH mainnet.

The library focuses on three separate flows:

- Mobile wallets: create or restore a wallet from a mnemonic and sign BTC/ETH actions.
- Passkey PRF keys: register or retrieve a passkey-derived key. Your app decides how to use it.
- Ledger devices: connect to a physical Ledger and request signatures from it.

## Installation

```sh
npm install rn-multisig-wallet
```

## Create a New Ethereum Wallet

```ts
import { createMobileWallet } from "rn-multisig-wallet";

const { wallet, mnemonic, address } = await createMobileWallet({
  chain: "ethereum",
});

// Show the mnemonic to the user so they can back it up.
// Store only what your app needs for its own encrypted wallet flow.
console.log({ mnemonic, address });

const messageSignature = await wallet.signMessage({
  message: "Sign in to my app",
});

const signedTransaction = await wallet.signTransaction({
  transaction: {
    to: "0x0000000000000000000000000000000000000000",
    value: 1n,
    nonce: 0,
    gasLimit: 21000n,
    gasPrice: 1n,
    chainId: 1,
  },
});
```

## Restore an Ethereum Wallet

```ts
import { createMobileWallet } from "rn-multisig-wallet";

const { wallet, address } = await createMobileWallet({
  chain: "ethereum",
  mnemonic: "test test test test test test test test test test test junk",
});

const nextAddress = await wallet.getAddress({
  derivationPath: "m/44'/60'/0'/0/1",
});

console.log({ address, nextAddress });
```

## Create or Restore a Bitcoin Wallet

```ts
import { createMobileWallet } from "rn-multisig-wallet";

const { wallet, mnemonic } = await createMobileWallet({
  chain: "bitcoin",
});

console.log({ mnemonic });

const derivedXpub = await wallet.getAddress({
  derivationPath: "m/49'/0'/0'/0/0",
});

const messageSignature = await wallet.signMessage({
  message: "Sign in to my app",
  derivationPath: "m/49'/0'/0'/0/0",
});

const signedPsbtHex = await wallet.signPsbt({
  psbtHex: "70736274...",
  inputDerivationPaths: ["0/0", "0/1"],
});

const accountKey = wallet.getChild({
  derivationPath: "m/49'/0'/0'",
});

console.log({
  derivedXpub,
  signedPsbtHex,
  accountXpub: accountKey.publicExtendedKey,
});
```

The Bitcoin mobile wallet helpers expose HD keys, extended public keys, message
signing, and PSBT signing. They do not currently derive on-chain addresses or
accept an `addressType` option.

## Passkey PRF Keys

Passkeys are separate from wallet creation. Use them to create or retrieve a PRF-derived key, then decide in your app how that key should be used. For example, your app may use it to encrypt and decrypt a stored mnemonic, but this library does not choose an encryption format for you.

Store the returned `nonce` with your app's encrypted wallet metadata. Pass the same nonce to `getPasskey` later to retrieve the same PRF key.

```ts
import { canUsePasskey, registerPasskey, getPasskey } from "rn-multisig-wallet";

if (!canUsePasskey()) {
  throw new Error("Passkeys are not available on this device");
}

const registered = await registerPasskey({
  rp: {
    id: "example.com",
    name: "Example Wallet",
  },
  user: {
    id: "user-123",
    name: "user@example.com",
    displayName: "User",
  },
});

// Store registered.nonce. Your app decides whether and how to use registered.key.
console.log(registered);

const restored = await getPasskey({
  rpId: "example.com",
  nonce: registered.nonce,
});

console.log(restored.key);
```

## Ledger Connected Signer

Ledger is treated as a connected signing device, not as a wallet created by the library. The app controls discovery, connection, app opening, and signing requests.

```ts
import { ledgerService } from "rn-multisig-wallet";

await ledgerService.startDiscovery({
  onDevicesFound: async ([device]) => {
    if (!device) {
      return;
    }

    await ledgerService.connect(device);
    await ledgerService.openApp("Ethereum");

    const address = await ledgerService.getEthereumAddress({
      onStateChange: (state) => console.log(state),
    });

    const signature = await ledgerService.signEthereumMessage("Sign in", {
      onStateChange: (state) => console.log(state),
    });

    console.log({ address, signature });
  },
  onError: (error) => console.error(error),
});
```

### Bitcoin Ledger Signing

```ts
import { ledgerService } from "rn-multisig-wallet";

await ledgerService.openApp("Bitcoin");

const extendedPublicKey = await ledgerService.getBitcoinExtendedPublicKey();
const masterFingerprint = await ledgerService.getBitcoinMasterFingerprint();

const signedPsbtHex = await ledgerService.signBitcoinTransaction({
  transaction: {
    psbtHex: "70736274...",
    derivationPaths: "0/0,0/1",
  },
  signer: {
    id: "ledger-1",
    signerId: "ledger-1",
    policyHmac: null,
    masterFingerprint,
    extendedPublicKey,
    baseDerivationPath: "m/49'/0'/0'",
  },
  wallet: {
    label: "My Wallet",
    policy: "wsh(sortedmulti(2,@0/**,@1/**))",
    signers: [
      {
        id: "ledger-1",
        signerId: "ledger-1",
        policyHmac: null,
        masterFingerprint,
        extendedPublicKey,
        baseDerivationPath: "m/49'/0'/0'",
      },
    ],
  },
});

console.log(signedPsbtHex);
```

## Mainnet Defaults

The package is mainnet-only for now. These constants are exported for apps that want to display or override derivation paths:

```ts
import {
  BITCOIN_DECIMALS,
  BITCOIN_MAINNET_DERIVATION_PATH,
  ETHEREUM_DECIMALS,
  ETHEREUM_DERIVATION_PATH,
} from "rn-multisig-wallet";
```

- `BITCOIN_DECIMALS`: `8`.
- `ETHEREUM_DECIMALS`: `18`.
- `BITCOIN_MAINNET_DERIVATION_PATH`: `m/49'/0'/0'`.
- `ETHEREUM_DERIVATION_PATH`: `m/44'/60'/0'/0/0`.

## API Reference

### Wallets

- `createMobileWallet(options)`: creates or restores a chain-specific mobile wallet from a BIP-39 mnemonic. When `mnemonic` is omitted, the library returns a newly generated mnemonic. The library does not store or encrypt it.
- `CreateMobileWalletOptions`: union of `CreateEthereumMobileWalletOptions` and `CreateBitcoinMobileWalletOptions`.
- `CreateEthereumMobileWalletOptions`: `{ chain: "ethereum", mnemonic?, derivationPath?, addressDerivationPath? }`. `addressDerivationPath` overrides the path used for the returned `address`.
- `CreateBitcoinMobileWalletOptions`: `{ chain: "bitcoin", mnemonic?, derivationPath? }`. Bitcoin wallet methods receive their signing or derivation path per call.
- `CreatedMobileWallet`: union of `CreatedEthereumMobileWallet` and `CreatedBitcoinMobileWallet`.
- `CreatedEthereumMobileWallet`: `{ wallet, mnemonic, address, chain: "ethereum", type: "ethereum" }`.
- `CreatedBitcoinMobileWallet`: `{ wallet, mnemonic, chain: "bitcoin", type: "bitcoin" }`. No Bitcoin address is derived during creation.
- `WalletChain` / `WalletType`: `"bitcoin" | "ethereum"`.
- `BitcoinAddressType`: `"p2sh-p2wpkh" | "p2wpkh"` labels for apps that model address preferences. Current Bitcoin wallet helpers do not accept this type.

### Ethereum Mobile Wallet

- `EthereumMobileWallet.getAddress(options?)`: derives an Ethereum address. Options type: `EthereumGetAddressOptions`.
- `EthereumMobileWallet.signMessage(options)`: signs a personal message. Options type: `EthereumSignMessageOptions`.
- `EthereumMobileWallet.signTransaction(options)`: signs an ethers `TransactionRequest`. Options type: `EthereumSignTransactionOptions`.
- `EthereumMobileWallet.getChild(options?)`: derives an `HDKey`. Options type: `EthereumGetChildOptions`.

### Bitcoin Mobile Wallet

- `BitcoinMobileWallet.getAddress(options)`: returns the public extended key at the requested derivation path. Options type: `BitcoinGetAddressOptions`.
- `BitcoinMobileWallet.signMessage(options)`: signs a Bitcoin message. Options type: `BitcoinSignMessageOptions`.
- `BitcoinMobileWallet.signPsbt(options)`: signs each PSBT input and returns signed PSBT hex. Options type: `BitcoinSignPsbtOptions`.
- `BitcoinMobileWallet.getChild(options?)`: derives an `HDKey`. Options type: `BitcoinGetChildOptions`.
- `BitcoinMobileWallet.master`: root `HDKey` created from the mnemonic.
- `BitcoinTransactionToSign`: lower-level PSBT payload shape with `psbtHex` and per-input `derivationPaths`.

### Utilities

- `generateMnemonic()`: returns a 24-word BIP-39 English mnemonic.
- `validateMnemonic(mnemonic)`: returns `true` for a valid BIP-39 English mnemonic.
- `generateNonce(length?)`: returns a random base64 string. `length` is the byte count before encoding and defaults to `32`.

### Passkeys

- `canUsePasskey()`: returns `true` when the current iOS or Android device supports passkey PRF operations.
- `registerPasskey(options)`: registers a resident passkey and returns `{ key, nonce }`. Options type: `RegisterPasskeyOptions`.
- `getPasskey(options)`: retrieves a PRF key using a stored nonce and returns `{ key, nonce }`. Options type: `GetPasskeyOptions`.
- `PasskeyRelyingParty`: relying-party `{ id, name }`.
- `PasskeyUser`: resident passkey user `{ id, name, displayName }`.
- `PasskeyPrfResult`: base64 PRF `key` and base64 `nonce`.

### Ledger

- `ledgerService`: singleton for Ledger Bluetooth discovery, connection, app opening, session observation, signing, and cleanup.
- `ledgerService.startDiscovery(options?)`: starts Bluetooth discovery. Options type: `LedgerDiscoveryOptions`.
- `ledgerService.stopDiscovery()`: stops an active discovery scan.
- `ledgerService.connect(device)`: connects to a discovered Ledger device.
- `ledgerService.disconnect()`: disconnects the current Ledger device and resets the session.
- `ledgerService.openApp(appName, options?)`: opens a Ledger app such as `Ethereum` or `Bitcoin`.
- `ledgerService.getSessionState()` / `ledgerService.observeSessionState()`: read or subscribe to `LedgerSessionState`.
- `ledgerService.getEthereumAddress(options?)`: reads the default Ethereum address.
- `ledgerService.signEthereumMessage(message, options?)`: signs an Ethereum personal message.
- `ledgerService.signEthereumTransaction(transaction, options?)`: signs a serialized Ethereum transaction.
- `ledgerService.getBitcoinExtendedPublicKey(options?)`: reads the default Bitcoin account xpub.
- `ledgerService.getBitcoinMasterFingerprint(options?)`: reads the Bitcoin master fingerprint as hex.
- `ledgerService.signBitcoinMessage(message, derivationPath, options?)`: signs a Bitcoin message.
- `ledgerService.signBitcoinTransaction(params, options?)`: signs a Bitcoin PSBT with wallet policy metadata. Params type: `LedgerBitcoinTransactionParams`.
- `ledgerService.cleanup()`: stops discovery, disconnects, clears subscriptions, and destroys BLE resources.
- `LedgerActionOptions` / `LedgerActionState`: progress callback types used by Ledger operations.
- `LedgerSessionStatus` / `LedgerSessionState`: connection lifecycle state types.
- `LedgerDiscoveryOptions`: callbacks for Bluetooth device discovery.
- `BitcoinSigner` / `LedgerBitcoinTransactionParams`: Bitcoin wallet policy and PSBT signing metadata.
- `LedgerDeviceDisconnectedError` / `isLedgerDeviceDisconnectedError(error)`: Ledger disconnection error and type guard.

## Contributing

- [Development workflow](CONTRIBUTING.md#development-workflow)
- [Sending a pull request](CONTRIBUTING.md#sending-a-pull-request)
- [Code of conduct](CODE_OF_CONDUCT.md)

## License

MIT
