import { ethers, type TransactionRequest } from "ethers";
import { describe, expect, it } from "vitest";
import { createEthereumMobileWallet } from "../ethereum";

const MNEMONIC =
  "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
const DEFAULT_ADDRESS = "0x9858EfFD232B4033E47d90003D41EC34EcaEda94";
const SECOND_ADDRESS = "0x6Fac4D18c912343BF86fa7049364Dd4E424Ab9C0";

describe("createEthereumMobileWallet", () => {
  it("derives the default Ethereum address from a mnemonic", async () => {
    const wallet = await createEthereumMobileWallet(MNEMONIC);

    await expect(wallet.getAddress()).resolves.toBe(DEFAULT_ADDRESS);
    expect(wallet.getChild().privateKey).toBeDefined();
  });

  it("derives addresses from custom derivation paths", async () => {
    const wallet = await createEthereumMobileWallet(MNEMONIC);

    await expect(wallet.getAddress({ derivationPath: "m/44'/60'/0'/0/1" })).resolves.toBe(
      SECOND_ADDRESS,
    );
  });

  it("signs messages with the selected child key", async () => {
    const wallet = await createEthereumMobileWallet(MNEMONIC);
    const message = "hello oasis";

    const signature = await wallet.signMessage({ message });

    expect(ethers.verifyMessage(message, signature)).toBe(DEFAULT_ADDRESS);
  });

  it("signs Ethereum transactions with the selected child key", async () => {
    const wallet = await createEthereumMobileWallet(MNEMONIC);
    const transaction: TransactionRequest = {
      chainId: 1,
      gasLimit: 21000n,
      gasPrice: 1000000000n,
      nonce: 0,
      to: "0x0000000000000000000000000000000000000001",
      value: 123n,
    };

    const signedTransaction = await wallet.signTransaction({ transaction });
    const parsedTransaction = ethers.Transaction.from(signedTransaction);

    expect(parsedTransaction.from).toBe(DEFAULT_ADDRESS);
    expect(parsedTransaction.to).toBe(transaction.to);
    expect(parsedTransaction.value).toBe(transaction.value);
  });
});
