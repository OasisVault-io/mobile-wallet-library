import { Passkey } from "react-native-passkey";
import type {
  PasskeyCreateRequest,
  PasskeyGetRequest,
} from "react-native-passkey";
import { Platform } from "react-native";
import { fromByteArray, toByteArray } from "react-native-quick-base64";
import { generateRandomUint8Array } from "./crypto";

const isIOS = Platform.OS === "ios";
const isAndroid = Platform.OS === "android";
type PrfResultValue =
  | string
  | Uint8Array
  | ArrayLike<number>
  | Record<string, number>
  | null
  | undefined;

// PRF on passkeys are only supported on iOS 18 and higher
const isIOS18OrHigher = () => {
  const iosVersion = Number.parseFloat(String(Platform.Version));
  return iosVersion >= 18;
};

const isAndroid14OrHigher = () => {
  const androidVersion =
    typeof Platform.Version === "number"
      ? Platform.Version
      : Number.parseFloat(Platform.Version);
  return androidVersion >= 14;
};

export const canUsePasskey = () => {
  if (!Passkey.isSupported()) {
    return false;
  }

  if (isIOS && isIOS18OrHigher()) {
    return true;
  }

  if (isAndroid && isAndroid14OrHigher()) {
    return true;
  }

  return false;
};

const generateChallenge = (length = 32) => {
  const array = generateRandomUint8Array(length);
  return fromByteArray(array)
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
};

const normalizePrfResult = (value: PrfResultValue): string => {
  if (!value) {
    throw new Error("no_passkey_key");
  }

  if (typeof value === "string") {
    return value;
  }

  if (value instanceof Uint8Array) {
    return fromByteArray(value);
  }

  const bytes = Array.isArray(value)
    ? Uint8Array.from(value)
    : Uint8Array.from(
        Object.entries(value)
          .filter(([index]) => Number.isInteger(Number(index)))
          .sort(([a], [b]) => Number(a) - Number(b))
          .map(([, byte]) => byte),
      );

  if (bytes.length === 0) {
    throw new Error("no_passkey_key");
  }

  return fromByteArray(bytes);
};

export const registerPasskey = async ({
  rp,
  user,
  timeout = 60000,
  retries = 3,
}: {
  rp: {
    id: string;
    name: string;
  };
  user: {
    displayName: string;
    id: string;
    name: string;
  };
  timeout?: number;
  retries?: number;
}) => {
  let retry = 0;
  while (retry < retries) {
    try {
      const nonce = generateRandomUint8Array(32);
      const registrationOptions: PasskeyCreateRequest = {
        attestation: "none",
        authenticatorSelection: {
          requireResidentKey: true,
          residentKey: "required",
          userVerification: "required",
        },
        challenge: generateChallenge(),
        excludeCredentials: [],
        extensions: {
          prf: {
            eval: {
              first: nonce,
            },
          },
        },
        pubKeyCredParams: [
          { alg: -7, type: "public-key" },
          { alg: -257, type: "public-key" },
        ],
        rp,
        timeout,
        user,
      };

      let response = await Passkey.create(registrationOptions);
      response = typeof response === "string" ? JSON.parse(response) : response;

      const nonceString = fromByteArray(nonce);

      const key = normalizePrfResult(
        response.clientExtensionResults?.prf?.results?.first,
      );

      return { key, nonce: nonceString };
    } catch (error: any) {
      const errorMessage = error?.error ?? error.message ?? "";
      // Retry if the error is NoCredentials or NotSupported
      // This is a workaround for the fact that some devices don't support passkeys
      // and we need to retry the request
      const cantGetPasskey =
        errorMessage === "NoCredentials" || errorMessage === "Native error";
      if (retry < retries - 1 && cantGetPasskey) {
        retry++;
        await new Promise<void>((resolve) => setTimeout(() => resolve(), 1000)); // Wait 1 second before retrying

        continue;
      }

      throw error;
    }
  }

  throw new Error("passkey_retries_exhausted");
};

export const getPasskey = async ({
  nonce,
  retries = 3,
  rpId,
  timeout = 60000,
}: {
  nonce?: string | null;
  retries?: number;
  rpId: string;
  timeout?: number;
}) => {
  const requestNonce = nonce ?? fromByteArray(generateRandomUint8Array(32));

  let retry = 0;
  while (retry < retries) {
    try {
      const options: PasskeyGetRequest = {
        allowCredentials: [],
        challenge: generateChallenge(),
        rpId,
        timeout,
        userVerification: "required",
        extensions: {
          prf: {
            eval: {
              first: toByteArray(requestNonce),
            },
          },
        },
      };
      let response = await Passkey.get(options);
      if (typeof response === "string") {
        response = JSON.parse(response);
      }
      const key = normalizePrfResult(
        response.clientExtensionResults?.prf?.results?.first,
      );

      return { key, nonce: requestNonce };
    } catch (error: any) {
      const errorMessage = error?.error ?? error.message ?? "";

      // Retry if the error is NoCredentials or NotSupported
      // This is a workaround for the fact that some devices don't support passkeys
      // and we need to retry the request
      const cantGetPasskey =
        errorMessage === "NoCredentials" || errorMessage === "Native error";
      if (retry < retries - 1 && cantGetPasskey) {
        retry++;
        await new Promise<void>((resolve) => setTimeout(() => resolve(), 1000)); // Wait 1 second before retrying
        continue;
      }

      throw error;
    }
  }

  throw new Error("passkey_retries_exhausted");
};
