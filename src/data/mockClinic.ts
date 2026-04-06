import ptbxlBackup from './ptbxlBackup.json';
import { ECGRecord, Patient } from '../types';

type BackupLeadTemplate = {
  name: string;
  scale: number;
  phase: number;
  baseline: number;
};

type BackupRecord = {
  id: string;
  patientId: string;
  deviceId: string;
  timestamp: string;
  duration: number;
  samplingRate: number;
  signalQuality: number;
  diagnosis: {
    label: string;
    confidence: number;
  };
  leadSet: BackupLeadTemplate[];
};

type BackupPatient = {
  id: string;
  name: string;
  age: number;
  gender: Patient['gender'];
  createdAt: string;
  updatedAt: string;
  record: BackupRecord;
};

type BackupPayload = {
  patients: BackupPatient[];
  dashboard: {
    recentActivities: string[];
    diagnosisStats: Array<{ name: string; value: number; color: string }>;
  };
};

const backupData = ptbxlBackup as BackupPayload;

const buildLead = (template: BackupLeadTemplate): ECGRecord['leads'][number] => ({
  name: template.name,
  data: Array.from(
    { length: 1000 },
    (_, index) => Math.sin(index * 0.08 + template.phase) * template.scale + template.baseline
  ),
  samplingRate: 500,
});

const buildPatient = (patient: BackupPatient): Patient => ({
  id: patient.id,
  name: patient.name,
  age: patient.age,
  gender: patient.gender,
  createdAt: patient.createdAt,
  updatedAt: patient.updatedAt,
  records: [
    {
      id: patient.record.id,
      patientId: patient.record.patientId,
      deviceId: patient.record.deviceId,
      timestamp: patient.record.timestamp,
      duration: patient.record.duration,
      samplingRate: patient.record.samplingRate,
      leads: patient.record.leadSet.map(buildLead),
      annotations: [],
      signalQuality: patient.record.signalQuality,
      diagnosis: patient.record.diagnosis,
    },
  ],
});

export const mockPatients: Patient[] = backupData.patients.map(buildPatient);

export const mockRecordsByPatientId: Record<string, ECGRecord> = Object.fromEntries(
  mockPatients.map((patient) => [patient.id, patient.records[0]])
);

export const mockRecentActivities = backupData.dashboard.recentActivities;

export const mockDiagnosisStats = backupData.dashboard.diagnosisStats;

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
