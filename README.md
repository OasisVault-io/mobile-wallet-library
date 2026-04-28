# rn-multisig-wallet

Library that allows the creation of multisig wallets in BTC and ETH

## Installation

```sh
npm install rn-multisig-wallet
```

## Usage

```ts
import { createWallet } from "rn-multisig-wallet";

const { wallet, mnemonic, address } = await createWallet({
  type: "ethereum",
});

const messageSignature = await wallet.signMessage("Sign in to my app");
const signedTransaction = await wallet.signTransaction({
  to: "0x0000000000000000000000000000000000000000",
  value: 1n,
  nonce: 0,
  gasLimit: 21000n,
  gasPrice: 1n,
  chainId: 1,
});
```

### Import an existing wallet

```ts
import { createWallet } from "rn-multisig-wallet";

const { wallet, address } = await createWallet({
  type: "ethereum",
  mnemonic: "test test test test test test test test test test test junk",
});
```

### Bitcoin

```ts
import { createWallet } from "rn-multisig-wallet";

const { wallet, address } = await createWallet({
  type: "bitcoin",
});

const messageSignature = await wallet.signMessage("Sign in to my app");

const signedPsbtHex = await wallet.signTransaction({
  psbtHex: "70736274...",
  derivationPaths: ["0/0", "0/1"],
});

const accountXpub = wallet.getExtendedPublicKey();
```

## Contributing

- [Development workflow](CONTRIBUTING.md#development-workflow)
- [Sending a pull request](CONTRIBUTING.md#sending-a-pull-request)
- [Code of conduct](CODE_OF_CONDUCT.md)

## License

MIT

---

Made with [create-react-native-library](https://github.com/callstack/react-native-builder-bob)
