import { ECGRecord, Patient } from '../types';

export const mockPatients: Patient[] = [
  {
    id: 'P001',
    name: '张三',
    age: 65,
    gender: 'M',
    records: [],
    createdAt: '2026-01-15T10:00:00Z',
    updatedAt: '2026-03-25T10:30:00Z',
  },
  {
    id: 'P002',
    name: '李四',
    age: 58,
    gender: 'F',
    records: [],
    createdAt: '2026-02-10T08:00:00Z',
    updatedAt: '2026-03-20T08:15:00Z',
  },
  {
    id: 'P003',
    name: '王五',
    age: 72,
    gender: 'M',
    records: [],
    createdAt: '2026-03-01T14:00:00Z',
    updatedAt: '2026-03-15T12:05:00Z',
  },
];

const buildLead = (name: string, phase: number, amplitude: number): ECGRecord['leads'][number] => ({
  name,
  data: Array.from({ length: 1000 }, (_, index) => Math.sin(index * 0.08 + phase) * amplitude),
  samplingRate: 500,
});

export const mockRecordsByPatientId: Record<string, ECGRecord> = {
  P001: {
    id: 'R001',
    patientId: 'P001',
    deviceId: 'HUAWEI WATCH GT3',
    timestamp: '2026-03-25T10:30:00Z',
    leads: [buildLead('I', 0, 0.5), buildLead('II', 0.4, 0.4), buildLead('V1', 0.8, 0.3)],
    duration: 10,
    samplingRate: 500,
    annotations: [],
    signalQuality: 85,
    diagnosis: {
      label: '房颤',
      confidence: 0.92,
    },
  },
  P002: {
    id: 'R002',
    patientId: 'P002',
    deviceId: 'ECG Patch Pro',
    timestamp: '2026-03-20T08:15:00Z',
    leads: [buildLead('I', 0.1, 0.32), buildLead('II', 0.35, 0.34), buildLead('V1', 0.7, 0.22)],
    duration: 10,
    samplingRate: 500,
    annotations: [],
    signalQuality: 91,
    diagnosis: {
      label: '正常',
      confidence: 0.88,
    },
  },
  P003: {
    id: 'R003',
    patientId: 'P003',
    deviceId: 'Portable ECG',
    timestamp: '2026-03-15T12:05:00Z',
    leads: [buildLead('I', 0.2, 0.48), buildLead('II', 0.5, 0.36), buildLead('V1', 0.9, 0.28)],
    duration: 10,
    samplingRate: 500,
    annotations: [],
    signalQuality: 79,
    diagnosis: {
      label: '室上性心动过速',
      confidence: 0.84,
    },
  },
};

export const mockRecentActivities = [
  '张三 - 房颤标注完成 - 2 小时前',
  '李四 - 新增心电图 - 3 小时前',
  '王五 - 标注审核通过 - 5 小时前',
  '赵六 - 批量导入 WFDB - 7 小时前',
];

export const mockDiagnosisStats = [
  { name: '正常', value: 45, color: 'green' },
  { name: '房颤', value: 25, color: 'red' },
  { name: '室上性心动过速', value: 15, color: 'orange' },
  { name: '其他', value: 15, color: 'blue' },
];

export const getPatientSummary = (patientId?: string) => {
  if (!patientId) {
    return null;
  }

  const patient = mockPatients.find((item) => item.id === patientId);
  const record = mockRecordsByPatientId[patientId];

  if (!patient || !record) {
    return null;
  }

  return {
    patient,
    record,
  };
};
