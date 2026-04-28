import * as bip39 from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import { byteArrayToBase64String, generateRandomUint8Array } from "./crypto";

export const generateMnemonic = () => {
  return bip39.generateMnemonic(wordlist, 256);
};

export const validateMnemonic = (mnemonic: string) => {
  return bip39.validateMnemonic(mnemonic, wordlist);
};

/**
 * Generates a random base64 string of a specified length using
 * react-native-quick-crypto.
 */
export const generateNonce = () => {
  const randomArray = generateRandomUint8Array(32);
  return byteArrayToBase64String(randomArray);
};
