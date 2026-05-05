import {
  type DeviceActionIntermediateValue,
  type DeviceManagementKit,
  type DeviceSessionId,
  type ExecuteDeviceActionReturnType,
} from "@ledgerhq/device-management-kit";
import { SignerEthBuilder } from "@ledgerhq/device-signer-kit-ethereum";
import { ethers } from "ethers";
import { ETHEREUM_DERIVATION_PATH } from "../constants";
import type { LedgerActionOptions } from "./ledger";

type LedgerEthereumSignature = {
  r: string;
  s: string;
  v: number;
};

type WaitForLedgerAction = <
  Output,
  Error = unknown,
  IntermediateValue extends DeviceActionIntermediateValue = DeviceActionIntermediateValue,
>(
  action: ExecuteDeviceActionReturnType<Output, Error, IntermediateValue>,
  options?: LedgerActionOptions,
) => Promise<Output>;

type LedgerEthereumClientOptions = {
  getDmk: () => DeviceManagementKit;
  getSessionId: () => DeviceSessionId;
  normalizeDerivationPath: (derivationPath: string) => string;
  waitForLedgerAction: WaitForLedgerAction;
};

/** Creates the Ledger Ethereum client used by the public Ledger service. */
export const createLedgerEthereumClient = ({
  getDmk,
  getSessionId,
  normalizeDerivationPath,
  waitForLedgerAction,
}: LedgerEthereumClientOptions) => {
  const createSigner = (originToken?: string) =>
    new SignerEthBuilder({
      dmk: getDmk(),
      sessionId: getSessionId(),
      originToken,
    }).build();

  const serializeSignature = (signature: LedgerEthereumSignature) => {
    return ethers.Signature.from(signature).serialized;
  };

  return {
    getAddress: async (options: LedgerActionOptions = {}) => {
      const signer = createSigner();
      const { address } = await waitForLedgerAction<{
        address: string;
        publicKey: string;
        chainCode?: string;
      }>(signer.getAddress(normalizeDerivationPath(ETHEREUM_DERIVATION_PATH)), options);

      return address;
    },

    signMessage: async (message: string | Uint8Array, options: LedgerActionOptions = {}) => {
      const signer = createSigner();
      const signature = await waitForLedgerAction<LedgerEthereumSignature>(
        signer.signMessage(normalizeDerivationPath(ETHEREUM_DERIVATION_PATH), message),
        options,
      );

      return serializeSignature(signature);
    },

    signTransaction: async (
      transaction: string | Uint8Array,
      options: LedgerActionOptions = {},
    ) => {
      const signer = createSigner();
      const transactionBytes =
        typeof transaction === "string" ? ethers.getBytes(transaction) : transaction;
      const signature = await waitForLedgerAction<LedgerEthereumSignature>(
        signer.signTransaction(normalizeDerivationPath(ETHEREUM_DERIVATION_PATH), transactionBytes),
        options,
      );

      return serializeSignature(signature);
    },
  };
};
