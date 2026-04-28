/**
 * Generates a random Uint8Array of a specified length using
 * react-native-quick-crypto.
 */
export const generateRandomUint8Array = (length = 32) => {
  const { randomFillSync } = require(
    "react-native-quick-crypto",
  ) as typeof import("react-native-quick-crypto");
  const array = new Uint8Array(length);
  return randomFillSync(array);
};

/**
 * Converts a Uint8Array byte array to a hexadecimal string
 * representation.
 */
export const byteArrayToHexString = (byteArray: Uint8Array): string => {
  return Array.from(byteArray, (byte) =>
    ("0" + (byte & 0xff).toString(16)).slice(-2),
  ).join("");
};
