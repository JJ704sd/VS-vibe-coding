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
      const arrayBuffer = await file.arrayBuffer();
      const format = detectFormat(arrayBuffer);

      if (format === 'unknown') {
        return { success: false, error: 'Unsupported file format' };
      }

      const ecgData = parseECG(arrayBuffer);
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
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
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
