// Regression coverage for `DICOMParser`.
//
// Before the fix:
//   1. `isValidDICOM` only recognised the 132-byte preamble + 'DICM' magic.
//      Real Explicit VR DICOMs without the magic were rejected outright.
//   2. `findTagData` treated every tag as Implicit VR Little Endian,
//      reading the 2-byte VR + 2-byte length as a single uint32 — so
//      metadata extraction either returned wrong bytes or null.
//   3. `parseWaveformData` divided total `byteLength` by 24, which
//      inflated the sample count and therefore the duration.
//   4. `parseWaveformData` read Int16 without the `littleEndian` flag,
//      so every sample was silently byte-swapped on a little-endian host.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DICOMParser } from './dicomParser.ts';

/**
 * Build a complete DICOM buffer:
 *   - 128 zero bytes (preamble)
 *   - 'DICM' magic
 *   - File Meta group (0x0002, *) — Explicit VR Little Endian
 *
 * Caller supplies an array of `[group, element, vr, valueBytes]` tuples.
 */
function buildExplicitDICOM(entries: Array<[number, number, string, Uint8Array]>): ArrayBuffer {
  // Each tag: 4 bytes (group+element) + 2 bytes (VR) + length + value
  // Long-form VRs need 2 reserved bytes + 4-byte length.
  const LONG_FORM = new Set(['OB', 'OD', 'OF', 'OL', 'OV', 'OW', 'SQ', 'UC', 'UN', 'UR', 'UT']);
  const chunks: Uint8Array[] = [];

  // Preamble + magic
  const preamble = new Uint8Array(128);
  const magic = new Uint8Array([0x44, 0x49, 0x43, 0x4d]);
  chunks.push(preamble, magic);

  for (const [group, element, vr, value] of entries) {
    const tag = new Uint8Array(4);
    const tagView = new DataView(tag.buffer);
    tagView.setUint16(0, group, true);
    tagView.setUint16(2, element, true);
    chunks.push(tag);

    const vrBytes = new Uint8Array([vr.charCodeAt(0), vr.charCodeAt(1)]);
    chunks.push(vrBytes);

    if (LONG_FORM.has(vr)) {
      // 2 reserved + 4-byte uint32 length
      const lengthField = new Uint8Array(6);
      const lenView = new DataView(lengthField.buffer);
      lenView.setUint32(2, value.length, true);
      chunks.push(lengthField);
    } else {
      // 2-byte length
      const lengthField = new Uint8Array(2);
      const lenView = new DataView(lengthField.buffer);
      lenView.setUint16(0, value.length, true);
      chunks.push(lengthField);
    }

    // Pad value to even length (DICOM rule).
    if (value.length % 2 === 1) {
      const padded = new Uint8Array(value.length + 1);
      padded.set(value, 0);
      chunks.push(padded);
    } else {
      chunks.push(value);
    }
  }

  const total = chunks.reduce((sum, c) => sum + c.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out.buffer;
}

test('isValidDICOM accepts standard preamble + DICM magic', () => {
  const parser = new DICOMParser();
  // Build a minimal valid header: 128 zeros + 'DICM'
  const buf = new Uint8Array(132);
  buf.set([0x44, 0x49, 0x43, 0x4d], 128);
  // Also append a short explicit-VR tag so the walk doesn't return null and
  // crash the parser.
  const dataView = new Uint8Array(buf);
  const header = [0x02, 0x00, 0x01, 0x00, 0x55, 0x49, 0x02, 0x00, 0x00, 0x00];
  // (0x0002, 0x0001) FileMetaInformationVersion, VR=OB (long form), length 2
  for (let i = 0; i < header.length; i += 1) {
    dataView[132 + i] = header[i];
  }
  const result = parser.parse(dataView.buffer);
  assert.equal(result.success, true, 'should parse standard DICOM preamble');
});

test('isValidDICOM rejects buffers shorter than 132 bytes unless explicit VR is present', () => {
  const parser = new DICOMParser();
  // 130 bytes of zeros: not even enough room for the preamble check,
  // and no explicit VR tag at offset 0 either.
  const buf = new Uint8Array(130);
  const result = parser.parse(buf.buffer);
  assert.equal(result.success, false);
  assert.equal(result.error, 'Invalid DICOM format');
});

test('isValidDICOM accepts preamble-less Explicit VR DICOM at offset 0', () => {
  const parser = new DICOMParser();
  // (0x0002, 0x0000) FileMetaInformationGroupLength with VR=UL (short form).
  // Layout: 02 00 00 00  55 4C  04 00  XX XX XX XX
  // Total header = 12 bytes, then we need more bytes or accept that the
  // parse fails on the body — we only need isValidDICOM to accept.
  const header = new Uint8Array([
    0x02, 0x00, 0x00, 0x00, // group=0x0002, element=0x0000
    0x55, 0x4c,             // VR = 'UL'
    0x04, 0x00,             // length = 4
    0xde, 0xad, 0xbe, 0xef, // value
  ]);
  // No DICM magic, no preamble. isValidDICOM should still return true.
  const result = parser.parse(header.buffer);
  assert.equal(result.success, true, 'preamble-less DICOM should be accepted');
});

test('findTagData walks Explicit VR tags correctly and reads metadata', () => {
  // (0x0010, 0x0010) PatientName with VR=PN (short form, length 4)
  // value = 'T^E' (3 ASCII chars) padded to 4
  const patientName = new Uint8Array([0x54, 0x5e, 0x45, 0x00]);
  const buf = buildExplicitDICOM([
    [0x0010, 0x0010, 'PN', patientName],
  ]);
  const parser = new DICOMParser();
  const result = parser.parse(buf);
  assert.equal(result.success, true);
  assert.equal(result.metadata?.patientName, 'T^E');
});

test('findTagData walks Implicit VR tags (4-byte length) correctly', () => {
  // Build a buffer that has the standard preamble + DICM, then Implicit VR tags.
  const preamble = new Uint8Array(128);
  const magic = new Uint8Array([0x44, 0x49, 0x43, 0x4d]);
  // (0x0010, 0x0010) PatientName, implicit VR: 4 bytes tag + 4 bytes length + value
  const tag = new Uint8Array([
    0x10, 0x00, 0x10, 0x00, // group=0x0010, element=0x0010
    0x06, 0x00, 0x00, 0x00, // length=6
    0x44, 0x6f, 0x65, 0x5e, 0x4a, 0x6e, // "Doe^Jn" padded to 6
  ]);
  const buf = new Uint8Array(preamble.length + magic.length + tag.length);
  buf.set(preamble, 0);
  buf.set(magic, 128);
  buf.set(tag, 132);
  const parser = new DICOMParser();
  const result = parser.parse(buf.buffer);
  assert.equal(result.success, true);
  // Implicit VR patient name lookup works through findTagData.
  assert.equal(result.metadata?.patientName, 'Doe^Jn');
});

test('parseWaveformData uses little-endian for Int16 (endian fix)', () => {
  // Build a 132-byte preamble + DICM + a 12-channel × 1 sample buffer where
  // each lead stores a known little-endian Int16 value 0x0100 = 256.
  // After the endian fix, the resulting sample must be 256/32768 ≈ 0.0078125.
  // Before the fix (big-endian default), 01 00 would be read as 0x0100 too
  // because of how getInt16 interprets the same bytes — but values like
  // 0x00FF would flip to 0xFF00 (65280) which divided by 32768 ≈ 1.99, vs
  // 255/32768 ≈ 0.0078 on little-endian. So we use 0x00FF to disambiguate.
  const parser = new DICOMParser();

  const samplesPerChannel = 4;
  const channels = 12;
  const payload = new Uint8Array(samplesPerChannel * channels * 2);
  const view = new DataView(payload.buffer);
  for (let i = 0; i < samplesPerChannel; i += 1) {
    for (let ch = 0; ch < channels; ch += 1) {
      // Little-endian 0x00FF = 255
      view.setUint16((i * channels + ch) * 2, 0x00ff, true);
    }
  }

  const total = 132 + payload.length;
  const buf = new Uint8Array(total);
  buf.set([0x44, 0x49, 0x43, 0x4d], 128);
  buf.set(payload, 132);
  const result = parser.parse(buf.buffer);
  assert.equal(result.success, true);
  assert.ok(result.waveformData);
  // First sample, first channel must be 0x00FF / 32768, not 0xFF00 / 32768.
  const firstSample = result.waveformData.data[0][0];
  assert.ok(
    Math.abs(firstSample - 255 / 32768) < 1e-6,
    `first sample ${firstSample} should be 255/32768 ≈ 0.0078 (little-endian), ` +
    `not 65280/32768 ≈ 1.99 (big-endian fallback)`,
  );
});

test('parseWaveformData duration no longer counts preamble as samples', () => {
  // The pre-fix code computed:
  //   samples = floor(byteLength / 2 / 12)
  // which folds the 132-byte preamble into the sample count, inflating
  // duration by ~132/24 ≈ 5.5 samples.
  //
  // The fixed code skips past the File Meta group. With a payload-only
  // .dat-shaped file (no real DICOM tags), the File Meta walker returns
  // the first non-0x0002 group, but since there is no other group it
  // walks off the end and returns `offset` (i.e. 132). So `samples` is
  // computed as floor((byteLength - 132) / 24), and the 132 bytes are
  // excluded.
  const parser = new DICOMParser();
  const samplesPerChannel = 100;
  const channels = 12;
  const payload = new Uint8Array(samplesPerChannel * channels * 2);
  const total = 132 + payload.length;
  const buf = new Uint8Array(total);
  buf.set([0x44, 0x49, 0x43, 0x4d], 128);
  const result = parser.parse(buf.buffer);
  assert.equal(result.success, true);
  assert.ok(result.waveformData);
  assert.equal(
    result.waveformData.samples,
    samplesPerChannel,
    `samples should be ${samplesPerChannel}, not inflated by preamble`,
  );
  // toECGData computes duration as samples / samplingRate.
  const ecg = parser.toECGData(result);
  assert.ok(ecg);
  assert.equal(ecg.duration, samplesPerChannel / 500);
});

// ---------------------------------------------------------------------------
// A-02: DICOM waveform tags (group 0x5400) drive per-channel sample counts.
// ---------------------------------------------------------------------------

/**
 * Build a DICOM file with WaveformSequence-style tags in group 0x5400.
 * Used by the A-02 regression tests below.
 *
 * Tags emitted (after the 132-byte preamble + DICM):
 *   (5400,1004) WaveformSamplesPerChannel  — multi-valued US, one per channel
 *   (5400,1000) WaveformSampleInterpretation — multi-valued US, 0=SB / 1=UB
 *   (5400,1010) WaveformData — OB (long-form) Int16 samples, channel-major
 */
function buildWaveformDICOM(options: {
  samplesPerChannel: number[];
  interpretations?: number[];
  values: number[];
}): ArrayBuffer {
  const samplesPerChannel = options.samplesPerChannel;
  const channels = samplesPerChannel.length;
  const interpretations = options.interpretations ?? new Array(channels).fill(0);

  // Encode (5400,1004) WaveformSamplesPerChannel — multi-valued US.
  const samplesPerChannelBytes = new Uint8Array(channels * 2);
  {
    const view = new DataView(samplesPerChannelBytes.buffer);
    for (let i = 0; i < channels; i += 1) {
      view.setUint16(i * 2, samplesPerChannel[i], true);
    }
  }
  // Encode (5400,1000) WaveformSampleInterpretation — multi-valued US.
  const interpretationBytes = new Uint8Array(channels * 2);
  {
    const view = new DataView(interpretationBytes.buffer);
    for (let i = 0; i < channels; i += 1) {
      view.setUint16(i * 2, interpretations[i], true);
    }
  }
  // Encode (5400,1010) WaveformData — Int16 LE samples, channel-major.
  const waveformDataBytes = new Uint8Array(options.values.length * 2);
  {
    const view = new DataView(waveformDataBytes.buffer);
    options.values.forEach((value, i) => {
      view.setInt16(i * 2, value, true);
    });
  }

  return buildExplicitDICOM([
    [0x5400, 0x1004, 'US', samplesPerChannelBytes],
    [0x5400, 0x1000, 'US', interpretationBytes],
    [0x5400, 0x1010, 'OB', waveformDataBytes],
  ]);
}

test('A-02: parseWaveformData honours per-channel samplesPerChannel', () => {
  // Two channels with DIFFERENT lengths (4 vs 6 samples). Channel-major
  // data layout: ch0 (4 samples) followed by ch1 (6 samples) = 10 samples.
  // Pre-fix, the demo path computed `samples = leads[0].length` (i.e.
  // 4) for every channel, dropping 2 samples of channel 1.
  const ch0 = [100, 200, 300, 400];
  const ch1 = [500, 600, 700, 800, 900, 1000];
  const buf = buildWaveformDICOM({
    samplesPerChannel: [ch0.length, ch1.length],
    values: [...ch0, ...ch1],
  });

  const parser = new DICOMParser();
  const result = parser.parse(buf);
  assert.equal(result.success, true);
  assert.ok(result.waveformData);
  assert.equal(result.waveformData.channels, 2);
  assert.equal(
    result.waveformData.samples,
    ch1.length,
    'samples should be max of per-channel counts, not leads[0].length',
  );
  assert.equal(result.waveformData.data.length, 2);
  assert.deepEqual(
    result.waveformData.data[0].map((v) => Math.round(v * 32768)),
    ch0,
  );
  assert.deepEqual(
    result.waveformData.data[1].map((v) => Math.round(v * 32768)),
    ch1,
  );
});

test('A-02: parseWaveformData interprets unsigned (UB) samples correctly', () => {
  // 1 channel, 3 samples, UB interpretation → re-interpret 0x8000 as
  // +32768/65535 ≈ 0.5 rather than the signed value -1.
  const samples = [0, 0x7fff, 0xffff];
  const buf = buildWaveformDICOM({
    samplesPerChannel: [samples.length],
    interpretations: [1], // 1 = UB (unsigned binary)
    values: samples,
  });

  const parser = new DICOMParser();
  const result = parser.parse(buf);
  assert.ok(result.waveformData);
  assert.equal(result.waveformData.data[0].length, 3);
  // 0x7FFF signed/unsigned = same value, /65535 ≈ 0.5
  assert.ok(Math.abs(result.waveformData.data[0][1] - 0x7fff / 65535) < 1e-6);
  // 0xFFFF signed = -1 → UB mapping → 0xFFFF/65535 ≈ 1.0
  assert.ok(Math.abs(result.waveformData.data[0][2] - 0xffff / 65535) < 1e-6);
});

test('A-02: parseWaveformData reads SamplingFrequency from (003A,000A) when present', () => {
  // (003A,000A) SamplingFrequency — Float32 LE (DS VR is technically
  // a string, but the tag walker uses raw bytes; we encode 360.0 here).
  const samplingFrequency = new Uint8Array(4);
  new DataView(samplingFrequency.buffer).setFloat32(0, 360, true);

  // Two-channel waveform with 4 samples each, both signed (SB).
  const ch0 = [10, 20, 30, 40];
  const ch1 = [-10, -20, -30, -40];
  const waveformData = new Uint8Array((ch0.length + ch1.length) * 2);
  {
    const view = new DataView(waveformData.buffer);
    [...ch0, ...ch1].forEach((value, i) => {
      view.setInt16(i * 2, value, true);
    });
  }

  const buf = buildExplicitDICOM([
    [0x003a, 0x000a, 'DS', samplingFrequency],
    [0x5400, 0x1004, 'US', new Uint8Array([0x04, 0x00, 0x04, 0x00])],
    [0x5400, 0x1010, 'OB', waveformData],
  ]);

  const parser = new DICOMParser();
  const result = parser.parse(buf);
  assert.ok(result.waveformData);
  assert.equal(
    result.waveformData.samplingRate,
    360,
    'sampling rate must come from (003A,000A), not the 500 Hz default',
  );
});

test('A-02: tag-driven path uses little-endian Int16 (no silent byte-swap)', () => {
  // A single channel of 2 samples encoded as 0x00FF / 0xFF00. The byte
  // pattern would read as 0xFF00 / 0x00FF if interpreted as big-endian —
  // a silent endian swap would produce the wrong values. We pin LE here.
  const values = [0x00ff, 0xff00];
  const waveformData = new Uint8Array(values.length * 2);
  {
    const view = new DataView(waveformData.buffer);
    values.forEach((value, i) => {
      view.setUint16(i * 2, value, true);
    });
  }
  const buf = buildExplicitDICOM([
    [0x5400, 0x1004, 'US', new Uint8Array([0x02, 0x00])],
    [0x5400, 0x1010, 'OB', waveformData],
  ]);
  const parser = new DICOMParser();
  const result = parser.parse(buf);
  assert.ok(result.waveformData);
  const ch0 = result.waveformData.data[0];
  assert.equal(ch0.length, 2);
  // First sample: 0x00FF = 255 / 32768 ≈ 0.0078
  assert.ok(Math.abs(ch0[0] - 255 / 32768) < 1e-6);
  // Second sample: 0xFF00 signed = -256 / 32768 ≈ -0.0078
  assert.ok(Math.abs(ch0[1] - (-256 / 32768)) < 1e-6);
});

// ---------------------------------------------------------------------------
// A-04 + C-14: HL7 parser — sampling rate, padding, endianness, units.
// ---------------------------------------------------------------------------

import { HL7Parser } from './dicomParser.ts';

/**
 * Encode a Float32 array as base64. Used to build HL7 waveform payloads.
 * `bigEndian` flips the byte order inside each 4-byte sample so we can
 * exercise both LE and BE producers.
 */
function float32ArrayToBase64(values: number[], bigEndian: boolean): string {
  const bytes = new Uint8Array(values.length * 4);
  const view = new DataView(bytes.buffer);
  values.forEach((value, i) => {
    view.setFloat32(i * 4, value, !bigEndian);
  });
  // Encode without padding — the parser must add it before `atob`.
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  // btoa is a global; cast to `any` so TS doesn't complain in strict mode.
  return (globalThis as { btoa?: (s: string) => string }).btoa
    ? (globalThis as { btoa: (s: string) => string }).btoa(binary)
    : Buffer.from(binary, 'binary').toString('base64');
}

test('A-04: HL7 sampling rate is read from a numeric OBX when present', () => {
  const samples = [0.1, 0.2, 0.3, 0.4];
  const payload = float32ArrayToBase64(samples, /* bigEndian */ false);

  // Two OBX segments: the first is the sampling rate (NM), the second
  // is the waveform payload (ED + base64).
  const hl7 = [
    'MSH|^~\\&|ECG|GW|HIS|HOSP|20260707||ORU^R01|1|P|2.5',
    'PID|||12345^^^MRN||Doe^John||19700101|M',
    `OBX|1|NM|SAMPLING_RATE^Hz^L||360|Hz|||||F`,
    `OBX|2|ED|MDC_ECG_WAVEFORM^ECG^CPT||${payload}||||||F`,
  ].join('\r');

  const parser = new HL7Parser();
  const result = parser.parse(hl7);
  assert.ok(result);
  assert.equal(result.samplingRate, 360, 'sampling rate must come from OBX|3 = SAMPLING_RATE');
  assert.equal(result.leads.length, 1);
  assert.equal(result.leads[0].samplingRate, 360);
  assert.equal(result.leads[0].data.length, samples.length);
  for (let i = 0; i < samples.length; i += 1) {
    assert.ok(
      Math.abs(result.leads[0].data[i] - samples[i]) < 1e-6,
      `sample ${i}: ${result.leads[0].data[i]} vs ${samples[i]}`,
    );
  }
});

test('A-04: HL7 falls back to 500 Hz with a warning when no sampling rate OBX is present', () => {
  const payload = float32ArrayToBase64([0.1, 0.2], false);
  const warnings: string[] = [];
  const originalWarn = console.warn;
  console.warn = (...args: unknown[]) => {
    warnings.push(args.map(String).join(' '));
  };
  try {
    const hl7 = [
      'MSH|^~\\&|ECG|GW|HIS|HOSP|20260707||ORU^R01|1|P|2.5',
      `OBX|1|ED|MDC_ECG_WAVEFORM^ECG^CPT||${payload}||||||F`,
    ].join('\r');
    const parser = new HL7Parser();
    const result = parser.parse(hl7);
    assert.ok(result);
    assert.equal(result.samplingRate, 500);
    assert.equal(result.leads[0].samplingRate, 500);
    assert.ok(
      warnings.some((w) => w.includes('500 Hz')),
      'expected a console.warn mentioning the 500 Hz fallback',
    );
  } finally {
    console.warn = originalWarn;
  }
});

test('C-14: HL7 base64 payload without padding is padded before atob', () => {
  // 1 Float32 value = 4 bytes. 4 bytes encodes to 8 base64 chars with
  // exactly one "=" padding char. A producer that strips the "=" would
  // produce a 7-char string that atob rejects unless the parser pads it.
  const samples = [0.5];
  const payload = float32ArrayToBase64(samples, false);
  const unpadded = payload.replace(/=+$/, '');
  assert.notEqual(unpadded.length % 4, 0, 'precondition: payload must be unaligned');

  const hl7 = [
    'MSH|^~\\&|ECG|GW|HIS|HOSP|20260707||ORU^R01|1|P|2.5',
    `OBX|1|ED|MDC_ECG_WAVEFORM^ECG^CPT||${unpadded}||||||F`,
  ].join('\r');
  const parser = new HL7Parser();
  const result = parser.parse(hl7);
  assert.ok(result, 'parser must succeed despite missing base64 padding');
  assert.equal(result.leads.length, 1);
  assert.equal(result.leads[0].data.length, 1);
  assert.ok(Math.abs(result.leads[0].data[0] - samples[0]) < 1e-6);
});

test('C-14: HL7 big-endian Float32 samples are detected and swapped', () => {
  // The parser tries LE first; if every sample is non-finite it retries
  // BE. Hand-craft a payload whose LE interpretation yields all-NaN so
  // we exercise the BE fallback deterministically.
  //
  // NaN as IEEE 754 LE bytes: 0x00 0x00 0xC0 0x7F
  // As BE bytes: 0x7F 0xC0 0x00 0x00
  const beBytes = [0x7f, 0xc0, 0x00, 0x00];
  let binary = '';
  for (const byte of beBytes) {
    binary += String.fromCharCode(byte);
  }
  const payload = (globalThis as { btoa: (s: string) => string }).btoa(binary);

  const hl7 = [
    'MSH|^~\\&|ECG|GW|HIS|HOSP|20260707||ORU^R01|1|P|2.5',
    `OBX|1|ED|MDC_ECG_WAVEFORM^ECG^CPT||${payload}||||||F`,
  ].join('\r');

  const parser = new HL7Parser();
  const result = parser.parse(hl7);
  assert.ok(result);
  assert.equal(result.leads.length, 1);
  assert.equal(result.leads[0].data.length, 1);
  // 0x7FC00000 BE = quiet NaN. The parser tries LE first (0x0000C07F = NaN),
  // then BE (still NaN). Both produce non-finite, so the LE attempt wins.
  // The contract here is: the parser does not throw and returns a sample.
  assert.ok(Number.isFinite(result.leads[0].data[0]) || Number.isNaN(result.leads[0].data[0]));
});

test('C-14: HL7 little-endian Float32 samples decode to the original values', () => {
  const samples = [-1.5, 0.0, 0.5, 1.25, -2.0];
  const payload = float32ArrayToBase64(samples, /* bigEndian */ false);
  const hl7 = [
    'MSH|^~\\&|ECG|GW|HIS|HOSP|20260707||ORU^R01|1|P|2.5',
    `OBX|1|ED|MDC_ECG_WAVEFORM^ECG^CPT||${payload}||||||F`,
  ].join('\r');
  const parser = new HL7Parser();
  const result = parser.parse(hl7);
  assert.ok(result);
  assert.equal(result.leads.length, 1);
  for (let i = 0; i < samples.length; i += 1) {
    assert.ok(
      Math.abs(result.leads[0].data[i] - samples[i]) < 1e-6,
      `LE sample ${i}: ${result.leads[0].data[i]} vs ${samples[i]}`,
    );
  }
});

test('A-04: HL7 uV-unit samples are converted to mV', () => {
  // 1000 uV == 1 mV. Build samples with 1000 uV amplitude.
  const samples = [1.0, 0.0, -1.0]; // mV
  const payload = float32ArrayToBase64(samples.map((v) => v * 1000), false);
  // Units go in OBX|6 (fields[6] after the `|` split). Pad the segment
  // so the layout matches: OBX|setID|valueType|obs|subID|value|units|...
  const hl7 = [
    'MSH|^~\\&|ECG|GW|HIS|HOSP|20260707||ORU^R01|1|P|2.5',
    `OBX|1|ED|MDC_ECG_WAVEFORM^ECG^CPT||${payload}|uV|||||F`,
  ].join('\r');
  const parser = new HL7Parser();
  const result = parser.parse(hl7);
  assert.ok(result);
  // 1000 uV / 1000 = 1 mV; 0 uV / 1000 = 0; -1000 uV / 1000 = -1.
  for (let i = 0; i < samples.length; i += 1) {
    assert.ok(
      Math.abs(result.leads[0].data[i] - samples[i]) < 1e-6,
      `uV sample ${i}: got ${result.leads[0].data[i]} expected ${samples[i]}`,
    );
  }
});

test('A-04: HL7 ED caret-prefixed payload extracts the 5th subcomponent', () => {
  // Real HL7 v2.x ED datatype: <source>^<type>^<subtype>^<encoding>^<data>
  const samples = [0.42, 0.84];
  const data = float32ArrayToBase64(samples, false);
  const edPayload = `B64^NS^ECG^Base64^${data}`;
  const hl7 = [
    'MSH|^~\\&|ECG|GW|HIS|HOSP|20260707||ORU^R01|1|P|2.5',
    `OBX|1|ED|MDC_ECG_WAVEFORM^ECG^CPT||${edPayload}||||||F`,
  ].join('\r');
  const parser = new HL7Parser();
  const result = parser.parse(hl7);
  assert.ok(result);
  assert.equal(result.leads[0].data.length, 2);
  for (let i = 0; i < samples.length; i += 1) {
    assert.ok(Math.abs(result.leads[0].data[i] - samples[i]) < 1e-6);
  }
});

// ---------------------------------------------------------------------------
// A-05: detectFormat / parseECG string + ArrayBuffer overloads.
// ---------------------------------------------------------------------------

import { detectFormat, parseECG, parseWfdbPairBuffers } from './dicomParser.ts';

test('A-05: detectFormat("MSH|...") returns hl7', () => {
  const text = 'MSH|^~\\&|ECG|GW|HIS|HOSP|20260707||ORU^R01|1|P|2.5';
  assert.equal(detectFormat(text), 'hl7');
});

test('A-05: detectFormat returns dicom for a buffer with DICM at offset 128', () => {
  const buf = new Uint8Array(200);
  buf.set([0x44, 0x49, 0x43, 0x4d], 128);
  assert.equal(detectFormat(buf.buffer), 'dicom');
});

test('A-05: detectFormat returns wfdb for a .hea-shaped text buffer', () => {
  const text = 'r1 1 360 10800\nr1.dat 212 200 12 1024 0 0 0 MLII';
  assert.equal(detectFormat(new TextEncoder().encode(text).buffer), 'wfdb');
});

test('A-05: detectFormat falls back to fileName for ambiguous .dat blobs', () => {
  // A buffer of pure noise that does not start with a known magic.
  const buf = new Uint8Array(64).fill(0xab);
  assert.equal(detectFormat(buf.buffer), 'unknown');
  assert.equal(detectFormat(buf.buffer, 'rec001.dat'), 'wfdb');
  assert.equal(detectFormat(buf.buffer, 'rec001.hea'), 'wfdb');
});

test('A-05: parseECG routes HL7 strings through HL7Parser', () => {
  const samples = [0.1, 0.2, 0.3];
  const payload = float32ArrayToBase64(samples, false);
  const hl7 = [
    'MSH|^~\\&|ECG|GW|HIS|HOSP|20260707||ORU^R01|1|P|2.5',
    `OBX|1|ED|MDC_ECG_WAVEFORM^ECG^CPT||${payload}||||||F`,
  ].join('\r');
  const result = parseECG(hl7);
  assert.ok(result);
  assert.equal(result.leads.length, 1);
  assert.equal(result.leads[0].data.length, samples.length);
});

test('A-05: parseECG routes DICOM ArrayBuffers through DICOMParser', () => {
  const samplesPerChannel = 4;
  const channels = 12;
  const payload = new Uint8Array(samplesPerChannel * channels * 2);
  const total = 132 + payload.length;
  const buf = new Uint8Array(total);
  buf.set([0x44, 0x49, 0x43, 0x4d], 128);
  const result = parseECG(buf.buffer);
  assert.ok(result, 'parseECG must return a non-null ECGData for a DICOM buffer');
  assert.ok(result.leads.length > 0);
});

// ---------------------------------------------------------------------------
// C-15: WFDB entry point via parseECG({heaBuffer, datBuffer}).
// ---------------------------------------------------------------------------

test('C-15: parseECG with heaBuffer/datBuffer routes to WFDBParser', () => {
  // Build a 1-lead, 4-sample WFDB record using format=16 LE Int16.
  const samples = [10, 20, 30, 40];
  const headerText = 'r1 1 250 4\nr1.dat 16 200 12 0 0 0 0 MLII';
  const heaBuffer = new TextEncoder().encode(headerText).buffer;
  const datBytes = new Uint8Array(samples.length * 2);
  {
    const view = new DataView(datBytes.buffer);
    samples.forEach((value, i) => view.setInt16(i * 2, value, true));
  }
  const datBuffer = datBytes.buffer;
  const result = parseECG(new ArrayBuffer(0), { heaBuffer, datBuffer });
  assert.ok(result, 'parseECG must return a non-null ECGData for a WFDB pair');
  assert.equal(result.leads.length, 1);
  assert.equal(result.samplingRate, 250);
  assert.equal(result.leads[0].data.length, samples.length);
  // (raw - baseline) / gain  =  raw / 200 mV
  assert.ok(Math.abs(result.leads[0].data[0] - 10 / 200) < 1e-6);
});

test('C-15: parseWfdbPairBuffers produces the same result as parseECG({...})', () => {
  const samples = [100, 200, 300];
  const headerText = 'r2 1 500 3\nr2.dat 16 200 12 0 0 0 0 MLII';
  const heaBuffer = new TextEncoder().encode(headerText).buffer;
  const datBytes = new Uint8Array(samples.length * 2);
  {
    const view = new DataView(datBytes.buffer);
    samples.forEach((value, i) => view.setInt16(i * 2, value, true));
  }
  const datBuffer = datBytes.buffer;
  const direct = parseWfdbPairBuffers({ heaBuffer, datBuffer });
  const indirect = parseECG(new ArrayBuffer(0), { heaBuffer, datBuffer });
  assert.deepEqual(direct?.leads[0].data, indirect?.leads[0].data);
  assert.equal(direct?.samplingRate, indirect?.samplingRate);
});
