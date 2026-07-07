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
