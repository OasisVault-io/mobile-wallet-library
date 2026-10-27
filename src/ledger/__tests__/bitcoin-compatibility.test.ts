import "reflect-metadata";
import { DefaultKeySerializer } from "@ledgerhq/device-signer-kit-bitcoin/internal/psbt/service/key/DefaultKeySerializer.js";
import { DefaultKeyPairSerializer } from "@ledgerhq/device-signer-kit-bitcoin/internal/psbt/service/key-pair/DefaultKeyPairSerializer.js";
import { DefaultPsbtMapper } from "@ledgerhq/device-signer-kit-bitcoin/internal/psbt/service/psbt/DefaultPsbtMapper.js";
import { DefaultPsbtSerializer } from "@ledgerhq/device-signer-kit-bitcoin/internal/psbt/service/psbt/DefaultPsbtSerializer.js";
import { DefaultPsbtV2Normalizer } from "@ledgerhq/device-signer-kit-bitcoin/internal/psbt/service/psbt/DefaultPsbtV2Normalizer.js";
import { DefaultValueFactory } from "@ledgerhq/device-signer-kit-bitcoin/internal/psbt/service/value/DefaultValueFactory.js";
import { DefaultValueParser } from "@ledgerhq/device-signer-kit-bitcoin/internal/psbt/service/value/DefaultValueParser.js";
import {
  PsbtGlobal,
  PsbtIn,
  PsbtOut,
} from "@ledgerhq/device-signer-kit-bitcoin/internal/psbt/model/Psbt.js";
import { Psbt as LedgerPeerPsbt } from "bitcoinjs-lib";
import * as bitcoin from "bitcoinjs-lib-v7";
import { describe, expect, it } from "vitest";

// Exercise the real SDK's PSBT mapping path; the client tests mock device actions.
const parser = new DefaultValueParser();
const serializer = new DefaultPsbtSerializer(
  parser,
  new DefaultKeyPairSerializer(new DefaultKeySerializer()),
);
const mapper = new DefaultPsbtMapper(
  serializer,
  new DefaultPsbtV2Normalizer(parser, new DefaultValueFactory()),
);

const createPsbt = () => {
  const script = bitcoin.payments.p2wpkh({ hash: new Uint8Array(20).fill(1) }).output!;
  return new bitcoin.Psbt()
    .addInput({
      hash: new Uint8Array(32).fill(2),
      index: 0,
      witnessUtxo: { script, value: 100000n },
    })
    .addOutput({ script, value: 90000n });
};

describe("Bitcoin v7 and Ledger v6 PSBT interoperability", () => {
  it("roundtrips the serialized PSBT through Ledger's compatible bitcoinjs peer", () => {
    const psbt = createPsbt();
    const ledgerPsbt = LedgerPeerPsbt.fromBase64(psbt.toBase64());

    expect(ledgerPsbt.data.inputs[0]?.witnessUtxo?.value).toBe(100000);
    expect(ledgerPsbt.txOutputs[0]?.value).toBe(90000);
    expect(bitcoin.Psbt.fromBase64(ledgerPsbt.toBase64()).toHex()).toBe(psbt.toHex());
  });

  it("maps the v7 base64 PSBT through the real Ledger SDK into PSBT v2", () => {
    const result = mapper.map(createPsbt().toBase64());
    expect(result.isRight()).toBe(true);
    const mapped = result.unsafeCoerce();

    expect(mapped.inputMaps).toHaveLength(1);
    expect(mapped.outputMaps).toHaveLength(1);
    expect(mapped.getGlobalValue(PsbtGlobal.VERSION).isJust()).toBe(true);
    expect(mapped.getInputValue(0, PsbtIn.WITNESS_UTXO).isJust()).toBe(true);
    const amount = mapped.getOutputValue(0, PsbtOut.AMOUNT).unsafeCoerce();
    expect(parser.getInt64LE(amount.data).unsafeCoerce()).toBe(90000n);
  });

  it("rejects truncated PSBTs in the Ledger SDK parser", () => {
    const truncated = createPsbt().toBuffer().slice(0, 10);
    expect(mapper.map(truncated).isLeft()).toBe(true);
  });

  it("also rejects missing UTXO fee data in Ledger's patched v6 peer", () => {
    const psbt = new bitcoin.Psbt()
      .addInput({
        hash: new Uint8Array(32).fill(6),
        index: 0,
        finalScriptWitness: Uint8Array.of(0),
      })
      .addOutput({ script: Uint8Array.of(bitcoin.opcodes.OP_RETURN), value: 0n });
    const ledgerPsbt = LedgerPeerPsbt.fromBase64(psbt.toBase64());
    expect(() => ledgerPsbt.getFee()).toThrow("Need a Utxo input item for input #0");
  });
});
