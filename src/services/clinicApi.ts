import { mockDiagnosisStats, mockPatients, mockRecentActivities, getPatientSummary } from '../data/mockClinic';
import { ECGRecord, Patient } from '../types';
import { CLINIC_API_BASE_URL } from '../config/env.ts';
import { isNetworkError, requestJson } from './httpClient';

const API_BASE_URL = CLINIC_API_BASE_URL;
const BACKUP_SOURCE_LABEL = 'PTB-XL 20 条备份';

export interface DashboardMetric {
  title: string;
  value: number;
  note: string;
  accent: string;
}

export interface DashboardOverview {
  sourceLabel: string;
  metrics: DashboardMetric[];
  recentActivities: string[];
  diagnosisStats: Array<{ name: string; value: number; color: string }>;
}

export interface PatientsResponse {
  sourceLabel: string;
  patients: Patient[];
}

export interface PatientBundle {
  sourceLabel: string;
  patient: Patient | null;
  record: ECGRecord | null;
}

export interface CreatePatientInput {
  name: string;
  age: number;
  gender: 'M' | 'F';
}

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const buildPatientWithRecord = (patientId: string): Patient | null => {
  const summary = getPatientSummary(patientId);
  if (!summary) {
    const matchedPatient = mockPatients.find((item) => item.id === patientId);
    if (!matchedPatient) {
      return null;
    }

    return clone({
      ...matchedPatient,
      records: [],
    });
  }

  return clone({
    ...summary.patient,
    records: [summary.record],
  });
};

const buildFallbackPatients = (): Patient[] =>
  mockPatients
    .map((patient) => buildPatientWithRecord(patient.id))
    .filter((patient): patient is Patient => patient !== null);

const buildFallbackDashboard = (): DashboardOverview => {
  const patients = buildFallbackPatients();
  const totalRecords = patients.reduce((sum, patient) => sum + patient.records.length, 0);
  const annotated = patients.reduce(
    (sum, patient) => sum + patient.records.filter((record) => record.annotations.length > 0).length,
    0
  );

  return {
    sourceLabel: BACKUP_SOURCE_LABEL,
    metrics: [
      {
        title: '患者总数',
        value: patients.length,
        note: '来自本地 PTB-XL 备份',
        accent: 'metric-card--blue',
      },
      {
        title: '总心电图数',
        value: totalRecords,
        note: '已展开的记录总数',
        accent: 'metric-card--teal',
      },
      {
        title: '已标注',
        value: annotated,
        note: '已完成结构化标注',
        accent: 'metric-card--amber',
      },
      {
        title: '待处理',
        value: Math.max(totalRecords - annotated, 0),
        note: '仍可继续处理的记录',
        accent: 'metric-card--rose',
      },
    ],
    recentActivities: mockRecentActivities,
    diagnosisStats: mockDiagnosisStats,
  };
};

const buildFallbackBundle = (patientId: string): PatientBundle => {
  const patient = buildPatientWithRecord(patientId);
  const record = patient?.records[0] || null;

  return {
    sourceLabel: BACKUP_SOURCE_LABEL,
    patient,
    record,
  };
};

export async function getDashboardOverview(): Promise<DashboardOverview> {
  try {
    return await requestJson<DashboardOverview>({
      baseUrl: API_BASE_URL,
      path: '/dashboard',
    });
  } catch (error) {
    if (isNetworkError(error)) {
      return buildFallbackDashboard();
    }
    throw error;
  }
}

export async function getPatients(): Promise<PatientsResponse> {
  try {
    return await requestJson<PatientsResponse>({
      baseUrl: API_BASE_URL,
      path: '/patients',
    });
  } catch (error) {
    if (isNetworkError(error)) {
      return {
        sourceLabel: BACKUP_SOURCE_LABEL,
        patients: buildFallbackPatients(),
      };
    }
    throw error;
  }
}

export async function getPatientBundle(patientId: string): Promise<PatientBundle> {
  try {
    return await requestJson<PatientBundle>({
      baseUrl: API_BASE_URL,
      path: `/patients/${encodeURIComponent(patientId)}`,
    });
  } catch (error) {
    if (isNetworkError(error)) {
      return buildFallbackBundle(patientId);
    }
    throw error;
  }
}

export async function createPatient(input: CreatePatientInput): Promise<Patient> {
  try {
    const response = await requestJson<{ patient: Patient }>({
      baseUrl: API_BASE_URL,
      path: '/patients',
      method: 'POST',
      body: input,
    });
    return response.patient;
  } catch (error) {
    if (isNetworkError(error)) {
      const patientId = `P${String(mockPatients.length + 1).padStart(3, '0')}`;
      return clone({
        id: patientId,
        name: input.name,
        age: input.age,
        gender: input.gender,
        records: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    }
    throw error;
  }
}

export async function getClinicDashboardMetrics(): Promise<DashboardOverview> {
  return getDashboardOverview();
}
