import {
  DeviceActionStatus,
  type ConnectedDevice,
  type DeviceActionIntermediateValue,
  type DeviceManagementKit,
  type ExecuteDeviceActionReturnType,
  type DeviceSessionId,
  type DiscoveredDevice,
  DeviceManagementKitBuilder,
  DeviceStatus,
  ConsoleLogger,
  OpenAppDeviceAction,
} from "@ledgerhq/device-management-kit";
import {
  RegisteredWallet,
  SignerBtcBuilder,
  WalletPolicy,
} from "@ledgerhq/device-signer-kit-bitcoin";
import { SignerEthBuilder } from "@ledgerhq/device-signer-kit-ethereum";
import { RNBleTransportFactory } from "@ledgerhq/device-transport-kit-react-native-ble";
import { HDKey } from "@scure/bip32";
import { ethers } from "ethers";
import * as bitcoin from "bitcoinjs-lib";
import { BehaviorSubject, type Observable, type Subscription } from "rxjs";
import { PermissionsAndroid, Platform } from "react-native";
import { BleManager, State } from "react-native-ble-plx";
import {
  BITCOIN_MAINNET_DERIVATION_PATH,
  BITCOIN_MAINNET_RECOVERY_DERIVATION_PATH,
  ETHEREUM_DERIVATION_PATH,
} from "./constants";
import { byteArrayToHexString } from "./crypto";

export type LedgerActionState = {
  status: DeviceActionStatus;
  requiredUserInteraction?: string;
  step?: string;
};

export type LedgerActionOptions = {
  onStateChange?: (state: LedgerActionState) => void;
};

export type LedgerDiscoveryOptions = {
  onDevicesFound?: (devices: DiscoveredDevice[]) => void;
  onError?: (error: Error) => void;
};

export type LedgerSessionStatus =
  | "connected"
  | "disconnected"
  | "discovering"
  | "error"
  | "idle";

export type LedgerSessionState = {
  device: ConnectedDevice | null;
  error: Error | null;
  status: LedgerSessionStatus;
};

export type BitcoinSigner = {
  id: string;
  signerId: string;
  policyHmac: string | null;
  masterFingerprint: string;
  extendedPublicKey: string;
  baseDerivationPath: string;
};

export type LedgerBitcoinTransactionParams = {
  transaction: {
    psbtHex: string;
    derivationPaths: string;
  };
  signer: BitcoinSigner;
  wallet: {
    label: string;
    policy: string;
    signers: BitcoinSigner[];
  };
};

type LedgerBitcoinSignature = {
  r: string;
  s: string;
  v: number;
};

type LedgerEthereumSignature = {
  r: string;
  s: string;
  v: number;
};

type LedgerPsbtSignature = {
  inputIndex: number;
  pubkey?: Uint8Array;
  signature?: Uint8Array;
  tapleafHash?: Uint8Array;
};

type CreateDevicePsbtParams = {
  psbtHex: string;
  derivationPaths: string[];
  signer: BitcoinSigner;
};

const BLE_MANAGER_DESTROYED_ERROR = "BleManager was destroyed";
const BLUETOOTH_RESET_ERROR_MESSAGE =
  "Bluetooth connection was reset. Please try scanning again.";
const LEDGER_DISCONNECTED_ERROR_MESSAGE =
  "Ledger disconnected. Reconnect to continue.";
const initialLedgerSessionState: LedgerSessionState = {
  device: null,
  error: null,
  status: "idle",
};

export class LedgerDeviceDisconnectedError extends Error {
  constructor(message = LEDGER_DISCONNECTED_ERROR_MESSAGE) {
    super(message);
    this.name = "LedgerDeviceDisconnectedError";
  }
}

export function isLedgerDeviceDisconnectedError(error: unknown) {
  return error instanceof LedgerDeviceDisconnectedError;
}

class LedgerService {
  private bleManagerForState: BleManager | null = null;
  private discoverySubscription: Subscription | null = null;
  private stateSubscription: Subscription | null = null;
  private currentSessionId: DeviceSessionId | null = null;
  private dmkInstance: DeviceManagementKit | null = null;
  private discoveryRunId = 0;
  private isDisconnecting = false;
  private sessionStateSubject = new BehaviorSubject<LedgerSessionState>(
    initialLedgerSessionState,
  );
  private sessionDevice: ConnectedDevice | null = null;

