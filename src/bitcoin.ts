import * as varuint from "varuint-bitcoin";
import { type WithImplicitCoercion } from "buffer";
import { sha256Bytes } from "react-native-sha256";
import * as secp256k1 from "secp256k1";

interface SignatureOptions {
  segwitType?: "p2wpkh" | "p2sh(p2wpkh)" | "string";
  extraEntropy?: Buffer;
}

function isSigner(obj: any) {
  return obj && typeof obj.sign === "function";
}

interface Signer {
  sign(
    hash: Uint8Array<ArrayBufferLike>,
    extraEntropy?: Buffer,
  ): { signature: Buffer; recovery: number };
}

export const signMessage = async (
  message: string | Buffer,
  privateKey: Buffer | Signer | Uint8Array,
  compressed?: boolean,
  messagePrefix?: string,
  sigOptions?: SignatureOptions,
) => {
  const { messagePrefixArg, segwitType, extraEntropy } = prepareSign(
    messagePrefix,
    sigOptions,
  );

  const hash = await magicHash(message, messagePrefixArg);
  const privateKeyBuffer = Buffer.isBuffer(privateKey)
    ? privateKey
    : // @ts-ignore
      Buffer.from(privateKey);
  const sigObj = isSigner(privateKeyBuffer)
    ? // @ts-ignore
      privateKeyBuffer.sign(hash, extraEntropy)
    : secp256k1.ecdsaSign(hash, privateKeyBuffer, { data: extraEntropy });

  return encodeSignature(
    sigObj.signature,
    sigObj.recovery ?? sigObj.recid,
    compressed,
    segwitType,
  );
};

const SEGWIT_TYPES = {
  P2WPKH: "p2wpkh",
  P2SH_P2WPKH: "p2sh(p2wpkh)",
};

function prepareSign(
  messagePrefixArg: string | undefined,
  sigOptions: SignatureOptions | undefined,
) {
  if (typeof messagePrefixArg === "object" && sigOptions === undefined) {
    sigOptions = messagePrefixArg;
    messagePrefixArg = undefined;
  }
  let { segwitType, extraEntropy } = sigOptions || {};
  if (
    segwitType &&
    //@ts-ignore
    (typeof segwitType === "string" || segwitType instanceof String)
  ) {
    //@ts-ignore
    segwitType = segwitType.toLowerCase();
  }
  if (
    segwitType &&
    segwitType !== SEGWIT_TYPES.P2SH_P2WPKH &&
    segwitType !== SEGWIT_TYPES.P2WPKH
  ) {
    throw new Error(
      'Unrecognized segwitType: use "' +
        SEGWIT_TYPES.P2SH_P2WPKH +
        '" or "' +
        SEGWIT_TYPES.P2WPKH +
        '"',
    );
  }

  return {
    messagePrefixArg,
    segwitType,
    extraEntropy,
  };
}

async function hash256(buffer: Iterable<unknown> | ArrayLike<unknown>) {
  const res = await sha256Bytes(Array.from(buffer));
  return await sha256Bytes(Array.from(Buffer.from(res, "hex")));
}

export async function magicHash(
  message: //@ts-ignore - Buffer type is not up to date
    | Buffer<ArrayBufferLike>
    | WithImplicitCoercion<string>
    | { [Symbol.toPrimitive](hint: "string"): string },
  messagePrefix:
    | WithImplicitCoercion<string>
    | { [Symbol.toPrimitive](hint: "string"): string }
    //@ts-ignore - Buffer type is not up to date
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
  const buffer = Buffer.allocUnsafe(
    messagePrefix.length + messageVISize + message.length,
  );

  messagePrefix.copy(buffer, 0);
  varuint.encode(message.length, buffer, messagePrefix.length);
  message.copy(buffer, messagePrefix.length + messageVISize);
  const res = await hash256(buffer);
  return Buffer.from(res, "hex");
}

function encodeSignature(
  //@ts-ignore
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
