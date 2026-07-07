import { ECGLead, ECGRecord, SignalProcessorConfig } from '../types';
import { parseECG, detectFormat } from '../utils/dicomParser';
import { SignalProcessor, extractFeatures } from '../utils/signalProcessor';

export interface ParseOptions {
  removeBaseline?: boolean;
  normalize?: boolean;
  filterBand?: [number, number];
}

export interface ImportResult {
  success: boolean;
  record?: ECGRecord;
  error?: string;
}

class ECGParserService {
  async parseFile(file: File, options?: ParseOptions): Promise<ImportResult> {
    try {
      const lowerName = (file.name || '').toLowerCase();

      // A-05: `.hl7` is text. Decode as UTF-8 and route through the HL7
      // parser instead of the ArrayBuffer/DICOM path. Without this branch
      // `detectFormat(ArrayBuffer)` returns 'unknown' for HL7 and the file
      // is rejected as "Unsupported file format".
      if (lowerName.endsWith('.hl7')) {
        const text = await file.text();
        const ecgData = parseECG(text);
        if (!ecgData) {
          return { success: false, error: 'Failed to parse HL7 message' };
        }
        return this.buildRecord(ecgData, options);
      }

      const arrayBuffer = await file.arrayBuffer();
      const format = detectFormat(arrayBuffer, file.name);

      if (format === 'unknown') {
        return { success: false, error: 'Unsupported file format' };
      }

      // C-15: a lone `.dat` cannot be parsed without its `.hea` sibling.
      // Surface a clear error so the caller can prompt for the pair.
      if (format === 'wfdb') {
        return {
          success: false,
          error: 'WFDB .dat requires the matching .hea — please upload both files',
        };
      }

      const ecgData = parseECG(arrayBuffer, { fileName: file.name });
      if (!ecgData) {
        return { success: false, error: 'Failed to parse ECG data' };
      }

      return this.buildRecord(ecgData, options);
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Parse a WFDB record pair (.hea + .dat) provided as two `File` objects.
   * Returns the same `ImportResult` shape as `parseFile` so the UI can
   * treat them uniformly.
   */
  async parseWfdbPair(heaFile: File, datFile: File, options?: ParseOptions): Promise<ImportResult> {
    try {
      const [heaBuffer, datBuffer] = await Promise.all([
        heaFile.arrayBuffer(),
        datFile.arrayBuffer(),
      ]);
      const ecgData = parseECG(new ArrayBuffer(0), {
        heaBuffer,
        datBuffer,
      });
      if (!ecgData) {
        return { success: false, error: 'Failed to parse WFDB pair' };
      }
      return this.buildRecord(ecgData, options);
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  private buildRecord(ecgData: ReturnType<typeof parseECG>, options?: ParseOptions): ImportResult {
    if (!ecgData) {
      return { success: false, error: 'Failed to parse ECG data' };
    }
    const processedLeads = this.processLeads(ecgData.leads, options);
    const sampleLead = processedLeads[0];
    const features = extractFeatures(sampleLead?.data || [], ecgData.samplingRate);
    return {
      success: true,
      record: {
        id: this.generateId(),
        patientId: ecgData.patientInfo?.id || '',
        deviceId: ecgData.deviceInfo?.model || 'Unknown Device',
        timestamp: new Date().toISOString(),
        leads: processedLeads,
        duration: ecgData.duration,
        samplingRate: ecgData.samplingRate,
        annotations: [],
        signalQuality: features.signalQuality,
      },
    };
  }

  async parseJSON(jsonString: string): Promise<ImportResult> {
    try {
      const data = JSON.parse(jsonString);
      if (!data.leads || !Array.isArray(data.leads)) {
        return { success: false, error: 'Invalid JSON format' };
      }

      const leads: ECGLead[] = data.leads.map((lead: Partial<ECGLead>) => ({
        name: lead.name || 'I',
        data: Array.isArray(lead.data) ? lead.data : [],
        samplingRate: lead.samplingRate || 500,
      }));

      return {
        success: true,
        record: {
          id: this.generateId(),
          patientId: data.patientId || '',
          deviceId: data.deviceId || 'Imported',
          timestamp: data.timestamp || new Date().toISOString(),
          leads,
          duration: data.duration || leads[0]?.data.length / (leads[0]?.samplingRate || 500),
          samplingRate: leads[0]?.samplingRate || 500,
          annotations: [],
          signalQuality: 80,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Invalid JSON',
      };
    }
  }

  private processLeads(leads: ECGLead[], options?: ParseOptions): ECGLead[] {
    if (!options?.removeBaseline && !options?.normalize && !options?.filterBand) {
      return leads;
    }

    const config: SignalProcessorConfig = {
      samplingRate: leads[0]?.samplingRate || 500,
      filterBand: options?.filterBand || [0.5, 50],
      removeBaseline: options?.removeBaseline || false,
      normalize: options?.normalize || false,
    };

    return new SignalProcessor(config).process(leads);
  }

  private generateId(): string {
    return `ECG_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  }
}

export const ecgParserService = new ECGParserService();
export default ECGParserService;