  private createDmk(): DeviceManagementKit {
    return new DeviceManagementKitBuilder()
      .addTransport(RNBleTransportFactory)
      .addLogger(new ConsoleLogger())
      .build();
  }

  private resetDmk() {
    if (!this.dmkInstance) {
      return;
    }

    try {
      this.dmkInstance.close();
    } catch (error) {
      console.error(error);
    } finally {
      this.dmkInstance = null;
    }
  }

  private getDmk(): DeviceManagementKit {
    if (!this.dmkInstance) {
      this.dmkInstance = this.createDmk();
    }

    return this.dmkInstance;
  }

  private getBleManagerForState(): BleManager {
    if (!this.bleManagerForState) {
      this.bleManagerForState = new BleManager();
    }

    return this.bleManagerForState;
  }

  private destroyBleManagerForState() {
    this.bleManagerForState?.destroy();
    this.bleManagerForState = null;
  }

  private setSessionState(
    status: LedgerSessionStatus,
    options: { device?: ConnectedDevice | null; error?: Error | null } = {},
  ) {
    this.sessionStateSubject.next({
      device:
        options.device !== undefined
          ? options.device
          : status === "connected"
            ? this.sessionDevice
            : null,
      error: options.error ?? null,
      status,
    });
  }

  private createDisconnectedError(error?: unknown) {
    if (error instanceof LedgerDeviceDisconnectedError) {
      return error;
    }

    return new LedgerDeviceDisconnectedError();
  }

  private isBleManagerDestroyedError(message: string) {
    return message.includes(BLE_MANAGER_DESTROYED_ERROR);
  }

  private normalizeActionError(error: unknown) {
    const normalizedError = this.toError(error);

    if (
      isLedgerDeviceDisconnectedError(normalizedError) ||
      this.getSessionState().status === "disconnected"
    ) {
      return this.createDisconnectedError(normalizedError);
    }

    return normalizedError;
  }

  private handleUnexpectedDisconnect(error?: unknown) {
    if (this.isDisconnecting || !this.currentSessionId) {
      return;
    }

    const disconnectedDevice = this.sessionDevice;
    const disconnectedError = this.createDisconnectedError(error);

    this.clearDiscoverySubscription();
    this.clearStateSubscription();
    this.currentSessionId = null;
    this.sessionDevice = null;
    this.resetDmk();
    this.setSessionState("disconnected", {
      device: disconnectedDevice,
      error: disconnectedError,
    });
  }

  private toError(error: unknown): Error {
    if (isLedgerDeviceDisconnectedError(error)) {
      return error;
    }

    if (error instanceof Error) {
      if (this.isBleManagerDestroyedError(error.message)) {
        return new Error(BLUETOOTH_RESET_ERROR_MESSAGE);
      }

      return error;
    }

    return new Error("Unknown Ledger error");
  }

