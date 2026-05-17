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

/** Relying-party information used when registering a passkey. */
export type PasskeyRelyingParty = {
  /** Domain identifier for the relying party, for example `example.com`. */
  id: string;
  /** Human-readable relying-party name shown by the passkey UI. */
  name: string;
};

/** User information used when registering a resident passkey. */
export type PasskeyUser = {
  /** Human-readable display name. */
  displayName: string;
  /** Stable app user identifier. */
  id: string;
  /** User name shown by the passkey UI. */
  name: string;
};

/** Options for registering a passkey and evaluating its PRF extension. */
export type RegisterPasskeyOptions = {
  /** Relying-party metadata. */
  rp: PasskeyRelyingParty;
  /** User metadata. */
  user: PasskeyUser;
  /** Nonce used as PRF input. Store it to retrieve the same key later. */
  nonce?: Uint8Array<ArrayBuffer>;
  /** Native passkey request timeout in milliseconds. Defaults to 60000. */
  timeout?: number;
};

/** Options for retrieving a passkey PRF key. */
export type GetPasskeyOptions = {
  /** Nonce returned by `registerPasskey`; required to derive the same PRF key. */
  nonce: string;
  /** Relying-party domain identifier. */
  rpId: string;
  /** Native passkey request timeout in milliseconds. Defaults to 60000. */
  timeout?: number;
};

/** Base64 PRF key and nonce returned by passkey helpers. */
export type PasskeyPrfResult = {
  /** Base64-encoded PRF output. */
  key: string;
  /** Base64 nonce used as PRF input. Store it to retrieve the same key later. */
  nonce: string;
};

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

/** Returns true when the current device can use passkey PRF operations. */
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

/**
 * Registers a resident passkey and evaluates the PRF extension.
 *
 * The returned `key` is a base64 PRF result. Store the returned `nonce` with
 * your app metadata if you need to retrieve the same PRF key later.
 */
export const registerPasskey = async ({
  rp,
  user,
  nonce,
  timeout = 60000,
}: RegisterPasskeyOptions): Promise<PasskeyPrfResult> => {
  nonce = nonce ?? generateRandomUint8Array(32);
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
};

/**
 * Retrieves a passkey PRF key using a previously stored nonce.
 *
 * This does not decrypt or store wallet data. Apps decide how to use the
 * returned base64 `key`.
 */
export const getPasskey = async ({
  nonce,
  rpId,
  timeout = 60000,
}: GetPasskeyOptions): Promise<PasskeyPrfResult> => {
  const options: PasskeyGetRequest = {
    allowCredentials: [],
    challenge: generateChallenge(),
    rpId,
    timeout,
    userVerification: "required",
    extensions: {
      prf: {
        eval: {
          first: toByteArray(nonce),
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

  return { key, nonce };
};
