import { describe, expect, it, vi } from "vitest";
import { createMobileWallet } from "../wallet";

vi.mock("../../crypto", () => ({
  byteArrayToBase64String: (byteArray: Uint8Array) => Buffer.from(byteArray).toString("base64"),
  generateRandomUint8Array: (length = 32) => new Uint8Array(length).fill(1),
}));

vi.mock("../../bitcoin", () => ({
  signMessage: vi.fn(),
}));

const MNEMONIC =
  "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
const DEFAULT_ETHEREUM_ADDRESS = "0x9858EfFD232B4033E47d90003D41EC34EcaEda94";
const SECOND_ETHEREUM_ADDRESS = "0x6Fac4D18c912343BF86fa7049364Dd4E424Ab9C0";
const BITCOIN_ACCOUNT_XPUB =
  "xpub6C6nQwHaWbSrzs5tZ1q7m5R9cPK9eYpNMFesiXsYrgc1P8bvLLAet9JfHjYXKjToD8cBRswJXXbbFpXgwsswVPAZzKMa1jUp2kVkGVUaJa7";

describe("createMobileWallet", () => {
  it("creates an Ethereum wallet result with a derived address", async () => {
    const result = await createMobileWallet({
      chain: "ethereum",
      mnemonic: MNEMONIC,
    });

    expect(result).toMatchObject({
      address: DEFAULT_ETHEREUM_ADDRESS,
      chain: "ethereum",
      mnemonic: MNEMONIC,
      type: "ethereum",
    });
    await expect(result.wallet.getAddress()).resolves.toBe(DEFAULT_ETHEREUM_ADDRESS);
  });

  it("uses addressDerivationPath for the Ethereum creation address", async () => {
    const result = await createMobileWallet({
      addressDerivationPath: "m/44'/60'/0'/0/1",
      chain: "ethereum",
      derivationPath: "m/44'/60'/0'/0/0",
      mnemonic: MNEMONIC,
    });

    expect(result.address).toBe(SECOND_ETHEREUM_ADDRESS);
  });

  it("creates a Bitcoin wallet result without deriving a creation address", async () => {
    const result = await createMobileWallet({
      chain: "bitcoin",
      mnemonic: MNEMONIC,
    });

    expect(result).toMatchObject({
      chain: "bitcoin",
      mnemonic: MNEMONIC,
      type: "bitcoin",
    });
    expect("address" in result).toBe(false);
    await expect(result.wallet.getAddress({ derivationPath: "m/49'/0'/0'" })).resolves.toBe(
      BITCOIN_ACCOUNT_XPUB,
    );
  });

  it("rejects invalid mnemonics", async () => {
    await expect(
      createMobileWallet({
        chain: "ethereum",
        mnemonic: "not a valid mnemonic",
      }),
    ).rejects.toThrow("Invalid mnemonic");
  });
});
