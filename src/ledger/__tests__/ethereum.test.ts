import { ethers } from "ethers";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createLedgerEthereumClient, type LedgerEthereumTypedData } from "../ethereum";

const signerMocks = vi.hoisted(() => ({
  SignerEthBuilder: vi.fn(),
  build: vi.fn(),
  signer: {
    getAddress: vi.fn(),
    signMessage: vi.fn(),
    signTransaction: vi.fn(),
    signTypedData: vi.fn(),
  },
}));

vi.mock("@ledgerhq/device-signer-kit-ethereum", () => ({
  SignerEthBuilder: signerMocks.SignerEthBuilder,
}));

const TYPED_DATA: LedgerEthereumTypedData = {
  domain: {
    name: "Oasis Vault Test",
    version: "1",
    chainId: 11155111,
    verifyingContract: "0x000000000000000000000000000000000000dEaD",
  },
  types: {
    Mail: [
      { name: "from", type: "address" },
      { name: "to", type: "address" },
      { name: "contents", type: "string" },
    ],
  },
  primaryType: "Mail",
  message: {
    from: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
    to: "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC",
    contents: "Hello, Ledger",
  },
};

// Signature produced by the well-known Hardhat account #1 private key
// (0x59c6995e...690d) over TYPED_DATA. Kept as a fixed fixture so the test
// fails if anything changes the bytes that reach ethers.Signature.
const TYPED_DATA_SIGNATURE =
  "0x00c4333191fbd6a2701ed4e755887466b84a03ffc09cc744b2d7d72a7977b6b911ad819c67137ed12a8ba71b881771af2e2c82a52c9734946d341936ecd25cc61b";
const TYPED_DATA_SIGNER_ADDRESS = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";

const createClient = () => {
  const getDmk = vi.fn(() => ({ id: "dmk" }));
  const getSessionId = vi.fn(() => "session-id");
  const normalizeDerivationPath = vi.fn((derivationPath: string) =>
    derivationPath.replace(/^m\//, "").replace(/^\//, ""),
  );
  const waitForLedgerAction = vi.fn(async (action: any) => action.output);

  return {
    client: createLedgerEthereumClient({
      getDmk: getDmk as any,
      getSessionId: getSessionId as any,
      normalizeDerivationPath,
      waitForLedgerAction,
    }),
    getDmk,
    getSessionId,
    normalizeDerivationPath,
    waitForLedgerAction,
  };
};

describe("createLedgerEthereumClient", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    signerMocks.build.mockReturnValue(signerMocks.signer);
    signerMocks.SignerEthBuilder.mockImplementation(function SignerEthBuilder() {
      return {
        build: signerMocks.build,
      };
    });
  });

  it("reads the default Ethereum address through the connected Ledger session", async () => {
    const { client, getDmk, getSessionId, normalizeDerivationPath, waitForLedgerAction } =
      createClient();
    const options = { onStateChange: vi.fn() };
    const action = {
      output: {
        address: "0x742d35Cc6634C0532925a3b844Bc454e4438f44e",
        publicKey: "public-key",
      },
    };

    signerMocks.signer.getAddress.mockReturnValue(action);

    await expect(client.getAddress(options)).resolves.toBe(action.output.address);
    expect(getDmk).toHaveBeenCalledOnce();
    expect(getSessionId).toHaveBeenCalledOnce();
    expect(signerMocks.SignerEthBuilder).toHaveBeenCalledWith({
      dmk: { id: "dmk" },
      sessionId: "session-id",
      originToken: undefined,
    });
    expect(normalizeDerivationPath).toHaveBeenCalledWith("m/44'/60'/0'/0/0");
    expect(signerMocks.signer.getAddress).toHaveBeenCalledWith("44'/60'/0'/0/0");
    expect(waitForLedgerAction).toHaveBeenCalledWith(action, options);
  });

  it("signs personal messages and serializes the Ledger signature", async () => {
    const { client, waitForLedgerAction } = createClient();
    const options = { onStateChange: vi.fn() };
    const signature = {
      r: `0x${"11".repeat(32)}`,
      s: `0x${"22".repeat(32)}`,
      v: 27,
    };
    const action = { output: signature };

    signerMocks.signer.signMessage.mockReturnValue(action);

    await expect(client.signMessage("hello", options)).resolves.toBe(
      ethers.Signature.from(signature).serialized,
    );
    expect(signerMocks.signer.signMessage).toHaveBeenCalledWith("44'/60'/0'/0/0", "hello");
    expect(waitForLedgerAction).toHaveBeenCalledWith(action, options);
  });

  it("signs typed data with the default path and forwards action options", async () => {
    const { client, normalizeDerivationPath, waitForLedgerAction } = createClient();
    const options = { onStateChange: vi.fn() };
    const signature = {
      r: `0x${"55".repeat(32)}`,
      s: `0x${"66".repeat(32)}`,
      v: 28,
    };
    const action = { output: signature };

    signerMocks.signer.signTypedData.mockReturnValue(action);

    const serialized = await client.signTypedData(TYPED_DATA, options);

    expect(normalizeDerivationPath).toHaveBeenCalledWith("m/44'/60'/0'/0/0");
    expect(signerMocks.signer.signTypedData).toHaveBeenCalledWith("44'/60'/0'/0/0", TYPED_DATA);
    expect(waitForLedgerAction).toHaveBeenCalledWith(action, options);
    expect(serialized).toBe(ethers.Signature.from(signature).serialized);
    expect(ethers.dataLength(serialized)).toBe(65);
  });

  it("serializes the deterministic EIP-712 fixture into a recoverable 65-byte signature", async () => {
    const { client } = createClient();
    const fixture = ethers.Signature.from(TYPED_DATA_SIGNATURE);
    const action = {
      output: {
        r: fixture.r,
        s: fixture.s,
        v: fixture.v,
      },
    };

    signerMocks.signer.signTypedData.mockReturnValue(action);

    const serialized = await client.signTypedData(TYPED_DATA);

    expect(serialized).toBe(TYPED_DATA_SIGNATURE);
    expect(ethers.dataLength(serialized)).toBe(65);
    expect(
      ethers.verifyTypedData(TYPED_DATA.domain, TYPED_DATA.types, TYPED_DATA.message, serialized),
    ).toBe(TYPED_DATA_SIGNER_ADDRESS);
  });

  it("preserves the rejection error raised by the Ledger action", async () => {
    const { client, waitForLedgerAction } = createClient();
    const rejection = new Error("Ledger action was stopped");
    rejection.name = "LedgerActionStoppedError";

    waitForLedgerAction.mockRejectedValueOnce(rejection);

    await expect(client.signTypedData(TYPED_DATA)).rejects.toBe(rejection);
  });

  it("normalizes serialized transactions to bytes before signing", async () => {
    const { client } = createClient();
    const signature = {
      r: `0x${"33".repeat(32)}`,
      s: `0x${"44".repeat(32)}`,
      v: 28,
    };
    const action = { output: signature };

    signerMocks.signer.signTransaction.mockReturnValue(action);

    await expect(client.signTransaction("0x010203")).resolves.toBe(
      ethers.Signature.from(signature).serialized,
    );
    expect(signerMocks.signer.signTransaction).toHaveBeenCalledWith(
      "44'/60'/0'/0/0",
      Uint8Array.from([1, 2, 3]),
    );
  });
});
