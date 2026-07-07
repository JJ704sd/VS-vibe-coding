// Regression coverage for `WFDBParser`.
//
// Before the fix:
//   1. UI called `arrayBufferToBinaryString` → `TextDecoder('ascii')` which
//      silently mangled every byte >= 0x80. The parser then re-derives
//      bytes via `charCodeAt(i) & 0xff` and could not recover the original
//      values. Real MIT-BIH `.dat` files contain many such bytes.
//   2. `parse()` accepted a JS string for `dataFile` and re-implemented
//      `charCodeAt(i) & 0xff`. The chain (UI lossy decode + parser
//      lossy re-decode) compounded the corruption.
//   3. `parse()` ignored every per-signal field in the `.hea` header —
//      `format`, `gain`, `adc_resolution`, `baseline`, `sampling_rate` were
//      either hard-coded or set from the first header line only.
//   4. MIT-BIH `212` (12-bit two's-complement packed) was not implemented,
//      so the most common MIT-BIH record format silently produced garbage.
//
// This file pins the fixed behaviour.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { WFDBParser } from './dicomParser.ts';

/**
 * Encode a sequence of 12-bit two's-complement samples into the
 * MIT-BIH `212` packed format (two samples per 3 bytes, low byte first).
 *
 * `samples` may be any length; the last sample is zero-padded if odd.
 */
function encodeFormat212(samples: number[]): Uint8Array {
  const pairCount = Math.ceil(samples.length / 2);
  const out = new Uint8Array(pairCount * 3);
  for (let i = 0; i < pairCount; i += 1) {
    const s1 = samples[i * 2] ?? 0;
    const s2 = samples[i * 2 + 1] ?? 0;
    // Convert 12-bit two's-complement → unsigned 12-bit.
    const u1 = s1 & 0x0fff;
    const u2 = s2 & 0x0fff;
    out[i * 3 + 0] = u1 & 0xff;
    out[i * 3 + 1] = ((u1 >> 8) & 0x0f) | ((u2 & 0x0f) << 4);
    out[i * 3 + 2] = (u2 >> 4) & 0xff;
  }
  return out;
}

test('parseFormat212 unpacks two 12-bit samples from three bytes', () => {
  // 0x123 and 0x456 are 12-bit values. Bit-packing:
  //   byte0 = 0x23  (low byte of 0x123)
  //   byte1 = 0x01 | (0x06 << 4) = 0x61
  //   byte2 = 0x45  (high byte of 0x456 >> 4 = 0x45)
  const bytes = new Uint8Array([0x23, 0x61, 0x45]);
  const parser = new WFDBParser();
  const out = parser.parseFormat212(bytes, 1, 2);
  assert.ok(out, 'parser should return a valid Int16Array');
  assert.equal(out.length, 2);
  assert.equal(out[0], 0x123, 'sample 1 should be 0x123');
  assert.equal(out[1], 0x456, 'sample 2 should be 0x456');
});

test('parseFormat212 sign-extends negative 12-bit two\'s-complement values', () => {
  // 0x800 as unsigned 12-bit is the most-negative signed value: -2048.
  // 0xFFF is -1. Build a packed stream from the encode helper to keep the
  // expected bytes and the input samples in lock-step.
  const samples = [-2048, -1, 0, 2047];
  const packed = encodeFormat212(samples);
  const parser = new WFDBParser();
  const out = parser.parseFormat212(packed, samples.length, 1);
  assert.ok(out);
  assert.equal(out.length, samples.length);
  assert.deepEqual(Array.from(out), samples);
});

test('parseFormat212 handles an odd number of samples (last pair padded)', () => {
  const samples = [100, 200, 300];
  const packed = encodeFormat212(samples);
  const parser = new WFDBParser();
  const out = parser.parseFormat212(packed, 3, 1);
  assert.ok(out);
  assert.equal(out.length, 3);
  // The fourth slot (padded with 0) must not leak into the output.
  assert.deepEqual(Array.from(out), samples);
});

