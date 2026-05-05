import * as bip39 from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import { byteArrayToBase64String, generateRandomUint8Array } from "./crypto";

/** Generates a 24-word BIP-39 English mnemonic. */
export const generateMnemonic = () => {
  return bip39.generateMnemonic(wordlist, 256);
};

/** Returns true when `mnemonic` is a valid BIP-39 English mnemonic. */
export const validateMnemonic = (mnemonic: string) => {
  return bip39.validateMnemonic(mnemonic, wordlist);
};

/**
 * Generates a random base64 string using react-native-quick-crypto.
 *
 * @param length Number of random bytes before base64 encoding. Defaults to 32.
 */
export const generateNonce = (length: number = 32) => {
  const randomArray = generateRandomUint8Array(length);
  return byteArrayToBase64String(randomArray);
};
