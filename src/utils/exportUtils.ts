import { ECGRecord, ExportOptions } from '../types';

export function exportToJSON(record: ECGRecord, options?: ExportOptions): string {
  const data: any = {
    id: record.id,
    patientId: record.patientId,
    deviceId: record.deviceId,
    timestamp: record.timestamp,
    duration: record.duration,
    samplingRate: record.samplingRate,
    signalQuality: record.signalQuality
  };

  if (options?.includeMetadata !== false) {
    data.leads = record.leads.map(lead => ({
      name: lead.name,
      data: lead.data,
      samplingRate: lead.samplingRate
    }));
  }

  if (options?.includeAnnotations !== false) {
    data.annotations = record.annotations;
  }

  if (options?.includeDiagnosis !== false && record.diagnosis) {
    data.diagnosis = record.diagnosis;
  }

  return JSON.stringify(data, null, 2);
}

export function exportToCSV(record: ECGRecord): string {
  const lines: string[] = [];
  
  lines.push('ECG Record Export');
  lines.push(`ID,${record.id}`);
  lines.push(`Patient ID,${record.patientId}`);
  lines.push(`Device,${record.deviceId}`);
  lines.push(`Timestamp,${record.timestamp}`);
  lines.push(`Duration,${record.duration}s`);
  lines.push(`Sampling Rate,${record.samplingRate}Hz`);
  lines.push(`Signal Quality,${record.signalQuality}%`);
  
  if (record.diagnosis) {
    lines.push(`Diagnosis,${record.diagnosis.label}`);
    lines.push(`Confidence,${(record.diagnosis.confidence * 100).toFixed(1)}%`);
  }
  
  lines.push('');
  lines.push('Annotations');
  lines.push('Type,Position,Confidence,Manual');
  
  for (const ann of record.annotations) {
    lines.push(`${ann.type},${ann.position},${ann.confidence.toFixed(2)},${ann.manual}`);
  }
  
  lines.push('');
  lines.push('Lead Data');
  
  const header = ['Sample', ...record.leads.map(l => l.name)].join(',');
  lines.push(header);
  
  const numSamples = record.leads[0]?.data.length || 0;
  for (let i = 0; i < numSamples; i++) {
    const row = [i, ...record.leads.map(lead => lead.data[i]?.toFixed(4) || 0)];
    lines.push(row.join(','));
  }

  return lines.join('\n');
}

export function exportToTCX(record: ECGRecord): string {
  const startTime = new Date(record.timestamp).toISOString();
  
  let tcx = `<?xml version="1.0" encoding="UTF-8"?>
<TrainingCenterDatabase xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2">
  <Activities>
    <Activity Sport="Running">
      <Id>${startTime}</Id>
      <Notes>ECG Record: ${record.id}</Notes>
      <Lap StartTime="${startTime}">
        <TotalTimeSeconds>${record.duration}</TotalTimeSeconds>
        <DistanceMeters>0</DistanceMeters>
        <Calories>0</Calories>
        <AverageHeartRateBpm>
          <Value>${Math.round(record.signalQuality * 1.2)}</Value>
        </AverageHeartRateBpm>
        <Track>
`;

  const numSamples = Math.min(record.leads[0]?.data.length || 0, 500);
  const step = Math.max(1, Math.floor(numSamples / 100));
  
  for (let i = 0; i < numSamples; i += step) {
    const time = (i / record.samplingRate).toFixed(2);
    const leadII = record.leads.find(l => l.name === 'II')?.data[i] || 0;
    
    tcx += `          <Trackpoint>
            <Time>1970-01-01T00:00:${time}z</Time>
            <HeartRateBpm>
              <Value>${Math.round(60 + leadII * 40)}</Value>
            </HeartRateBpm>
          </Trackpoint>
`;
  }

  tcx += `        </Track>
      </Lap>
    </Activity>
  </Activities>
</TrainingCenterDatabase>`;

  return tcx;
}

export function downloadFile(content: string, filename: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  
  URL.revokeObjectURL(url);
}

export function exportRecord(record: ECGRecord, options: ExportOptions): void {
  let content: string;
  let filename: string;
  let mimeType: string;

  switch (options.format) {
    case 'json':
      content = exportToJSON(record, options);
      filename = `${record.id}.json`;
      mimeType = 'application/json';
      break;
      
    case 'csv':
      content = exportToCSV(record);
      filename = `${record.id}.csv`;
      mimeType = 'text/csv';
      break;
      
    case 'tcx':
      content = exportToTCX(record);
      filename = `${record.id}.tcx`;
      mimeType = 'application/vnd.garmin.tcx+xml';
      break;
      
    default:
      content = exportToJSON(record, options);
      filename = `${record.id}.json`;
      mimeType = 'application/json';
  }

  downloadFile(content, filename, mimeType);
}

export function importFromJSON(jsonString: string): ECGRecord | null {
  try {
    const data = JSON.parse(jsonString);
    
    if (!data.id || !data.leads) {
      throw new Error('Invalid ECG data format');
    }

    return {
      id: data.id,
      patientId: data.patientId || '',
      deviceId: data.deviceId || 'Unknown',
      timestamp: data.timestamp || new Date().toISOString(),
      leads: data.leads.map((lead: any) => ({
        name: lead.name,
        data: lead.data,
        samplingRate: lead.samplingRate || 500
      })),
      duration: data.duration || 0,
      samplingRate: data.samplingRate || 500,
      annotations: data.annotations || [],
      signalQuality: data.signalQuality || 0,
      diagnosis: data.diagnosis
    };
  } catch (error) {
    console.error('Import error:', error);
    return null;
  }
}