test('parseFormat16 reads interleaved 16-bit little-endian samples', () => {
  // 2 leads, 3 samples = 6 samples = 12 bytes.
  // Frame-major layout: [lead0_s0, lead1_s0, lead0_s1, lead1_s1, ...]
  const samples = [10, 20, 30, 40, 50, 60];
  const bytes = new Uint8Array(samples.length * 2);
  const view = new DataView(bytes.buffer);
  samples.forEach((value, i) => {
    view.setInt16(i * 2, value, true);
  });
  const parser = new WFDBParser();
  const out = parser.unpackSamples(bytes, 2, 3, 16);
  assert.ok(out);
  assert.deepEqual(Array.from(out), samples);
});

test('parse() preserves high bytes (>= 0x80) end-to-end via Uint8Array', () => {
  // Build a .dat with all 0xFF bytes. Under the old code path
  // (arrayBufferToBinaryString + TextDecoder('ascii')), each 0xFF would
  // be replaced with U+FFFD and the byte could not be recovered. The new
  // code passes the raw Uint8Array straight through.
  //
  // The header uses format=16, gain=1, baseline=0 so each byte pair
  // decodes to -1 (signed 0xFFFF) / 1 = -1 mV.
  const parser = new WFDBParser();
  const header = 'r1 1 100 4\nr1.dat 16 1 16 0 0 0 0 MLII';
  // 1 lead × 4 samples × 2 bytes = 8 bytes, all 0xFF.
  const dat = new Uint8Array(8).fill(0xff);
  const result = parser.parse(header, dat);
  assert.ok(result);
  assert.equal(result.leads.length, 1);
  assert.equal(result.leads[0].data.length, 4);
  // Every sample must be -1 mV (0xFFFF signed / gain 1 = -1, minus
  // baseline 0 = -1 mV).
  for (const sample of result.leads[0].data) {
    assert.equal(sample, -1, 'high-byte sample must survive the round trip');
  }
});

test('parse() reads per-signal format / gain / baseline from .hea', () => {
  // .hea: 1 lead, format=212, gain=200, baseline=1024, 12-bit ADC,
  // sampling_rate=360, 2 samples.
  // Packed: 2 samples → 3 bytes.
  // Build two signed-12-bit values: 1500 (raw - baseline = 476, /gain = 2.38 mV)
  // and -500 (raw = 524, /gain = -2.5 mV).
  const samples = [1500, -500];
  const packed = encodeFormat212(samples);
  const header = 'r2 1 360 2\nr2.dat 212 200 12 1024 0 0 0 MLII';
  const parser = new WFDBParser();
  const result = parser.parse(header, packed);
  assert.ok(result);
  assert.equal(result.leads.length, 1);
  assert.equal(result.leads[0].name, 'MLII', 'lead description comes from .hea tokens[8..]');
  assert.equal(result.samplingRate, 360, 'sampling_rate comes from .hea first line');
  assert.equal(result.leads[0].data.length, 2);
  // (1500 - 1024) / 200 = 2.38
  assert.ok(Math.abs(result.leads[0].data[0] - 2.38) < 1e-6);
  // (-500 - 1024) / 200 = -7.62  (12-bit two's-complement: -500 is 0xE0C)
  assert.ok(Math.abs(result.leads[0].data[1] - (-7.62)) < 1e-6);
});

test('parse() falls back to format 16 + gain 200 + 12-bit when .hea is short', () => {
  // Header has just enough info for numLeads/samplingRate/numSamples,
  // no per-signal line at all.
  const parser = new WFDBParser();
  const header = 'r3 2 250 3';
  // 2 leads × 3 samples = 6 samples × 2 bytes = 12 bytes.
  // Pick values: 0, 200, 400, 600, 800, 1000.
  // 200 ADU / gain 200 = 1 mV; 400 = 2 mV; etc.
  const samples = [0, 200, 400, 600, 800, 1000];
  const dat = new Uint8Array(samples.length * 2);
  const view = new DataView(dat.buffer);
  samples.forEach((value, i) => {
    view.setInt16(i * 2, value, true);
  });
  const result = parser.parse(header, dat);
  assert.ok(result);
  assert.equal(result.leads.length, 2);
  assert.equal(result.samplingRate, 250);
  // First lead, first sample = 0 / 200 = 0 mV
  assert.equal(result.leads[0].data[0], 0);
  // First lead, second sample = 400 / 200 = 2 mV
  assert.equal(result.leads[0].data[1], 2);
});