  private wait(delay = 1000): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, delay));
  }

  private normalizeLedgerDerivationPath(derivationPath: string) {
    return derivationPath.replace(/^m\//, "").replace(/^\//, "");
  }

  private getCurrentSessionId(): DeviceSessionId {
    if (!this.currentSessionId) {
      throw new Error("No Ledger device connected");
    }

    return this.currentSessionId;
  }

  private createBitcoinLedgerSigner() {
    return new SignerBtcBuilder({
      dmk: this.getDmk(),
      sessionId: this.getCurrentSessionId(),
    }).build();
  }

  private createEthereumLedgerSigner(originToken?: string) {
    return new SignerEthBuilder({
      dmk: this.getDmk(),
      sessionId: this.getCurrentSessionId(),
      originToken,
    }).build();
  }

  private serializeLedgerBitcoinMessageSignature(
    signature: LedgerBitcoinSignature,
  ) {
    const r = Buffer.from(signature.r.replace(/^0x/, ""), "hex");
    const s = Buffer.from(signature.s.replace(/^0x/, ""), "hex");
    // Ledger returns a legacy recovery header, while the software wallet uses
    // a compressed compact header for message signatures.
    const headerValue =
      signature.v < 27
        ? signature.v + 31
        : signature.v < 31
          ? signature.v + 4
          : signature.v;
    const header = Buffer.from([headerValue]);

    return Buffer.concat([header, r, s]).toString("base64");
  }

  private serializeLedgerEthereumSignature(signature: LedgerEthereumSignature) {
    return ethers.Signature.from(signature).serialized;
  }

  private async getMasterFingerprintHex(options: LedgerActionOptions = {}) {
    const signer = this.createBitcoinLedgerSigner();
    const { masterFingerprint } = await this.waitForLedgerAction<{
      masterFingerprint: Uint8Array;
    }>(signer.getMasterFingerprint(), options);

    return byteArrayToHexString(masterFingerprint);
  }

  private getBitcoinNetwork() {
    return bitcoin.networks.bitcoin;
  }

  private buildDevicePsbt({
    psbtHex,
    derivationPaths,
    signer,
  }: CreateDevicePsbtParams): bitcoin.Psbt {
    const psbt = bitcoin.Psbt.fromHex(psbtHex, {
      network: this.getBitcoinNetwork(),
    });

    if (derivationPaths.length !== psbt.inputCount) {
      throw new Error(
        `Ledger input derivation path count mismatch: expected ${psbt.inputCount}, received ${derivationPaths.length}`,
      );
    }

    derivationPaths.forEach((derivationPath, inputIndex) => {
      const node = HDKey.fromExtendedKey(signer.extendedPublicKey).derive(
        `m/${derivationPath}`,
      );
      const publicKey = node.publicKey;

      if (!publicKey) {
        throw new Error("Public key not found");
      }

      psbt.updateInput(inputIndex, {
        bip32Derivation: [
          {
            masterFingerprint: Buffer.from(signer.masterFingerprint, "hex"),
            pubkey: publicKey,
            path: `${signer.baseDerivationPath}/${derivationPath}`,
          },
        ],
      });
    });

    return psbt;
  }

  private async waitForLedgerAction<
    Output,
    Error = unknown,
    IntermediateValue extends DeviceActionIntermediateValue =
      DeviceActionIntermediateValue,
  >(
    action: ExecuteDeviceActionReturnType<Output, Error, IntermediateValue>,
    options: LedgerActionOptions = {},
  ): Promise<Output> {
    type ActionState = {
      status: DeviceActionStatus.Pending;
      intermediateValue: IntermediateValue;
    };
    const { onStateChange } = options;

    return new Promise<Output>((resolve, reject) => {
      const subscription = action.observable.subscribe({
        next: (state: any) => {
          if (state.status === DeviceActionStatus.Pending) {
            const pendingState = state as ActionState;
            const intermediateValue =
              pendingState.intermediateValue as DeviceActionIntermediateValue & {
                step?: unknown;
              };
            const step =
              typeof intermediateValue.step === "string"
                ? intermediateValue.step
                : undefined;

            onStateChange?.({
              status: state.status,
              requiredUserInteraction:
                intermediateValue.requiredUserInteraction,
              step,
            });
            return;
          }

          onStateChange?.({ status: state.status });

          if (state.status === DeviceActionStatus.Completed) {
            subscription.unsubscribe();
            resolve(state.output as Output);
            return;
          }

          if (state.status === DeviceActionStatus.Error) {
            subscription.unsubscribe();
            reject(this.normalizeActionError(state.error));
            return;
          }

          if (state.status === DeviceActionStatus.Stopped) {
            subscription.unsubscribe();
            reject(new Error("Ledger action was stopped"));
          }
        },
        error: (error: Error) => {
          subscription.unsubscribe();
          action.cancel();
          reject(this.normalizeActionError(error));
        },
      });
    });
  }

  private async registerLedgerWallet(
    walletPolicy: WalletPolicy,
    options: LedgerActionOptions = {},
  ): Promise<RegisteredWallet> {
    const signer = this.createBitcoinLedgerSigner();

    return this.waitForLedgerAction<RegisteredWallet>(
      signer.registerWallet(walletPolicy),
      options,
    );
  }

  private async requestBluetoothPermissions(): Promise<boolean> {
    if (Platform.OS === "android") {
      try {
        const granted = await PermissionsAndroid.requestMultiple([
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
        ]);

        const allGranted = Object.values(granted).every(
          (status) => status === PermissionsAndroid.RESULTS.GRANTED,
        );

        return allGranted;
      } catch (error) {
        console.error(error);
        return false;
      }
    }

    return true;
  }

  private async waitForBluetoothPoweredOn(): Promise<boolean> {
    return new Promise((resolve) => {
      const bleManager = this.getBleManagerForState();
      let isResolved = false;

      const resolveState = (isReady: boolean) => {
        if (isResolved) {
          return;
        }

        isResolved = true;
        subscription.remove();
        clearTimeout(timeoutId);
        resolve(isReady);
      };

      const handleBluetoothState = (state: State) => {
        if (state === State.PoweredOn) {
          resolveState(true);
          return;
        }

        if (state === State.PoweredOff || state === State.Unsupported) {
          resolveState(false);
          return;
        }

        if (state === State.Unauthorized) {
          resolveState(false);
        }
      };

      const subscription = bleManager.onStateChange(handleBluetoothState, true);

      const timeoutId = setTimeout(() => {
        resolveState(false);
      }, 10000);
    });
  }

  private clearDiscoverySubscription() {
    if (!this.discoverySubscription) {
      return;
    }

    this.discoverySubscription.unsubscribe();
    this.discoverySubscription = null;
  }

  private stopDiscoveryInternal({ preserveDmk }: { preserveDmk: boolean }) {
    this.discoveryRunId += 1;
    this.clearDiscoverySubscription();

    if (!preserveDmk && !this.currentSessionId) {
      this.resetDmk();
    }

    if (this.getSessionState().status === "discovering") {
      this.setSessionState("idle");
    }
  }

  private clearStateSubscription() {
    if (!this.stateSubscription) {
      return;
    }

    this.stateSubscription.unsubscribe();
    this.stateSubscription = null;
  }

  private monitorDeviceState(sessionId: DeviceSessionId): Subscription {
    const dmk = this.getDmk();

    return dmk.getDeviceSessionState({ sessionId }).subscribe({
      next: (state: any) => {
        if (state.deviceStatus === DeviceStatus.NOT_CONNECTED) {
          this.handleUnexpectedDisconnect();
          return;
        }
      },
      error: (error: Error) => {
        console.error(error);
        this.handleUnexpectedDisconnect(error);
      },
    });
  }

  public stopDiscovery() {
    this.stopDiscoveryInternal({ preserveDmk: false });
  }

  public getSessionState() {
    return this.sessionStateSubject.getValue();
  }

  public observeSessionState(): Observable<LedgerSessionState> {
    return this.sessionStateSubject.asObservable();
  }

  public async disconnect() {
    this.isDisconnecting = true;
    this.clearStateSubscription();
    this.clearDiscoverySubscription();

    const sessionId = this.currentSessionId;
    const dmk = this.dmkInstance;

    this.currentSessionId = null;
    this.sessionDevice = null;

    try {
      if (sessionId && dmk) {
        await dmk.disconnect({ sessionId });
      }
    } catch (error) {
      console.error(error);
    } finally {
      this.resetDmk();
      this.setSessionState("idle");
      this.isDisconnecting = false;
    }
  }

  public async startDiscovery({
    onDevicesFound,
    onError,
  }: LedgerDiscoveryOptions = {}) {
    this.clearDiscoverySubscription();
    const runId = this.discoveryRunId + 1;
    this.discoveryRunId = runId;

    if (!this.currentSessionId) {
      this.resetDmk();
    }

    this.setSessionState("discovering");

    // Warm the DMK BLE transport early on iOS so the underlying manager can
    // finish its own initialization before discovery starts.
    if (Platform.OS === "ios") {
      this.getDmk();
    }

    const hasPermissions = await this.requestBluetoothPermissions();
    if (runId !== this.discoveryRunId) {
      return;
    }

    if (!hasPermissions) {
      this.setSessionState("error", {
        error: new Error("Bluetooth permissions not granted"),
      });
      throw new Error("Bluetooth permissions not granted");
    }

    const btReady = await this.waitForBluetoothPoweredOn();
    if (runId !== this.discoveryRunId) {
      return;
    }

    if (!btReady) {
      const bluetoothState = await this.getBleManagerForState()
        .state()
        .catch(() => null);
      const bluetoothErrorMessage =
        bluetoothState === State.Unauthorized
          ? "Bluetooth permissions not granted"
          : "Bluetooth is not available";

      this.setSessionState("error", {
        error: new Error(bluetoothErrorMessage),
      });
      throw new Error(bluetoothErrorMessage);
    }

    await this.wait(100);
    if (runId !== this.discoveryRunId) {
      return;
    }

    const dmk = this.getDmk();

    await this.wait();
    if (runId !== this.discoveryRunId) {
      return;
    }

    this.discoverySubscription = dmk.listenToAvailableDevices({}).subscribe({
      next: (devices: DiscoveredDevice[]) => {
        if (runId !== this.discoveryRunId) {
          return;
        }

        if (devices.length === 0) {
          return;
        }

        onDevicesFound?.(devices);
      },
      error: (error: Error) => {
        if (runId !== this.discoveryRunId) {
          return;
        }

        const normalizedError = this.toError(error);

        this.setSessionState("error", { error: normalizedError });
        onError?.(normalizedError);
      },
    });
  }

  public async connect(device: DiscoveredDevice): Promise<ConnectedDevice> {
    this.stopDiscoveryInternal({ preserveDmk: true });
    this.clearStateSubscription();
    await this.disconnect();

    const dmk = this.getDmk();

    try {
      this.currentSessionId = await dmk.connect({ device });

      const connectedDevice = dmk.getConnectedDevice({
        sessionId: this.currentSessionId,
      });

      this.sessionDevice = connectedDevice;
      this.setSessionState("connected", { device: connectedDevice });
      this.stateSubscription = this.monitorDeviceState(this.currentSessionId);

      return connectedDevice;
    } catch (error) {
      const normalizedError = this.toError(error);

      this.currentSessionId = null;
      this.sessionDevice = null;
      this.resetDmk();
      this.setSessionState("error", { error: normalizedError });
      throw normalizedError;
    }
  }

  public async openApp(
    appName: string,
    options: LedgerActionOptions = {},
  ): Promise<void> {
    if (!this.currentSessionId) {
      throw new Error("No Ledger device connected");
    }

    const dmk = this.getDmk();
    const { onStateChange } = options;
    const deviceAction = new OpenAppDeviceAction({
      input: { appName },
    });

    return new Promise<void>((resolve, reject) => {
      const { observable, cancel } = dmk.executeDeviceAction({
        sessionId: this.currentSessionId!,
        deviceAction,
      });

      const subscription = observable.subscribe({
        next: (state: any) => {
          if (state.status === DeviceActionStatus.Pending) {
            onStateChange?.({
              status: state.status,
              requiredUserInteraction:
                state.intermediateValue.requiredUserInteraction,
              step: state.intermediateValue.step,
            });
            return;
          }

          onStateChange?.({ status: state.status });

          if (state.status === DeviceActionStatus.Completed) {
            subscription.unsubscribe();
            resolve();
            return;
          }

          if (state.status === DeviceActionStatus.Error) {
            subscription.unsubscribe();
            reject(this.normalizeActionError(state.error));
            return;
          }

          if (state.status === DeviceActionStatus.Stopped) {
            subscription.unsubscribe();
            reject(new Error(`Opening ${appName} app was stopped`));
            return;
          }
        },
        error: (error: Error) => {
          subscription.unsubscribe();
          cancel();
          reject(this.normalizeActionError(error));
        },
      });
    });
  }

  public async getBitcoinExtendedPublicKey(options: LedgerActionOptions = {}) {
    const signer = this.createBitcoinLedgerSigner();
    const { extendedPublicKey } = await this.waitForLedgerAction<{
      extendedPublicKey: string;
    }>(
      signer.getExtendedPublicKey(
        this.normalizeLedgerDerivationPath(BITCOIN_MAINNET_DERIVATION_PATH),
      ),
      options,
    );

    return extendedPublicKey;
  }

  public async getBitcoinMasterFingerprint(options: LedgerActionOptions = {}) {
    return this.getMasterFingerprintHex(options);
  }

  public async getEthereumAddress(options: LedgerActionOptions = {}) {
    const signer = this.createEthereumLedgerSigner();
    const { address } = await this.waitForLedgerAction<{
      address: string;
      publicKey: string;
      chainCode?: string;
    }>(
      signer.getAddress(
        this.normalizeLedgerDerivationPath(ETHEREUM_DERIVATION_PATH),
      ),
      options,
    );

    return address;
  }

  public async signBitcoinMessage(
    message: string,
    options: LedgerActionOptions = {},
  ) {
    const signer = this.createBitcoinLedgerSigner();
    const signature = await this.waitForLedgerAction<LedgerBitcoinSignature>(
      signer.signMessage(
        this.normalizeLedgerDerivationPath(
          BITCOIN_MAINNET_RECOVERY_DERIVATION_PATH,
        ),
        message,
      ),
      options,
    );

    return this.serializeLedgerBitcoinMessageSignature(signature);
  }

  public async signEthereumMessage(
    message: string,
    options: LedgerActionOptions = {},
  ) {
    const signer = this.createEthereumLedgerSigner();
    const signature = await this.waitForLedgerAction<LedgerEthereumSignature>(
      signer.signMessage(
        this.normalizeLedgerDerivationPath(ETHEREUM_DERIVATION_PATH),
        message,
      ),
      options,
    );

    return this.serializeLedgerEthereumSignature(signature);
  }

  public async signEthereumTransaction(
    transaction: string,
    options: LedgerActionOptions = {},
  ) {
    const signer = this.createEthereumLedgerSigner();
    const signature = await this.waitForLedgerAction<LedgerEthereumSignature>(
      signer.signMessage(
        this.normalizeLedgerDerivationPath(ETHEREUM_DERIVATION_PATH),
        ethers.getBytes(transaction),
      ),
      options,
    );

    return this.serializeLedgerEthereumSignature(signature);
  }

  private cleanLabel(label: string): string {
    const formattedLabel = label
      .replace(
        /[\u{1F600}-\u{1F64F}]|[\u{1F300}-\u{1F5FF}]|[\u{1F680}-\u{1F6FF}]|[\u{1F1E0}-\u{1F1FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]/gu,
        "",
      ) // Remove emojis
      .replace(/[^a-zA-Z0-9\s]/g, "") // Remove special characters
      .replace(/\s+/g, " ") // Replace multiple spaces with a single space
      .trim(); // Trim leading and trailing spaces
    return formattedLabel;
  }

  public async signBitcoinTransaction(
    {
      transaction: { psbtHex, derivationPaths },
      signer,
      wallet,
    }: LedgerBitcoinTransactionParams,
    options: LedgerActionOptions = {},
  ) {
    if (!derivationPaths || !signer) {
      throw new Error("Bitcoin derivation paths are required");
    }

    const signerInfo = wallet.signers.map((walletSigner) => {
      const path = walletSigner.baseDerivationPath.replace("m/", "");

      return `[${walletSigner.masterFingerprint}/${path}]${walletSigner.extendedPublicKey}`;
    });

    const multisigPolicy = new WalletPolicy(
      this.cleanLabel(wallet.label),
      wallet.policy,
      signerInfo,
    );

    const ledgerWallet = await this.registerLedgerWallet(
      multisigPolicy,
      options,
    );
    const psbt = this.buildDevicePsbt({
      psbtHex,
      derivationPaths: derivationPaths.split(","),
      signer,
    });

    const ledgerSigner = this.createBitcoinLedgerSigner();
    const signatures = await this.waitForLedgerAction<LedgerPsbtSignature[]>(
      ledgerSigner.signPsbt(ledgerWallet, psbt.toBase64()),
      options,
    );

    signatures.forEach((signature) => {
      if (!signature.pubkey || !signature.signature) {
        return;
      }

      psbt.updateInput(signature.inputIndex, {
        partialSig: [
          {
            pubkey: signature.pubkey,
            signature: signature.signature,
          },
        ],
      });
    });

    return psbt.toHex();
  }

  public async cleanup() {
    this.stopDiscovery();
    this.clearStateSubscription();
    await this.disconnect();
    this.setSessionState("idle");
    this.resetDmk();
    this.destroyBleManagerForState();
  }
}

export const ledgerService = new LedgerService();
