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
import { RNBleTransportFactory } from "@ledgerhq/device-transport-kit-react-native-ble";
import { BehaviorSubject, type Observable, type Subscription } from "rxjs";
import { PermissionsAndroid, Platform } from "react-native";
import { BleManager, State } from "react-native-ble-plx";
import {
  createLedgerBitcoinClient,
  type LedgerBitcoinTransactionParams,
} from "./bitcoin";
import { createLedgerEthereumClient } from "./ethereum";

export type { BitcoinSigner, LedgerBitcoinTransactionParams } from "./bitcoin";

/** Progress state emitted while a Ledger device action is running. */
export type LedgerActionState = {
  /** Device action status from Ledger's device management kit. */
  status: DeviceActionStatus;
  /** User interaction currently required on the Ledger device, when available. */
  requiredUserInteraction?: string;
  /** Chain-specific action step, when available. */
  step?: string;
};

/** Options shared by Ledger operations that can report action progress. */
export type LedgerActionOptions = {
  /** Called whenever the Ledger action status changes. */
  onStateChange?: (state: LedgerActionState) => void;
};

/** Options for Bluetooth Ledger discovery. */
export type LedgerDiscoveryOptions = {
  /** Called when one or more Ledger devices are found. */
  onDevicesFound?: (devices: DiscoveredDevice[]) => void;
  /** Called when discovery fails after it has started. */
  onError?: (error: Error) => void;
};

/** Current Ledger connection/discovery lifecycle state. */
export type LedgerSessionStatus =
  | "connected"
  | "disconnected"
  | "discovering"
  | "error"
  | "idle";

/** Snapshot of the current Ledger session state. */
export type LedgerSessionState = {
  /** Connected or recently disconnected Ledger device. */
  device: ConnectedDevice | null;
  /** Last session error, when any. */
  error: Error | null;
  /** Current session lifecycle status. */
  status: LedgerSessionStatus;
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

/** Error thrown when a Ledger device disconnects during an operation. */
export class LedgerDeviceDisconnectedError extends Error {
  constructor(message = LEDGER_DISCONNECTED_ERROR_MESSAGE) {
    super(message);
    this.name = "LedgerDeviceDisconnectedError";
  }
}

/** Returns true when `error` is a Ledger disconnection error. */
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
  private bitcoinLedger = createLedgerBitcoinClient({
    getDmk: () => this.getDmk(),
    getSessionId: () => this.getCurrentSessionId(),
    normalizeDerivationPath: (derivationPath) =>
      this.normalizeLedgerDerivationPath(derivationPath),
    waitForLedgerAction: (action, options) =>
      this.waitForLedgerAction(action, options),
  });
  private ethereumLedger = createLedgerEthereumClient({
    getDmk: () => this.getDmk(),
    getSessionId: () => this.getCurrentSessionId(),
    normalizeDerivationPath: (derivationPath) =>
      this.normalizeLedgerDerivationPath(derivationPath),
    waitForLedgerAction: (action, options) =>
      this.waitForLedgerAction(action, options),
  });

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

  /** Stops an active Ledger Bluetooth discovery scan. */
  public stopDiscovery() {
    this.stopDiscoveryInternal({ preserveDmk: false });
  }

  /** Returns the latest Ledger session state snapshot. */
  public getSessionState() {
    return this.sessionStateSubject.getValue();
  }

  /** Observes Ledger session state changes. */
  public observeSessionState(): Observable<LedgerSessionState> {
    return this.sessionStateSubject.asObservable();
  }

  /** Disconnects the current Ledger device and resets the session to idle. */
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

  /** Starts Bluetooth discovery for nearby Ledger devices. */
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

  /** Connects to a discovered Ledger device and starts disconnect monitoring. */
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

  /** Opens an app, such as `Ethereum` or `Bitcoin`, on the connected Ledger. */
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

  /** Reads the default Bitcoin account extended public key from Ledger. */
  public async getBitcoinExtendedPublicKey(options: LedgerActionOptions = {}) {
    return this.bitcoinLedger.getExtendedPublicKey(options);
  }

  /** Reads the Bitcoin master fingerprint from Ledger as a hex string. */
  public async getBitcoinMasterFingerprint(options: LedgerActionOptions = {}) {
    return this.bitcoinLedger.getMasterFingerprint(options);
  }

  /** Reads the default Ethereum address from Ledger. */
  public async getEthereumAddress(options: LedgerActionOptions = {}) {
    return this.ethereumLedger.getAddress(options);
  }

  /** Signs a Bitcoin message with the connected Ledger. */
  public async signBitcoinMessage(
    message: string,
    derivationPath: string,
    options: LedgerActionOptions = {},
  ) {
    return this.bitcoinLedger.signMessage(message, derivationPath, options);
  }

  /** Signs an Ethereum personal message with the connected Ledger. */
  public async signEthereumMessage(
    message: string | Uint8Array,
    options: LedgerActionOptions = {},
  ) {
    return this.ethereumLedger.signMessage(message, options);
  }

  /** Signs a serialized Ethereum transaction with the connected Ledger. */
  public async signEthereumTransaction(
    transaction: string | Uint8Array,
    options: LedgerActionOptions = {},
  ) {
    return this.ethereumLedger.signTransaction(transaction, options);
  }

  /** Signs a Bitcoin PSBT with the connected Ledger and wallet policy metadata. */
  public async signBitcoinTransaction(
    params: LedgerBitcoinTransactionParams,
    options: LedgerActionOptions = {},
  ) {
    return this.bitcoinLedger.signTransaction(params, options);
  }

  /** Stops discovery, disconnects, clears subscriptions, and destroys BLE resources. */
  public async cleanup() {
    this.stopDiscovery();
    this.clearStateSubscription();
    await this.disconnect();
    this.setSessionState("idle");
    this.resetDmk();
    this.destroyBleManagerForState();
  }
}

/** Singleton service for discovering, connecting, and signing with Ledger devices. */
export const ledgerService = new LedgerService();
