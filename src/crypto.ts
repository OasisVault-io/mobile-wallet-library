import { randomFillSync } from "react-native-quick-crypto";

/**
 * Generates a random Uint8Array of a specified length using
 * react-native-quick-crypto.
 */
export const generateRandomUint8Array = (length = 32) => {
  const array = new Uint8Array(length);
  return randomFillSync(array);
};
