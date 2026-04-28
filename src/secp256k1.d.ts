declare module "secp256k1" {
  export function ecdsaSign(
    message: Uint8Array,
    privateKey: Uint8Array,
    options?: { data?: Uint8Array },
  ): { signature: Uint8Array; recid: number };
}
