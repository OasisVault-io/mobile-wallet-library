import * as bip39 from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";

export const generateMnemonic = () => {
  return bip39.generateMnemonic(wordlist, 256);
};

export const validateMnemonic = (mnemonic: string) => {
  return bip39.validateMnemonic(mnemonic, wordlist);
};
