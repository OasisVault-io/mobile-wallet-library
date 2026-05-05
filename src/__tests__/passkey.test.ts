import { Buffer } from "buffer";
import { afterEach, describe, expect, it, vi } from "vitest";

type PlatformOptions = {
  os: "android" | "ios";
  supported?: boolean;
  version: number | string;
};

const fromByteArray = (byteArray: Uint8Array) => Buffer.from(byteArray).toString("base64");
const toByteArray = (value: string) => Uint8Array.from(Buffer.from(value, "base64"));

const importPasskey = async ({ os, supported = true, version }: PlatformOptions) => {
  vi.resetModules();

  const passkeyMock = {
    create: vi.fn(),
    get: vi.fn(),
    isSupported: vi.fn(() => supported),
  };
  const generatedArrays = [
    Uint8Array.from(Array.from({ length: 32 }, (_, index) => index + 1)),
    Uint8Array.from(Array.from({ length: 32 }, (_, index) => index + 33)),
  ];
  const cryptoMock = {
    generateRandomUint8Array: vi.fn(() => generatedArrays.shift() ?? new Uint8Array(32).fill(9)),
  };

  vi.doMock("react-native", () => ({
    Platform: {
      OS: os,
      Version: version,
    },
  }));
  vi.doMock("react-native-passkey", () => ({
    Passkey: passkeyMock,
  }));
  vi.doMock("react-native-quick-base64", () => ({
    fromByteArray,
    toByteArray,
  }));
  vi.doMock("../crypto", () => cryptoMock);

  const module = await import("../passkey");

  return {
    cryptoMock,
    module,
    passkeyMock,
  };
};

describe("passkey helpers", () => {
  afterEach(() => {
    vi.resetModules();
    vi.doUnmock("react-native");
    vi.doUnmock("react-native-passkey");
    vi.doUnmock("react-native-quick-base64");
    vi.doUnmock("../crypto");
  });

  it("returns false when native passkeys are not supported", async () => {
    const { module } = await importPasskey({
      os: "ios",
      supported: false,
      version: 18,
    });

    expect(module.canUsePasskey()).toBe(false);
  });

  it("requires iOS 18 or higher for passkey PRF support", async () => {
    const ios17 = await importPasskey({
      os: "ios",
      version: "17.5",
    });
    expect(ios17.module.canUsePasskey()).toBe(false);

    const ios18 = await importPasskey({
      os: "ios",
      version: "18.0",
    });
    expect(ios18.module.canUsePasskey()).toBe(true);
  });

  it("requires Android 14 or higher for passkey PRF support", async () => {
    const android13 = await importPasskey({
      os: "android",
      version: 13,
    });
    expect(android13.module.canUsePasskey()).toBe(false);

    const android14 = await importPasskey({
      os: "android",
      version: 14,
    });
    expect(android14.module.canUsePasskey()).toBe(true);
  });

  it("registers a passkey with a resident-key PRF request", async () => {
    const { cryptoMock, module, passkeyMock } = await importPasskey({
      os: "ios",
      version: 18,
    });
    const prfKey = Uint8Array.from([10, 11, 12, 13]);
    passkeyMock.create.mockResolvedValue({
      clientExtensionResults: {
        prf: {
          results: {
            first: prfKey,
          },
        },
      },
    });

    await expect(
      module.registerPasskey({
        rp: {
          id: "example.com",
          name: "Example",
        },
        timeout: 1234,
        user: {
          displayName: "Alice Example",
          id: "alice-id",
          name: "alice",
        },
      }),
    ).resolves.toEqual({
      key: fromByteArray(prfKey),
      nonce: fromByteArray(Uint8Array.from(Array.from({ length: 32 }, (_, index) => index + 1))),
    });

    const request = passkeyMock.create.mock.calls[0]?.[0];
    expect(request).toMatchObject({
      attestation: "none",
      authenticatorSelection: {
        requireResidentKey: true,
        residentKey: "required",
        userVerification: "required",
      },
      challenge: fromByteArray(
        Uint8Array.from(Array.from({ length: 32 }, (_, index) => index + 33)),
      )
        .replace(/=/g, "")
        .replace(/\+/g, "-")
        .replace(/\//g, "_"),
      excludeCredentials: [],
      pubKeyCredParams: [
        { alg: -7, type: "public-key" },
        { alg: -257, type: "public-key" },
      ],
      timeout: 1234,
    });
    expect(request.extensions.prf.eval.first).toEqual(
      Uint8Array.from(Array.from({ length: 32 }, (_, index) => index + 1)),
    );
    expect(cryptoMock.generateRandomUint8Array).toHaveBeenCalledTimes(2);
  });

  it("parses string register responses and keeps string PRF keys", async () => {
    const { module, passkeyMock } = await importPasskey({
      os: "ios",
      version: 18,
    });
    passkeyMock.create.mockResolvedValue(
      JSON.stringify({
        clientExtensionResults: {
          prf: {
            results: {
              first: "already-base64",
            },
          },
        },
      }),
    );

    await expect(
      module.registerPasskey({
        rp: {
          id: "example.com",
          name: "Example",
        },
        user: {
          displayName: "Alice Example",
          id: "alice-id",
          name: "alice",
        },
      }),
    ).resolves.toMatchObject({
      key: "already-base64",
    });
  });

  it("gets a passkey PRF key with the stored nonce", async () => {
    const { module, passkeyMock } = await importPasskey({
      os: "android",
      version: 14,
    });
    const nonce = fromByteArray(Uint8Array.from([1, 2, 3, 4]));
    passkeyMock.get.mockResolvedValue(
      JSON.stringify({
        clientExtensionResults: {
          prf: {
            results: {
              first: {
                1: 8,
                0: 7,
                2: 9,
              },
            },
          },
        },
      }),
    );

    await expect(
      module.getPasskey({
        nonce,
        rpId: "example.com",
        timeout: 4321,
      }),
    ).resolves.toEqual({
      key: fromByteArray(Uint8Array.from([7, 8, 9])),
      nonce,
    });

    const request = passkeyMock.get.mock.calls[0]?.[0];
    expect(request).toMatchObject({
      allowCredentials: [],
      rpId: "example.com",
      timeout: 4321,
      userVerification: "required",
    });
    expect(request.extensions.prf.eval.first).toEqual(toByteArray(nonce));
  });

  it("throws when no PRF key is returned", async () => {
    const { module, passkeyMock } = await importPasskey({
      os: "ios",
      version: 18,
    });
    passkeyMock.get.mockResolvedValue({
      clientExtensionResults: {
        prf: {
          results: {},
        },
      },
    });

    await expect(
      module.getPasskey({
        nonce: fromByteArray(Uint8Array.from([1, 2, 3, 4])),
        rpId: "example.com",
      }),
    ).rejects.toThrow("no_passkey_key");
  });
});
