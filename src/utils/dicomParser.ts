import { ECGLead, ECGData, PatientInfo, DeviceInfo } from '../types';

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
      return false;
    }

    return (
      dataView.getUint8(128) === 0x44 &&
      dataView.getUint8(129) === 0x49 &&
      dataView.getUint8(130) === 0x43 &&
      dataView.getUint8(131) === 0x4d
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
    const searchPattern = new Uint8Array([group & 0xff, group >> 8, element & 0xff, element >> 8]);
    
    for (let i = 132; i < fileSize - 4; i++) {
      if (dataView.getUint8(i) === searchPattern[0] &&
          dataView.getUint8(i + 1) === searchPattern[1] &&
          dataView.getUint8(i + 2) === searchPattern[2] &&
          dataView.getUint8(i + 3) === searchPattern[3]) {
        const length = dataView.getUint32(i + 4, true);
        if (length > 0 && length < fileSize - i - 8 && length % 2 === 0) {
          const buffer = dataView.buffer as ArrayBuffer;
          return buffer.slice(i + 8, i + 8 + length);
        }
      }
    }
    return null;
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
    const waveformData: DICOMWaveformData = {
      channels: 12,
      samples: Math.floor(dataView.byteLength / 2 / 12),
      samplingRate: 500,
      data: []
    };

    const offset = 132;
    const samplesPerChannel = Math.floor((dataView.byteLength - offset) / 2 / waveformData.channels);

    for (let ch = 0; ch < waveformData.channels; ch++) {
      const channelData: number[] = [];
      for (let i = 0; i < samplesPerChannel; i++) {
        const value = dataView.getInt16(offset + (i * waveformData.channels + ch) * 2);
        channelData.push(value / 32768);
      }
      waveformData.data.push(channelData);
    }

    return waveformData;
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

export class WFDBParser {
  parse(headerFile: string, dataFile: string): ECGData | null {
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

      const leadNames: string[] = [];
      for (let index = 1; index < normalizedLines.length; index += 1) {
        const line = normalizedLines[index];
        const tokens = line.split(/\s+/);
        if (tokens.length === 0) {
          continue;
        }

        const recordName = tokens[0];
        const signalNameToken = tokens.slice(7).join(' ');
        if (signalNameToken) {
          leadNames.push(signalNameToken.trim());
        } else if (recordName) {
          leadNames.push(`Ch${index - 1}`);
        }
      }

      while (leadNames.length < numLeads) {
        leadNames.push(`Ch${leadNames.length}`);
      }

      const bytes = new Uint8Array(dataFile.length);
      for (let index = 0; index < dataFile.length; index += 1) {
        bytes[index] = dataFile.charCodeAt(index) & 0xff;
      }

      if (bytes.length < numLeads * 2) {
        return null;
      }

      const sampleCount = Math.min(numSamples, Math.floor(bytes.length / 2 / numLeads));
      if (sampleCount <= 0) {
        return null;
      }

      const dataView = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

      const leads: ECGLead[] = [];
      for (let ch = 0; ch < numLeads; ch++) {
        const channelData: number[] = [];
        for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex += 1) {
          const offset = (sampleIndex * numLeads + ch) * 2;
          if (offset + 2 > dataView.byteLength) {
            break;
          }
          channelData.push(dataView.getInt16(offset, true) / 32768);
        }
        leads.push({
          name: leadNames[ch] || `Ch${ch}`,
          data: channelData,
          samplingRate
        });
      }

      return {
        leads,
        duration: sampleCount / samplingRate,
        samplingRate
      };
    } catch (error) {
      console.error('WFDB parsing error:', error);
      return null;
    }
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
