import { DeviceActionStatus } from "@ledgerhq/device-management-kit";
import { ethers } from "ethers";
import { Observable } from "rxjs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LedgerEthereumTypedData } from "../ethereum";
import {
  LedgerDeviceDisconnectedError,
  isLedgerDeviceDisconnectedError,
  ledgerService,
} from "../ledger";

const signerMocks = vi.hoisted(() => ({
  SignerEthBuilder: vi.fn(),
  build: vi.fn(),
  signer: {
    signTypedData: vi.fn(),
  },
}));

vi.mock("@ledgerhq/device-signer-kit-ethereum", () => ({
  SignerEthBuilder: signerMocks.SignerEthBuilder,
}));

// Only the Bitcoin client is stubbed out; the Ethereum client and the service
// action runner stay real so path/option forwarding and error normalization are
// exercised end to end.
vi.mock("../bitcoin", () => ({
  createLedgerBitcoinClient: vi.fn(() => ({
    getExtendedPublicKey: vi.fn(),
    getMasterFingerprint: vi.fn(),
    signMessage: vi.fn(),
    signTransaction: vi.fn(),
  })),
}));

vi.mock("react-native", () => ({
  PermissionsAndroid: {
    PERMISSIONS: {},
    RESULTS: {},
    requestMultiple: vi.fn(),
  },
  Platform: { OS: "ios" },
}));

vi.mock("react-native-ble-plx", () => ({
  BleManager: class BleManager {},
  State: {},
}));

vi.mock("@ledgerhq/device-transport-kit-react-native-ble", () => ({
  RNBleTransportFactory: {},
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

const TYPED_DATA_SIGNATURE =
  "0x00c4333191fbd6a2701ed4e755887466b84a03ffc09cc744b2d7d72a7977b6b911ad819c67137ed12a8ba71b881771af2e2c82a52c9734946d341936ecd25cc61b";

const fakeDmk = { id: "dmk" };

const createDeviceAction = (states: Array<Record<string, unknown>>) => {
  const cancel = vi.fn();
  const observable = new Observable<Record<string, unknown>>((subscriber) => {
    const timeout = setTimeout(() => {
      for (const state of states) {
        subscriber.next(state);
      }
      subscriber.complete();
    }, 0);

    return () => clearTimeout(timeout);
  });

  return { observable, cancel };
};

const connectSession = () => {
  (ledgerService as any).currentSessionId = "session-id";
};

describe("ledgerService.signEthereumTypedData", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    signerMocks.build.mockReturnValue(signerMocks.signer);
    signerMocks.SignerEthBuilder.mockImplementation(function SignerEthBuilder() {
      return { build: signerMocks.build };
    });
    signerMocks.signer.signTypedData.mockReset();
    (ledgerService as any).currentSessionId = null;
    (ledgerService as any).sessionDevice = null;
    (ledgerService as any).dmkInstance = fakeDmk;
    (ledgerService as any).sessionStateSubject.next({
      device: null,
      error: null,
      status: "idle",
    });
  });

  it("forwards typed data, path, and options, then serializes the signature", async () => {
    connectSession();
    const signature = ethers.Signature.from(TYPED_DATA_SIGNATURE);
    const action = createDeviceAction([
      {
        status: DeviceActionStatus.Pending,
        intermediateValue: {
          requiredUserInteraction: "SignTypedData",
          step: "signer.eth.steps.signTypedData",
        },
      },
      {
        status: DeviceActionStatus.Completed,
        output: {
          r: signature.r,
          s: signature.s,
          v: signature.v,
        },
      },
    ]);
    signerMocks.signer.signTypedData.mockReturnValue(action);
    const onStateChange = vi.fn();

    const serialized = await ledgerService.signEthereumTypedData(TYPED_DATA, {
      onStateChange,
    });

    expect(signerMocks.SignerEthBuilder).toHaveBeenCalledWith({
      dmk: fakeDmk,
      sessionId: "session-id",
      originToken: undefined,
    });
    expect(signerMocks.signer.signTypedData).toHaveBeenCalledWith("44'/60'/0'/0/0", TYPED_DATA);
    expect(serialized).toBe(TYPED_DATA_SIGNATURE);
    expect(ethers.dataLength(serialized)).toBe(65);
    expect(onStateChange).toHaveBeenCalledWith({
      status: DeviceActionStatus.Pending,
      requiredUserInteraction: "SignTypedData",
      step: "signer.eth.steps.signTypedData",
    });
    expect(onStateChange).toHaveBeenCalledWith({
      status: DeviceActionStatus.Completed,
    });
  });

  it("preserves and classifies a Ledger disconnection error", async () => {
    connectSession();
    const disconnected = new LedgerDeviceDisconnectedError();
    signerMocks.signer.signTypedData.mockReturnValue(
      createDeviceAction([{ status: DeviceActionStatus.Error, error: disconnected }]),
    );

    const error = await ledgerService
      .signEthereumTypedData(TYPED_DATA)
      .catch((reason: unknown) => reason);

    expect(error).toBe(disconnected);
    expect(isLedgerDeviceDisconnectedError(error)).toBe(true);
  });

  it("preserves a device rejection while the session is connected", async () => {
    connectSession();
    const rejection = new Error("User rejected the request on the device");
    signerMocks.signer.signTypedData.mockReturnValue(
      createDeviceAction([{ status: DeviceActionStatus.Error, error: rejection }]),
    );

    const error = await ledgerService
      .signEthereumTypedData(TYPED_DATA)
      .catch((reason: unknown) => reason);

    expect(error).toBe(rejection);
    expect(isLedgerDeviceDisconnectedError(error)).toBe(false);
  });

  it("classifies plain errors as disconnection errors while the session is disconnected", async () => {
    connectSession();
    (ledgerService as any).sessionStateSubject.next({
      device: null,
      error: null,
      status: "disconnected",
    });
    const rejection = new Error("Device connection lost");
    signerMocks.signer.signTypedData.mockReturnValue(
      createDeviceAction([{ status: DeviceActionStatus.Error, error: rejection }]),
    );

    const error = await ledgerService
      .signEthereumTypedData(TYPED_DATA)
      .catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(LedgerDeviceDisconnectedError);
    expect(error).not.toBe(rejection);
    expect(isLedgerDeviceDisconnectedError(error)).toBe(true);
  });

  it("rejects before contacting the device when no session is connected", async () => {
    await expect(ledgerService.signEthereumTypedData(TYPED_DATA)).rejects.toThrow(
      "No Ledger device connected",
    );
    expect(signerMocks.signer.signTypedData).not.toHaveBeenCalled();
  });
});
