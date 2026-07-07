import { ECGLead, ECGData, PatientInfo, DeviceInfo } from '../types';

/**
 * DICOM Explicit VR Transfer Syntax — long-form VRs (PS3.5 §7.1.2).
 * These reserve 2 bytes after the VR before the 4-byte length field.
 */
const LONG_FORM_VRS: ReadonlySet<string> = new Set([
  'OB', 'OD', 'OF', 'OL', 'OV', 'OW', 'SQ', 'UC', 'UN', 'UR', 'UT',
]);

export interface DICOMMetadata {
  patientName?: string;
  patientId?: string;
  patientBirthDate?: string;
  patientSex?: string;
  studyDate?: string;
  studyTime?: string;
  modality?: string;
  deviceSerialNumber?: string;
  deviceManufacturer?: string;
  deviceModel?: string;
}

export interface DICOMWaveformData {
  channels: number;
  samples: number;
  samplingRate: number;
  data: number[][];
}

export interface DICOMParseResult {
  success: boolean;
  metadata?: DICOMMetadata;
  waveformData?: DICOMWaveformData;
  error?: string;
}

export class DICOMParser {
  parse(arrayBuffer: ArrayBuffer): DICOMParseResult {
    try {
      const dataView = new DataView(arrayBuffer);
      
      if (!this.isValidDICOM(dataView)) {
        return { success: false, error: 'Invalid DICOM format' };
      }

      const metadata = this.parseMetadata(dataView);
      const waveformData = this.parseWaveformData(dataView);

      return {
        success: true,
        metadata,
        waveformData
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  private isValidDICOM(dataView: DataView): boolean {
    if (dataView.byteLength < 132) {
      // Some real-world DICOM files are pre-preamble-less (e.g. raw Waveform
      // dumps or stripped headers). Fall back to detecting an Explicit VR
      // meta-header at offset 0: the first group MUST be (0x0002, ...) and
      // its VR is one of the explicit-VR bytes defined in PS3.5 §7.1.2.
      return this.hasExplicitVRGroupAt(dataView, 0);
    }

    // Standard preamble + 'DICM' magic. Always valid.
    if (
      dataView.getUint8(128) === 0x44 &&
      dataView.getUint8(129) === 0x49 &&
      dataView.getUint8(130) === 0x43 &&
      dataView.getUint8(131) === 0x4d
    ) {
      return true;
    }

    // No DICM magic but file is long enough — could still be a pre-preamble-less
    // Explicit VR DICOM. Accept if offset 132 (or 0) starts with a (0x0002, *)
    // explicit-VR tag. This keeps backwards compatibility with demo DICOM
    // that has the magic, and opens the door to real-world files.
    return this.hasExplicitVRGroupAt(dataView, 132) ||
      this.hasExplicitVRGroupAt(dataView, 0);
  }

  /**
   * Returns true if `offset` points at a tag whose group is 0x0002 (File Meta)
   * and whose VR byte pair is one of the explicit-VR letters defined in
   * DICOM PS3.5 §7.1.2 (uppercase ASCII letters, e.g. 'OB','OW','UL','SQ').
   * Used to detect DICOM files without the 128-byte preamble + 'DICM' magic.
   */
  private hasExplicitVRGroupAt(dataView: DataView, offset: number): boolean {
    if (offset + 8 > dataView.byteLength) {
      return false;
    }
    const groupLo = dataView.getUint8(offset);
    const groupHi = dataView.getUint8(offset + 1);
    if (groupLo !== 0x02 || groupHi !== 0x00) {
      return false;
    }
    const vr0 = dataView.getUint8(offset + 4);
    const vr1 = dataView.getUint8(offset + 5);
    // VR is two uppercase ASCII letters.
    return (
      vr0 >= 0x41 && vr0 <= 0x5a &&
      vr1 >= 0x41 && vr1 <= 0x5a
    );
  }

  private readString(dataView: DataView, offset: number, length: number): string {
    let result = '';
    for (let i = 0; i < length; i++) {
      const char = dataView.getUint8(offset + i);
      if (char !== 0) {
        result += String.fromCharCode(char);
      }
    }
    return result.trim();
  }

  private readUInt16(dataView: DataView, offset: number): number {
    return dataView.getUint16(offset, false);
  }

  private readUInt32(dataView: DataView, offset: number): number {
    return dataView.getUint32(offset, false);
  }

  private parseMetadata(dataView: DataView): DICOMMetadata {
    const metadata: DICOMMetadata = {};
    
    metadata.patientName = this.readTag(dataView, 0x0010, 0x0010);
    metadata.patientId = this.readTag(dataView, 0x0010, 0x0020);
    metadata.patientSex = this.readTag(dataView, 0x0010, 0x0040);
    metadata.studyDate = this.readTag(dataView, 0x0008, 0x0020);
    metadata.modality = this.readTag(dataView, 0x0008, 0x0060);
    metadata.deviceManufacturer = this.readTag(dataView, 0x0008, 0x0070);
    metadata.deviceModel = this.readTag(dataView, 0x0008, 0x1090);

    return metadata;
  }

  private readTag(dataView: DataView, group: number, element: number): string | undefined {
    const tagData = this.findTagData(dataView, group, element);
    if (!tagData) return undefined;
    return this.readStringFromBuffer(tagData);
  }

  private findTagData(dataView: DataView, group: number, element: number): ArrayBuffer | null {
    const fileSize = dataView.byteLength;

    // Walk the dataset tag-by-tag. The dataset may start at 0 (pre-preamble-
    // less DICOM) or at 132 (after the standard preamble + File Meta group).
    // We accept whichever isValidDICOM has already validated.
    const startOffset = this.datasetStartOffset(dataView);

    let offset = startOffset;
    while (offset + 8 <= fileSize) {
      const header = this.parseTagHeader(dataView, offset);
      if (!header) {
        return null;
      }

      if (header.group === group && header.element === element) {
        if (header.dataOffset + header.length > fileSize) {
          return null;
        }
        const buffer = dataView.buffer as ArrayBuffer;
        return buffer.slice(header.dataOffset, header.dataOffset + header.length);
      }

      // Move past this tag (length may be 0xFFFFFFFF for undefined length
      // sequences — bail out in that case to avoid an infinite loop).
      if (header.length === 0xffffffff) {
        return null;
      }
      offset = header.dataOffset + header.length;
    }
    return null;
  }

  /**
   * Returns the byte offset where the dataset (File Meta group 0x0002) starts.
   * - 132 if a 'DICM' preamble is present
   * - 0   otherwise (pre-preamble-less DICOM, rare but real)
   */
  private datasetStartOffset(dataView: DataView): number {
    if (dataView.byteLength >= 132) {
      const hasMagic =
        dataView.getUint8(128) === 0x44 &&
        dataView.getUint8(129) === 0x49 &&
        dataView.getUint8(130) === 0x43 &&
        dataView.getUint8(131) === 0x4d;
      if (hasMagic) {
        return 132;
      }
    }
    return 0;
  }

  /**
   * Parse one DICOM tag header at `offset`.
   *
   * Supports two transfer syntaxes:
   * 1. Implicit VR Little Endian:  4 bytes tag + 4 bytes uint32 length
   * 2. Explicit VR Little Endian:  4 bytes tag + 2 bytes VR + (2 or 6) bytes length
   *
   * For Explicit VR, the length field is:
   *   - 2 bytes  for VR ∈ {AE, AS, AT, CS, DA, DS, DT, FL, FD, IS, LO, LT,
   *                       PN, SH, SL, SS, ST, TM, UI, UL, US}
   *   - 2 reserved + 4 bytes uint32 for VR ∈ {OB, OD, OF, OL, OV, OW, SQ, UC,
   *                                          UN, UR, UT}
   *
   * Returns null on malformed input.
   *
   * Reference: DICOM PS3.5 §7.1.2 (Data Element Structure).
   */
  private parseTagHeader(dataView: DataView, offset: number): {
    group: number;
    element: number;
    vr: string | null;
    length: number;
    dataOffset: number;
  } | null {
    if (offset + 8 > dataView.byteLength) {
      return null;
    }
    const group = dataView.getUint16(offset, true);
    const element = dataView.getUint16(offset + 2, true);

    const vr0 = dataView.getUint8(offset + 4);
    const vr1 = dataView.getUint8(offset + 5);
    const isExplicitVR =
      vr0 >= 0x41 && vr0 <= 0x5a &&
      vr1 >= 0x41 && vr1 <= 0x5a;
    const vr = isExplicitVR ? String.fromCharCode(vr0, vr1) : null;

    if (isExplicitVR) {
      // Long-form VRs (PS3.5 §7.1.2) have 2 reserved bytes + 4-byte length.
      if (LONG_FORM_VRS.has(vr!)) {
        if (offset + 12 > dataView.byteLength) {
          return null;
        }
        const length = dataView.getUint32(offset + 8, true);
        return { group, element, vr, length, dataOffset: offset + 12 };
      }
      // Short-form VRs: 2-byte length right after the VR bytes.
      const length = dataView.getUint16(offset + 6, true);
      return { group, element, vr, length, dataOffset: offset + 8 };
    }

    // Implicit VR Little Endian: 4 bytes tag + 4 bytes uint32 length.
    const length = dataView.getUint32(offset + 4, true);
    return { group, element, vr: null, length, dataOffset: offset + 8 };
  }

  private readStringFromBuffer(buffer: ArrayBuffer): string {
    const view = new Uint8Array(buffer);
    let result = '';
    for (let i = 0; i < view.length; i++) {
      if (view[i] !== 0) {
        result += String.fromCharCode(view[i]);
      }
    }
    return result.trim();
  }

  private parseWaveformData(dataView: DataView): DICOMWaveformData {
    // Demo / mock fallback: assume 12 leads, little-endian Int16, sample
    // interleaved per channel (lead-major per DICOM Waveform convention).
    //
    // A real DICOM ECG would read the channel count from
    // (003A,0005) NumberOfWaveformChannels inside the (003A,0010)
    // Waveform Sequence and pull sample values from
    // (5400,1010) WaveformData, but the demo DICOM does not carry those
    // tags — we still want a deterministic parse for the waveform viewer.
    const channels = 12;

    // The 128-byte preamble + 4-byte 'DICM' magic + File Meta group
    // (variable, but typically < 1 KB) live in the first ~few hundred bytes
    // of the file and must not be folded into the sample count. The previous
    // implementation divided total `byteLength` by 24, which inflated
    // `samples` (and therefore `duration`) by a noticeable amount.
    const headerEndOffset = this.estimateWaveformStart(dataView);

    const samplesPerChannel = Math.max(
      0,
      Math.floor((dataView.byteLength - headerEndOffset) / 2 / channels),
    );

    const waveformData: DICOMWaveformData = {
      channels,
      samples: samplesPerChannel,
      samplingRate: 500,
      data: [],
    };

    for (let ch = 0; ch < channels; ch++) {
      const channelData: number[] = [];
      for (let i = 0; i < samplesPerChannel; i++) {
        // Little-endian Int16 (DICOM Waveform default) — the previous code
        // called `getInt16(offset)` without `true`, which silently read
        // big-endian on every host and produced garbage waveforms.
        const value = dataView.getInt16(
          headerEndOffset + (i * channels + ch) * 2,
          true,
        );
        channelData.push(value / 32768);
      }
      waveformData.data.push(channelData);
    }

    return waveformData;
  }

  /**
   * Returns the byte offset where actual waveform samples start.
   *
   * - When the file has the standard 132-byte preamble + 'DICM' magic, the
   *   File Meta group (0x0002) follows at 132. We use `parseTagHeader` to
   *   skip past it. If the File Meta group is not present or malformed, we
   *   fall back to 132.
   * - When the file has no preamble, samples start at 0.
   */
  private estimateWaveformStart(dataView: DataView): number {
    if (dataView.byteLength < 132) {
      return 0;
    }
    const hasMagic =
      dataView.getUint8(128) === 0x44 &&
      dataView.getUint8(129) === 0x49 &&
      dataView.getUint8(130) === 0x43 &&
      dataView.getUint8(131) === 0x4d;
    if (!hasMagic) {
      return 0;
    }

    // Walk the File Meta group (0x0002, *) — find the last tag in this group
    // and skip past its data.
    let offset = 132;
    while (offset + 8 <= dataView.byteLength) {
      const header = this.parseTagHeader(dataView, offset);
      if (!header) {
        break;
      }
      if (header.group !== 0x0002) {
        return offset;
      }
      if (header.length === 0xffffffff) {
        return offset;
      }
      offset = header.dataOffset + header.length;
    }
    return offset;
  }

  toECGData(dicomResult: DICOMParseResult): ECGData | null {
    if (!dicomResult.success || !dicomResult.waveformData) {
      return null;
    }

    const { waveformData, metadata } = dicomResult;
    
    const leadNames = ['I', 'II', 'III', 'aVR', 'aVL', 'aVF', 'V1', 'V2', 'V3', 'V4', 'V5', 'V6'];
    
    const leads: ECGLead[] = waveformData.data.map((data, index) => ({
      name: leadNames[index] || `Ch${index}`,
      data,
      samplingRate: waveformData.samplingRate
    }));

    const patientInfo: PatientInfo | undefined = metadata ? {
      id: metadata.patientId,
      name: metadata.patientName,
      gender: metadata.patientSex
    } : undefined;

    const deviceInfo: DeviceInfo | undefined = metadata ? {
      manufacturer: metadata.deviceManufacturer,
      model: metadata.deviceModel,
      serialNumber: metadata.deviceSerialNumber
    } : undefined;

    return {
      leads,
      duration: waveformData.samples / waveformData.samplingRate,
      samplingRate: waveformData.samplingRate,
      patientInfo,
      deviceInfo
    };
  }
}

export interface WFDBSignalInfo {
  /** File name (token 0 in the signal line). */
  fileName: string;
  /** Signal format code (e.g. 16, 212). Defaults to 16 if missing. */
  format: number;
  /** ADC gain in ADU per mV. Defaults to 200 if missing. */
  gain: number;
  /** ADC resolution in bits. Defaults to 12 if missing. */
  adcResolution: number;
  /** ADC zero (baseline) in ADU. Defaults to 0 if missing. */
  baseline: number;
  /** Initial sample value in ADU. Optional. */
  initialValue?: number;
  /** Checksum. Optional. */
  checksum?: number;
  /** Block size. Optional. */
  blockSize?: number;
  /** Human-readable lead description. */
  description: string;
}

export class WFDBParser {
  /**
   * Parse a WFDB record (.hea + .dat).
   *
   * @param headerFile  The .hea file contents as a UTF-8 string.
   * @param dataFile    The .dat file contents as raw bytes. Pass a
   *                    `Uint8Array` (e.g. `new Uint8Array(await file.arrayBuffer())`)
   *                    — passing a JS string goes through a lossy `TextDecoder`
   *                    path that silently corrupts high bytes (>= 0x80).
   */
  parse(headerFile: string, dataFile: Uint8Array | ArrayBuffer): ECGData | null {
    try {
      const lines = headerFile.split('\n');
      const normalizedLines = lines.map((line) => line.trim()).filter(Boolean);
      if (normalizedLines.length === 0) {
        return null;
      }

      const headerTokens = normalizedLines[0].split(/\s+/);
      if (headerTokens.length < 4) {
        return null;
      }

      const numLeads = parseInt(headerTokens[1], 10);
      const samplingRate = parseFloat(headerTokens[2]);
      const numSamples = parseInt(headerTokens[3], 10);
      if (!Number.isFinite(numLeads) || !Number.isFinite(samplingRate) || !Number.isFinite(numSamples)) {
        return null;
      }

      // Parse per-signal info from each signal line.
      const signalInfos: WFDBSignalInfo[] = [];
      for (let index = 1; index < normalizedLines.length; index += 1) {
        const line = normalizedLines[index];
        // Comment lines start with '#' (per WFDB spec). Skip them.
        if (line.startsWith('#')) {
          continue;
        }
        const tokens = line.split(/\s+/);
        if (tokens.length === 0) {
          continue;
        }
        signalInfos.push(this.parseSignalLine(tokens));
      }

      while (signalInfos.length < numLeads) {
        signalInfos.push({
          fileName: '',
          format: 16,
          gain: 200,
          adcResolution: 12,
          baseline: 0,
          description: `Ch${signalInfos.length}`,
        });
      }

      // Take first signal's format as the file's per-frame format. All
      // signals in a single record are required to share the same format
      // (per WFDB spec). If the .hea is missing the per-signal format
      // field, we default to 16 (raw 16-bit little-endian), which is what
      // the original parser hard-coded.
      const recordFormat = signalInfos[0]?.format ?? 16;
      const recordGain = signalInfos[0]?.gain ?? 200;
      const recordBaseline = signalInfos[0]?.baseline ?? 0;

      const bytes = dataFile instanceof Uint8Array
        ? dataFile
        : new Uint8Array(dataFile);

      const samples = this.unpackSamples(bytes, numLeads, numSamples, recordFormat);
      if (!samples || samples.length === 0) {
        return null;
      }
      const sampleCount = samples.length / numLeads;
      if (sampleCount <= 0) {
        return null;
      }

      const leads: ECGLead[] = [];
      for (let ch = 0; ch < numLeads; ch++) {
        const channelData: number[] = [];
        for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex += 1) {
          const raw = samples[sampleIndex * numLeads + ch];
          // Convert ADU to mV:  mV = (raw - baseline) / gain
          const millivolt = (raw - recordBaseline) / recordGain;
          channelData.push(millivolt);
        }
        const info = signalInfos[ch];
        leads.push({
          name: info.description || `Ch${ch}`,
          data: channelData,
          samplingRate,
        });
      }

      return {
        leads,
        duration: sampleCount / samplingRate,
        samplingRate,
      };
    } catch (error) {
      console.error('WFDB parsing error:', error);
      return null;
    }
  }

  /**
   * Parse a single signal line from a WFDB .hea header.
   *
   * Token layout (PhysioNet header-5.htm § Signal specification):
   *   tokens[0] = file basename (without extension)
   *   tokens[1] = format     (e.g. 16, 212, 310)
   *   tokens[2] = gain       (adu/mV)
   *   tokens[3] = bits       (ADC resolution)
   *   tokens[4] = baseline   (zero in adu)
   *   tokens[5] = initial value (optional)
   *   tokens[6] = checksum   (optional)
   *   tokens[7] = block size (optional)
   *   tokens[8..] = description (free text, joined)
   */
  private parseSignalLine(tokens: string[]): WFDBSignalInfo {
    const fileName = tokens[0] ?? '';
    const format = this.parseIntOrDefault(tokens[1], 16);
    const gain = this.parseIntOrDefault(tokens[2], 200);
    const adcResolution = this.parseIntOrDefault(tokens[3], 12);
    const baseline = this.parseIntOrDefault(tokens[4], 0);
    const initialValue = tokens.length > 5 ? this.parseIntOrDefault(tokens[5], 0) : undefined;
    const checksum = tokens.length > 6 ? this.parseIntOrDefault(tokens[6], 0) : undefined;
    const blockSize = tokens.length > 7 ? this.parseIntOrDefault(tokens[7], 0) : undefined;
    const description = tokens.slice(8).join(' ').trim() || fileName;
    return {
      fileName,
      format,
      gain,
      adcResolution,
      baseline,
      initialValue,
      checksum,
      blockSize,
      description,
    };
  }

  private parseIntOrDefault(token: string | undefined, fallback: number): number {
    if (token === undefined) {
      return fallback;
    }
    const n = parseInt(token, 10);
    return Number.isFinite(n) ? n : fallback;
  }

  /**
   * Unpack a .dat byte stream into a flat array of 12/16-bit signed
   * samples, one per channel-sample pair, frame-major (all channels of
   * frame 0, then all channels of frame 1, ...). The output is normalized
   * to the format's natural integer range; ADC-to-mV conversion is the
   * caller's responsibility.
   *
   * Supported formats (see PhysioNet header-5.htm):
   *   16  : 16-bit two's-complement little-endian
   *   212 : 12-bit two's-complement, two samples packed into 3 bytes
   *   80  : 8-bit unsigned offset binary (subtype of 8-bit two's-complement)
   *   310 : 8-bit two's-complement
   *
   * Returns null when the format is not supported or the byte stream is
   * too short to read the requested number of samples.
   */
  unpackSamples(
    bytes: Uint8Array,
    numLeads: number,
    numSamples: number,
    format: number,
  ): Int16Array | null {
    if (numLeads <= 0 || numSamples <= 0) {
      return null;
    }
    const totalSamples = numLeads * numSamples;
    if (format === 16) {
      return this.parseFormat16(bytes, totalSamples);
    }
    if (format === 212) {
      return this.parseFormat212(bytes, numSamples, numLeads);
    }
    if (format === 80) {
      return this.parseFormat80(bytes, totalSamples);
    }
    if (format === 310) {
      return this.parseFormat310(bytes, totalSamples);
    }
    console.warn('WFDB format not supported:', format);
    return null;
  }

  private parseFormat16(bytes: Uint8Array, totalSamples: number): Int16Array | null {
    if (bytes.length < totalSamples * 2) {
      return null;
    }
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const out = new Int16Array(totalSamples);
    for (let i = 0; i < totalSamples; i += 1) {
      out[i] = view.getInt16(i * 2, true);
    }
    return out;
  }

  /**
   * Decode MIT-BIH 12-bit packed format: two 12-bit two's-complement
   * samples are packed into 3 bytes, low byte first.
   *
   *   byte0 = sample1 & 0xFF
   *   byte1 = ((sample1 >> 8) & 0x0F) | ((sample2 & 0x0F) << 4)
   *   byte2 = (sample2 >> 4) & 0xFF
   *
   * Sample order is frame-major across all leads per spec, so a 2-lead,
   * 4-sample record occupies 4 * 3 = 12 bytes (one frame = 6 bytes × 4
   * frames in this example) — see header-5.htm § Signal formats.
   *
   * Each sample is sign-extended from 12 bits to 16 bits.
   */
  parseFormat212(bytes: Uint8Array, numSamples: number, numLeads: number): Int16Array | null {
    const totalSamples = numSamples * numLeads;
    if (totalSamples === 0) {
      return null;
    }
    // 2 samples pack into 3 bytes; pad to even sample count.
    const pairCount = Math.ceil(totalSamples / 2);
    const requiredBytes = pairCount * 3;
    if (bytes.length < requiredBytes) {
      return null;
    }
    const out = new Int16Array(totalSamples);
    let inOffset = 0;
    let outIndex = 0;
    for (let i = 0; i < pairCount; i += 1) {
      const b0 = bytes[inOffset];
      const b1 = bytes[inOffset + 1];
      const b2 = bytes[inOffset + 2];
      inOffset += 3;

      // Sample 1 = (b0) | ((b1 & 0x0F) << 8)
      let raw1 = b0 | ((b1 & 0x0f) << 8);
      if (raw1 & 0x800) {
        raw1 -= 0x1000;
      }
      out[outIndex] = raw1;
      outIndex += 1;
      if (outIndex >= totalSamples) {
        break;
      }

      // Sample 2 = ((b1 >> 4) & 0x0F) | (b2 << 4)
      let raw2 = ((b1 >> 4) & 0x0f) | (b2 << 4);
      if (raw2 & 0x800) {
        raw2 -= 0x1000;
      }
      out[outIndex] = raw2;
      outIndex += 1;
    }
    return out;
  }

  /**
   * Decode 8-bit offset binary:  sample = byte - 128.
   * (PhysioNet treats format 80 as a subtype of 8-bit two's-complement.)
   */
  private parseFormat80(bytes: Uint8Array, totalSamples: number): Int16Array | null {
    if (bytes.length < totalSamples) {
      return null;
    }
    const out = new Int16Array(totalSamples);
    for (let i = 0; i < totalSamples; i += 1) {
      out[i] = bytes[i] - 128;
    }
    return out;
  }

  /**
   * Decode 8-bit two's-complement.
   */
  private parseFormat310(bytes: Uint8Array, totalSamples: number): Int16Array | null {
    if (bytes.length < totalSamples) {
      return null;
    }
    const out = new Int16Array(totalSamples);
    for (let i = 0; i < totalSamples; i += 1) {
      // Reinterpret unsigned as signed 8-bit and widen to 16.
      const u = bytes[i];
      out[i] = u < 0x80 ? u : u - 0x100;
    }
    return out;
  }
}

export class HL7Parser {
  parse(hl7Message: string): ECGData | null {
    try {
      const lines = hl7Message.split('\r');
      
      const segmentMap = new Map<string, string[]>();
      for (const line of lines) {
        const fields = line.split('|');
        const segmentType = fields[0];
        if (!segmentMap.has(segmentType)) {
          segmentMap.set(segmentType, []);
        }
        segmentMap.get(segmentType)?.push(line);
      }

      const patientInfo: PatientInfo = {};
      const pidSegments = segmentMap.get('PID') || [];
      if (pidSegments.length > 0) {
        const pid = pidSegments[0].split('|');
        patientInfo.id = pid[3];
        patientInfo.name = pid[5];
        patientInfo.gender = pid[8];
      }

      const obxSegments = segmentMap.get('OBX') || [];
      const leads: ECGLead[] = [];
      
      for (const obx of obxSegments) {
        const fields = obx.split('|');
        if (fields[3]?.includes('ECG')) {
          const waveformData = fields[5];
          if (waveformData) {
            const decoded = atob(waveformData);
            const floatArray = new Float32Array(decoded.length / 4);
            for (let i = 0; i < floatArray.length; i++) {
              floatArray[i] = new DataView(
                new Uint8Array([
                  decoded.charCodeAt(i * 4),
                  decoded.charCodeAt(i * 4 + 1),
                  decoded.charCodeAt(i * 4 + 2),
                  decoded.charCodeAt(i * 4 + 3)
                ]).buffer
              ).getFloat32(0);
            }

            leads.push({
              name: fields[4]?.split('^')[1] || 'I',
              data: Array.from(floatArray),
              samplingRate: 500
            });
          }
        }
      }

      return {
        leads,
        duration: leads[0]?.data.length ? leads[0].data.length / 500 : 0,
        samplingRate: 500,
        patientInfo
      };
    } catch (error) {
      console.error('HL7 parsing error:', error);
      return null;
    }
  }
}

export function detectFormat(data: ArrayBuffer | string): 'dicom' | 'wfdb' | 'hl7' | 'json' | 'unknown' {
  if (typeof data === 'string') {
    if (data.startsWith('MSH')) {
      return 'hl7';
    }
    if (data.startsWith('{') || data.startsWith('[')) {
      return 'json';
    }
    return 'unknown';
  }

  const view = new DataView(data);
  if (view.byteLength > 132) {
    const preamble = String.fromCharCode(
      view.getUint8(128),
      view.getUint8(129),
      view.getUint8(130),
      view.getUint8(131)
    );
    if (preamble === 'DICM') {
      return 'dicom';
    }
  }

  return 'unknown';
}

export function parseECG(data: ArrayBuffer | string): ECGData | null {
  const format = detectFormat(data);
  
  switch (format) {
    case 'dicom': {
      const parser = new DICOMParser();
      const result = parser.parse(data as ArrayBuffer);
      return parser.toECGData(result);
    }
    case 'hl7': {
      const parser = new HL7Parser();
      return parser.parse(data as string);
    }
    case 'json': {
      try {
        return JSON.parse(data as string);
      } catch {
        return null;
      }
    }
    default:
      return null;
  }
}
