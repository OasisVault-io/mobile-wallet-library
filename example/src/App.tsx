import { useCallback, useMemo, useState, type ReactNode } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import {
  BITCOIN_MAINNET_DERIVATION_PATH,
  ETHEREUM_DERIVATION_PATH,
  canUsePasskey,
  createMobileWallet,
  getPasskey,
  ledgerService,
  registerPasskey,
  type LedgerActionState,
  type LedgerSessionState,
} from "mobile-wallet-library";

const DEFAULT_RP_ID = "example.com";
const DEFAULT_USER_ID = "user-123";
const DEFAULT_USER_NAME = "user@example.com";
const MESSAGE_TO_SIGN = "Sign in to OasisVault";
const BITCOIN_SIGNING_PATH = "m/49'/0'/0'/0/0";

type FlowStatus = "idle" | "running" | "success" | "error";

type FlowLog = {
  label: string;
  value: string;
};

type FlowState = {
  status: FlowStatus;
  message: string;
  logs: FlowLog[];
};

const initialFlowState: FlowState = {
  logs: [],
  message: "Ready",
  status: "idle",
};

const shortValue = (value: string, start = 18, end = 12) => {
  if (value.length <= start + end + 3) {
    return value;
  }

  return `${value.slice(0, start)}...${value.slice(-end)}`;
};

const formatError = (error: unknown) => {
  if (error instanceof Error) {
    return error.message;
  }

  return "Unexpected error";
};

const formatLedgerActionState = (state: LedgerActionState) => {
  const details = [state.step, state.requiredUserInteraction].filter(Boolean);

  return details.length > 0 ? `${state.status}: ${details.join(" / ")}` : state.status;
};

const formatLedgerSessionState = (state: LedgerSessionState) => {
  const deviceName = state.device?.modelId ?? "Ledger";
  const errorMessage = state.error ? ` (${state.error.message})` : "";

  if (state.status === "connected") {
    return `${deviceName} connected`;
  }

  return `${state.status}${errorMessage}`;
};

const makeFlow =
  (
    setState: (state: FlowState | ((current: FlowState) => FlowState)) => void,
    label: string,
    action: () => Promise<FlowLog[]>,
  ) =>
  async () => {
    setState({ logs: [], message: `${label}...`, status: "running" });

    try {
      const logs = await action();

      setState({
        logs,
        message: `${label} complete`,
        status: "success",
      });
    } catch (error) {
      setState({
        logs: [],
        message: formatError(error),
        status: "error",
      });
    }
  };

function Section({ children, title }: { children: ReactNode; title: string }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

function Field({
  label,
  onChangeText,
  placeholder,
  value,
}: {
  label: string;
  onChangeText: (value: string) => void;
  placeholder?: string;
  value: string;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        autoCapitalize="none"
        autoCorrect={false}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor="#7e8794"
        style={styles.input}
        value={value}
      />
    </View>
  );
}

function ActionButton({
  disabled,
  onPress,
  title,
}: {
  disabled?: boolean;
  onPress: () => void;
  title: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        disabled ? styles.buttonDisabled : null,
        pressed ? styles.buttonPressed : null,
      ]}
    >
      <Text style={styles.buttonText}>{title}</Text>
    </Pressable>
  );
}

function FlowOutput({ flow }: { flow: FlowState }) {
  return (
    <View style={styles.output}>
      <View style={styles.outputHeader}>
        <Text style={[styles.statusDot, styles[`status_${flow.status}`]]}>●</Text>
        <Text style={styles.outputMessage}>{flow.message}</Text>
        {flow.status === "running" ? <ActivityIndicator color="#1d4ed8" /> : null}
      </View>
      {flow.logs.map((log) => (
        <View key={log.label} style={styles.logRow}>
          <Text style={styles.logLabel}>{log.label}</Text>
          <Text selectable style={styles.logValue}>
            {log.value}
          </Text>
        </View>
      ))}
    </View>
  );
}

