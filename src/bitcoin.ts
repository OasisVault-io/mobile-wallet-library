import * as varuint from "varuint-bitcoin";
import { Buffer, type WithImplicitCoercion } from "buffer";
import { createHash } from "react-native-quick-crypto";
import * as secp256k1 from "secp256k1";

interface SignatureOptions {
  segwitType?: "p2wpkh" | "p2sh(p2wpkh)" | "string";
  extraEntropy?: Buffer;
}

function isSigner(obj: unknown): obj is Signer {
  return (
    typeof obj === "object" &&
    obj !== null &&
    "sign" in obj &&
    typeof (obj as Signer).sign === "function"
  );
}

interface Signer {
  sign(
    hash: Uint8Array<ArrayBufferLike>,
    extraEntropy?: Buffer,
  ): { signature: Buffer; recovery: number };
}

/** Signs a Bitcoin message and returns a compact recoverable signature buffer. */
export const signMessage = async (
  message: string | Buffer,
  privateKey: Buffer | Signer | Uint8Array,
  compressed?: boolean,
  messagePrefix?: string,
  sigOptions?: SignatureOptions,
) => {
  const { messagePrefixArg, segwitType, extraEntropy } = prepareSign(messagePrefix, sigOptions);

  const hash = await magicHash(message, messagePrefixArg);
  const sigObj = isSigner(privateKey)
    ? privateKey.sign(hash, extraEntropy)
    : secp256k1.ecdsaSign(
        hash,
        Buffer.isBuffer(privateKey) ? privateKey : Buffer.from(privateKey),
        { data: extraEntropy },
      );

  const recovery = "recovery" in sigObj ? sigObj.recovery : sigObj.recid;

  return encodeSignature(sigObj.signature, recovery, compressed, segwitType);
};

const SEGWIT_TYPES = {
  P2WPKH: "p2wpkh",
  P2SH_P2WPKH: "p2sh(p2wpkh)",
};

function prepareSign(
  messagePrefixArg: string | SignatureOptions | undefined,
  sigOptions: SignatureOptions | undefined,
): {
  messagePrefixArg: string | undefined;
  segwitType: SignatureOptions["segwitType"] | undefined;
  extraEntropy: Buffer | undefined;
} {
  if (typeof messagePrefixArg === "object" && sigOptions === undefined) {
    sigOptions = messagePrefixArg;
    messagePrefixArg = undefined;
  }
  const { extraEntropy } = sigOptions || {};
  const segwitType = sigOptions?.segwitType?.toLowerCase() as
    | SignatureOptions["segwitType"]
    | undefined;
  if (segwitType && segwitType !== SEGWIT_TYPES.P2SH_P2WPKH && segwitType !== SEGWIT_TYPES.P2WPKH) {
    throw new Error(
      'Unrecognized segwitType: use "' +
        SEGWIT_TYPES.P2SH_P2WPKH +
        '" or "' +
        SEGWIT_TYPES.P2WPKH +
        '"',
    );
  }

  return {
    messagePrefixArg: typeof messagePrefixArg === "string" ? messagePrefixArg : undefined,
    segwitType,
    extraEntropy,
  };
}

async function hash256(buffer: Uint8Array) {
  const firstHash = createHash("sha256").update(buffer).digest();
  return createHash("sha256").update(firstHash).digest("hex");
}

/** Computes the double-SHA256 Bitcoin Signed Message hash for a message. */
export async function magicHash(
  message:
    | Buffer<ArrayBufferLike>
    | WithImplicitCoercion<string>
    | { [Symbol.toPrimitive](hint: "string"): string },
  messagePrefix:
    | WithImplicitCoercion<string>
    | { [Symbol.toPrimitive](hint: "string"): string }
    | Buffer<ArrayBuffer>
    | undefined,
) {
  messagePrefix = messagePrefix || "\u0018Bitcoin Signed Message:\n";
  if (!Buffer.isBuffer(messagePrefix)) {
    messagePrefix = Buffer.from(messagePrefix, "utf8");
  }
  if (!Buffer.isBuffer(message)) {
    message = Buffer.from(message, "utf8");
  }

  const messageVISize = varuint.encodingLength(message.length);
  const buffer = Buffer.allocUnsafe(messagePrefix.length + messageVISize + message.length);

  messagePrefix.copy(buffer, 0);
  varuint.encode(message.length, buffer, messagePrefix.length);
  message.copy(buffer, messagePrefix.length + messageVISize);
  const res = await hash256(buffer);
  return Buffer.from(res, "hex");
}

function encodeSignature(
  signature: Buffer<ArrayBufferLike> | Uint8Array<ArrayBufferLike>,
  recovery: number,
  compressed: boolean | undefined,
  segwitType: string | undefined,
) {
  if (segwitType !== undefined) {
    recovery += 8;
    if (segwitType === SEGWIT_TYPES.P2WPKH) recovery += 4;
  } else {
    if (compressed) recovery += 4;
  }
  return Buffer.concat([Buffer.alloc(1, recovery + 27), signature]);
}
