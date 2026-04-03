import { ECGLead, SignalProcessorConfig } from '../types';

export class SignalProcessor {
  private config: SignalProcessorConfig;

  constructor(config: SignalProcessorConfig) {
    this.config = config;
  }

  process(leads: ECGLead[]): ECGLead[] {
    return leads.map(lead => ({
      ...lead,
      data: this.processSignal(lead.data)
    }));
  }

  private processSignal(data: number[]): number[] {
    let result = [...data];

    if (this.config.removeBaseline) {
      result = this.removeBaseline(result);
    }

    if (this.config.normalize) {
      result = this.normalize(result);
    }

    result = this.bandpassFilter(result);

    return result;
  }

  private removeBaseline(data: number[]): number[] {
    const windowSize = Math.floor(this.config.samplingRate * 0.2);
    const result = [...data];
    
    for (let i = 0; i < result.length; i++) {
      const start = Math.max(0, i - windowSize);
      const end = Math.min(data.length, i + windowSize);
      let sum = 0;
      for (let j = start; j < end; j++) {
        sum += data[j];
      }
      result[i] = data[i] - sum / (end - start);
    }
    
    return result;
  }

  private normalize(data: number[]): number[] {
    const max = Math.max(...data.map(Math.abs));
    if (max === 0) return data;
    return data.map(v => v / max);
  }

  private bandpassFilter(data: number[]): number[] {
    const [lowFreq, highFreq] = this.config.filterBand;
    const fs = this.config.samplingRate;
    const n = data.length;
    const result = new Array(n);

    const wc = 2 * highFreq / fs;
    const wcLow = 2 * lowFreq / fs;

    for (let i = 0; i < n; i++) {
      const t = i / fs;
      const highPass = Math.sin(2 * Math.PI * lowFreq * t);
      const lowPass = Math.sin(2 * Math.PI * highFreq * t);
      
      let sum = 0;
      const kernelSize = Math.floor(0.1 * fs);
      
      for (let j = -kernelSize; j <= kernelSize; j++) {
        if (i + j >= 0 && i + j < n) {
          const gaussian = Math.exp(-(j * j) / (2 * (kernelSize / 3) * (kernelSize / 3)));
          sum += data[i + j] * gaussian;
        }
      }
      
      result[i] = sum;
    }

    return result;
  }
}

export function calculateRMSSD(rrIntervals: number[]): number {
  if (rrIntervals.length < 2) return 0;
  
  let sum = 0;
  for (let i = 1; i < rrIntervals.length; i++) {
    const diff = rrIntervals[i] - rrIntervals[i - 1];
    sum += diff * diff;
  }
  
  return Math.sqrt(sum / (rrIntervals.length - 1));
}

export function calculateHeartRate(rrIntervals: number[]): number {
  if (rrIntervals.length === 0) return 0;
  
  const avgRR = rrIntervals.reduce((a, b) => a + b, 0) / rrIntervals.length;
  return Math.round(60000 / avgRR);
}

export function findRPeaks(data: number[], threshold: number = 0.5): number[] {
  const peaks: number[] = [];
  const signal = data.map(Math.abs);
  const max = Math.max(...signal);
  const normalized = signal.map(v => v / max);

  let inPeak = false;
  let peakStart = 0;

  for (let i = 0; i < normalized.length; i++) {
    if (normalized[i] > threshold && !inPeak) {
      inPeak = true;
      peakStart = i;
    } else if (normalized[i] < threshold * 0.5 && inPeak) {
      inPeak = false;
      let maxIdx = peakStart;
      for (let j = peakStart; j < i; j++) {
        if (normalized[j] > normalized[maxIdx]) {
          maxIdx = j;
        }
      }
      peaks.push(maxIdx);
    }
  }

  return peaks;
}

export function calculateSignalQuality(data: number[]): number {
  const amplitude = Math.max(...data) - Math.min(...data);
  if (amplitude < 0.1) return 0;

  const mean = data.reduce((a, b) => a + b, 0) / data.length;
  const variance = data.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / data.length;
  
  const baseline = data.slice(0, 100).reduce((a, b) => a + b, 0) / 100;
  const drift = Math.abs(data[data.length - 1] - baseline) / amplitude;
  
  const snr = 10 * Math.log10(variance / (drift * drift + 0.01));
  const quality = Math.min(100, Math.max(0, (snr + 20) * 2.5));
  
  return Math.round(quality);
}

export function extractFeatures(data: number[], samplingRate: number): {
  heartRate: number;
  rmssd: number;
  sdnn: number;
  signalQuality: number;
} {
  const rrPeaks = findRPeaks(data);
  const rrIntervals: number[] = [];
  
  for (let i = 1; i < rrPeaks.length; i++) {
    rrIntervals.push((rrPeaks[i] - rrPeaks[i - 1]) / samplingRate * 1000);
  }

  const heartRate = calculateHeartRate(rrIntervals);
  const rmssd = calculateRMSSD(rrIntervals);
  
  const meanRR = rrIntervals.reduce((a, b) => a + b, 0) / rrIntervals.length;
  const sdnn = Math.sqrt(
    rrIntervals.reduce((sum, rr) => sum + Math.pow(rr - meanRR, 2), 0) / rrIntervals.length
  );

  const signalQuality = calculateSignalQuality(data);

  return {
    heartRate: isNaN(heartRate) ? 0 : heartRate,
    rmssd: isNaN(rmssd) ? 0 : rmssd,
    sdnn: isNaN(sdnn) ? 0 : sdnn,
    signalQuality
  };
}

export function downsample(data: number[], factor: number): number[] {
  const result: number[] = [];
  for (let i = 0; i < data.length; i += factor) {
    let sum = 0;
    let count = 0;
    for (let j = i; j < Math.min(i + factor, data.length); j++) {
      sum += data[j];
      count++;
    }
    result.push(sum / count);
  }
  return result;
}

export function upsample(data: number[], factor: number): number[] {
  const result: number[] = [];
  for (let i = 0; i < data.length; i++) {
    result.push(data[i]);
    if (i < data.length - 1) {
      const diff = data[i + 1] - data[i];
      for (let j = 1; j < factor; j++) {
        result.push(data[i] + (diff * j) / factor);
      }
    }
  }
  return result;
}

export function resample(data: number[], fromRate: number, toRate: number): number[] {
  if (fromRate === toRate) return data;
  
  const factor = toRate > fromRate ? toRate / fromRate : fromRate / toRate;
  
  if (toRate > fromRate) {
    return upsample(data, Math.round(factor));
  } else {
    return downsample(data, Math.round(factor));
  }
}