export default function App() {
  const [flow, setFlow] = useState<FlowState>(initialFlowState);
  const [rpId, setRpId] = useState(DEFAULT_RP_ID);
  const [userId, setUserId] = useState(DEFAULT_USER_ID);
  const [userName, setUserName] = useState(DEFAULT_USER_NAME);
  const [passkeyNonce, setPasskeyNonce] = useState("");
  const [bitcoinPsbtHex, setBitcoinPsbtHex] = useState("");
  const [bitcoinPsbtDerivationPaths, setBitcoinPsbtDerivationPaths] = useState("0/0");
  const [ledgerConnected, setLedgerConnected] = useState(false);

  const onLedgerStateChange = useCallback((state: LedgerActionState) => {
    setFlow((current) => ({
      ...current,
      message: formatLedgerActionState(state),
    }));
  }, []);

  const createEthereumWallet = useMemo(
    () =>
      makeFlow(setFlow, "Creating Ethereum mobile wallet", async () => {
        const { wallet, mnemonic, address } = await createMobileWallet({
          chain: "ethereum",
        });
        const nextAddress = await wallet.getAddress({
          derivationPath: "m/44'/60'/0'/0/1",
        });
        const signature = await wallet.signMessage({
          message: MESSAGE_TO_SIGN,
        });

        return [
          { label: "address", value: address },
          { label: "next address", value: nextAddress },
          { label: "derivation path", value: ETHEREUM_DERIVATION_PATH },
          { label: "mnemonic preview", value: shortValue(mnemonic, 28, 18) },
          { label: "message signature", value: signature },
        ];
      }),
    [],
  );

  const createBitcoinWallet = useMemo(
    () =>
      makeFlow(setFlow, "Creating Bitcoin mobile wallet", async () => {
        const { wallet, mnemonic } = await createMobileWallet({
          chain: "bitcoin",
        });
        const accountXpub = await wallet.getExtendedPublicKey({
          derivationPath: BITCOIN_MAINNET_DERIVATION_PATH,
        });
        const signature = await wallet.signMessage({
          derivationPath: BITCOIN_SIGNING_PATH,
          message: MESSAGE_TO_SIGN,
        });

        return [
          { label: "account xpub", value: accountXpub },
          { label: "account path", value: BITCOIN_MAINNET_DERIVATION_PATH },
          { label: "signing path", value: BITCOIN_SIGNING_PATH },
          { label: "mnemonic preview", value: shortValue(mnemonic, 28, 18) },
          { label: "message signature", value: signature },
        ];
      }),
    [],
  );

  const connectLedger = useCallback(async () => {
    let isConnecting = false;

    setLedgerConnected(false);
    setFlow({
      logs: [
        {
          label: "status",
          value: "Scanning. Select and unlock the first Ledger found nearby.",
        },
      ],
      message: "Scanning for Ledger...",
      status: "running",
    });

    try {
      await ledgerService.startDiscovery({
        onDevicesFound: ([device]) => {
          if (!device || isConnecting) {
            return;
          }

          isConnecting = true;

          void (async () => {
            try {
              await ledgerService.stopDiscovery();
              await ledgerService.connect(device);
              setLedgerConnected(true);
              setFlow({
                logs: [
                  {
                    label: "session",
                    value: formatLedgerSessionState(ledgerService.getSessionState()),
                  },
                ],
                message: "Ledger connected",
                status: "success",
              });
            } catch (error) {
              setLedgerConnected(false);
              setFlow({
                logs: [],
                message: formatError(error),
                status: "error",
              });
            }
          })();
        },
        onError: (error) => {
          setLedgerConnected(false);
          setFlow({
            logs: [],
            message: error.message,
            status: "error",
          });
        },
      });
    } catch (error) {
      setLedgerConnected(false);
      setFlow({
        logs: [],
        message: formatError(error),
        status: "error",
      });
    }
  }, []);

  const disconnectLedger = useMemo(
    () =>
      makeFlow(setFlow, "Disconnecting Ledger", async () => {
        await ledgerService.cleanup();
        setLedgerConnected(false);

        return [
          {
            label: "session",
            value: formatLedgerSessionState(ledgerService.getSessionState()),
          },
        ];
      }),
    [],
  );

  const useEthereumLedger = useMemo(
    () =>
      makeFlow(setFlow, "Using Ethereum Ledger app", async () => {
        await ledgerService.openApp("Ethereum", {
          onStateChange: onLedgerStateChange,
        });
        const address = await ledgerService.getEthereumAddress({
          onStateChange: onLedgerStateChange,
        });
        const signature = await ledgerService.signEthereumMessage(MESSAGE_TO_SIGN, {
          onStateChange: onLedgerStateChange,
        });

        return [
          { label: "address", value: address },
          { label: "derivation path", value: ETHEREUM_DERIVATION_PATH },
          { label: "message signature", value: signature },
        ];
      }),
    [onLedgerStateChange],
  );

  const useBitcoinLedger = useMemo(
    () =>
      makeFlow(setFlow, "Using Bitcoin Ledger app", async () => {
        await ledgerService.openApp("Bitcoin", {
          onStateChange: onLedgerStateChange,
        });
        const extendedPublicKey = await ledgerService.getBitcoinExtendedPublicKey({
          onStateChange: onLedgerStateChange,
        });
        const masterFingerprint = await ledgerService.getBitcoinMasterFingerprint({
          onStateChange: onLedgerStateChange,
        });
        const signature = await ledgerService.signBitcoinMessage(
          MESSAGE_TO_SIGN,
          BITCOIN_SIGNING_PATH,
          { onStateChange: onLedgerStateChange },
        );

        return [
          { label: "master fingerprint", value: masterFingerprint },
          { label: "account xpub", value: extendedPublicKey },
          { label: "account path", value: BITCOIN_MAINNET_DERIVATION_PATH },
          { label: "message signature", value: signature },
        ];
      }),
    [onLedgerStateChange],
  );

  const signBitcoinLedgerPsbt = useMemo(
    () =>
      makeFlow(setFlow, "Signing Bitcoin PSBT with Ledger", async () => {
        const psbtHex = bitcoinPsbtHex.trim();

        if (!psbtHex) {
          throw new Error("Paste a PSBT hex string first");
        }

        const derivationPaths = bitcoinPsbtDerivationPaths.trim();

        if (!derivationPaths) {
          throw new Error("Enter one input derivation path per PSBT input");
        }

        await ledgerService.openApp("Bitcoin", {
          onStateChange: onLedgerStateChange,
        });
        const extendedPublicKey = await ledgerService.getBitcoinExtendedPublicKey({
          onStateChange: onLedgerStateChange,
        });
        const masterFingerprint = await ledgerService.getBitcoinMasterFingerprint({
          onStateChange: onLedgerStateChange,
        });
        const signer = {
          baseDerivationPath: BITCOIN_MAINNET_DERIVATION_PATH,
          extendedPublicKey,
          id: "ledger-1",
          masterFingerprint,
          policyHmac: null,
          signerId: "ledger-1",
        };
        const signedPsbtHex = await ledgerService.signBitcoinTransaction(
          {
            signer,
            transaction: {
              derivationPaths,
              psbtHex,
            },
            wallet: {
              label: "Example Wallet",
              policy: "wsh(sortedmulti(1,@0/**))",
              signers: [signer],
            },
          },
          { onStateChange: onLedgerStateChange },
        );

        return [{ label: "signed psbt", value: signedPsbtHex }];
      }),
    [bitcoinPsbtDerivationPaths, bitcoinPsbtHex, onLedgerStateChange],
  );

  const registerPasskeyFlow = useMemo(
    () =>
      makeFlow(setFlow, "Registering passkey", async () => {
        if (!canUsePasskey()) {
          throw new Error("Passkey PRF is not available on this device");
        }

        const registered = await registerPasskey({
          rp: {
            id: rpId,
            name: "OasisVault Example",
          },
          user: {
            displayName: userName,
            id: userId,
            name: userName,
          },
        });

        setPasskeyNonce(registered.nonce);

        return [
          { label: "key", value: registered.key },
          { label: "nonce", value: registered.nonce },
        ];
      }),
    [rpId, userId, userName],
  );

  const getPasskeyFlow = useMemo(
    () =>
      makeFlow(setFlow, "Getting passkey PRF key", async () => {
        if (!canUsePasskey()) {
          throw new Error("Passkey PRF is not available on this device");
        }

        if (!passkeyNonce.trim()) {
          throw new Error("Register a passkey first or paste a stored nonce");
        }

        const restored = await getPasskey({
          nonce: passkeyNonce.trim(),
          rpId,
        });

        return [
          { label: "key", value: restored.key },
          { label: "nonce", value: restored.nonce },
        ];
      }),
    [passkeyNonce, rpId],
  );

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>mobile-wallet-library example</Text>
      <Text style={styles.subtitle}>Run the core mobile wallet, Ledger, and passkey flows.</Text>

      <Section title="Mobile Wallets">
        <View style={styles.buttonGrid}>
          <ActionButton onPress={createEthereumWallet} title="Create ETH wallet" />
          <ActionButton onPress={createBitcoinWallet} title="Create BTC wallet" />
        </View>
      </Section>

      <Section title="Ledger">
        <View style={styles.buttonGrid}>
          <ActionButton onPress={connectLedger} title="Scan and connect" />
          <ActionButton
            disabled={!ledgerConnected}
            onPress={useEthereumLedger}
            title="Use ETH Ledger"
          />
          <ActionButton
            disabled={!ledgerConnected}
            onPress={useBitcoinLedger}
            title="Use BTC Ledger"
          />
          <ActionButton disabled={!ledgerConnected} onPress={disconnectLedger} title="Disconnect" />
        </View>
        <Field
          label="Bitcoin PSBT hex"
          onChangeText={setBitcoinPsbtHex}
          placeholder="70736274..."
          value={bitcoinPsbtHex}
        />
        <Field
          label="PSBT input paths"
          onChangeText={setBitcoinPsbtDerivationPaths}
          placeholder="0/0,0/1"
          value={bitcoinPsbtDerivationPaths}
        />
        <ActionButton
          disabled={!ledgerConnected}
          onPress={signBitcoinLedgerPsbt}
          title="Sign BTC PSBT"
        />
      </Section>

      <Section title="Passkeys">
        <Field label="Relying party id" onChangeText={setRpId} value={rpId} />
        <Field label="User id" onChangeText={setUserId} value={userId} />
        <Field label="User name" onChangeText={setUserName} value={userName} />
        <Field
          label="Stored nonce"
          onChangeText={setPasskeyNonce}
          placeholder="Filled after registerPasskey"
          value={passkeyNonce}
        />
        <View style={styles.buttonGrid}>
          <ActionButton onPress={registerPasskeyFlow} title="Register passkey" />
          <ActionButton onPress={getPasskeyFlow} title="Get passkey" />
        </View>
      </Section>

      <FlowOutput flow={flow} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  button: {
    alignItems: "center",
    backgroundColor: "#1d4ed8",
    borderRadius: 8,
    flexGrow: 1,
    justifyContent: "center",
    minHeight: 44,
    minWidth: 148,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  buttonDisabled: {
    backgroundColor: "#9aa4b2",
  },
  buttonGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  buttonPressed: {
    opacity: 0.78,
  },
  buttonText: {
    color: "#ffffff",
    fontSize: 14,
    fontWeight: "700",
    textAlign: "center",
  },
  container: {
    backgroundColor: "#f4f7fb",
    gap: 14,
    padding: 20,
    paddingBottom: 40,
    paddingTop: 60,
  },
  field: {
    gap: 6,
  },
  fieldLabel: {
    color: "#475569",
    fontSize: 13,
    fontWeight: "700",
  },
  input: {
    backgroundColor: "#ffffff",
    borderColor: "#ccd6e3",
    borderRadius: 8,
    borderWidth: 1,
    color: "#0f172a",
    minHeight: 42,
    paddingHorizontal: 12,
  },
  logLabel: {
    color: "#475569",
    fontSize: 12,
    fontWeight: "700",
    textTransform: "uppercase",
  },
  logRow: {
    gap: 4,
  },
  logValue: {
    color: "#0f172a",
    fontFamily: "Courier",
    fontSize: 12,
    lineHeight: 18,
  },
  output: {
    backgroundColor: "#ffffff",
    borderColor: "#ccd6e3",
    borderRadius: 8,
    borderWidth: 1,
    gap: 12,
    padding: 14,
  },
  outputHeader: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
  },
  outputMessage: {
    color: "#0f172a",
    flex: 1,
    fontSize: 14,
    fontWeight: "700",
  },
  section: {
    backgroundColor: "#ffffff",
    borderColor: "#d7e0ec",
    borderRadius: 8,
    borderWidth: 1,
    gap: 12,
    padding: 14,
  },
  sectionTitle: {
    color: "#0f172a",
    fontSize: 18,
    fontWeight: "800",
  },
  status_error: {
    color: "#dc2626",
  },
  status_idle: {
    color: "#64748b",
  },
  status_running: {
    color: "#1d4ed8",
  },
  status_success: {
    color: "#16a34a",
  },
  statusDot: {
    fontSize: 16,
    lineHeight: 18,
  },
  subtitle: {
    color: "#475569",
    fontSize: 15,
    lineHeight: 21,
  },
  title: {
    color: "#0f172a",
    fontSize: 28,
    fontWeight: "900",
  },
});
