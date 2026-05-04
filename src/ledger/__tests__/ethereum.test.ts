import { ethers } from "ethers";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createLedgerEthereumClient } from "../ethereum";

const signerMocks = vi.hoisted(() => ({
  SignerEthBuilder: vi.fn(),
  build: vi.fn(),
  signer: {
    getAddress: vi.fn(),
    signMessage: vi.fn(),
    signTransaction: vi.fn(),
  },
}));

vi.mock("@ledgerhq/device-signer-kit-ethereum", () => ({
  SignerEthBuilder: signerMocks.SignerEthBuilder,
}));

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
