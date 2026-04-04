import { mockDiagnosisStats, mockPatients, mockRecentActivities, getPatientSummary } from '../data/mockClinic';
import { ECGRecord, Patient } from '../types';

const API_BASE_URL = 'http://localhost:4000/api';

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
    sourceLabel: '本地 mock 数据',
    metrics: [
      {
        title: '总病例数',
        value: patients.length,
        note: '本地兜底数据',
        accent: 'metric-card--blue',
      },
      {
        title: '总心电图数',
        value: totalRecords,
        note: '本地兜底记录数',
        accent: 'metric-card--teal',
      },
      {
        title: '已标注',
        value: annotated,
        note: '本地兜底标注数',
        accent: 'metric-card--amber',
      },
      {
        title: '待处理',
        value: Math.max(totalRecords - annotated, 0),
        note: '本地兜底待处理数',
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
    sourceLabel: '本地 mock 数据',
    patient,
    record,
  };
};

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
    ...init,
  });

  if (!response.ok) {
    throw new Error(`Request failed with status ${response.status}`);
  }

  return response.json() as Promise<T>;
}

const isNetworkError = (error: unknown): boolean =>
  error instanceof Error &&
  (error.name === 'TypeError' ||
    error.message.includes('fetch') ||
    error.message.includes('Failed to fetch') ||
    error.message.includes('NetworkError'));

export async function getDashboardOverview(): Promise<DashboardOverview> {
  try {
    return await requestJson<DashboardOverview>('/dashboard');
  } catch (error) {
    if (isNetworkError(error)) {
      return buildFallbackDashboard();
    }
    throw error;
  }
}

export async function getPatients(): Promise<PatientsResponse> {
  try {
    return await requestJson<PatientsResponse>('/patients');
  } catch (error) {
    if (isNetworkError(error)) {
      return {
        sourceLabel: '本地 mock 数据',
        patients: buildFallbackPatients(),
      };
    }
    throw error;
  }
}

export async function getPatientBundle(patientId: string): Promise<PatientBundle> {
  try {
    return await requestJson<PatientBundle>(`/patients/${encodeURIComponent(patientId)}`);
  } catch (error) {
    if (isNetworkError(error)) {
      return buildFallbackBundle(patientId);
    }
    throw error;
  }
}

export async function createPatient(input: CreatePatientInput): Promise<Patient> {
  try {
    const response = await requestJson<{ patient: Patient }>('/patients', {
      method: 'POST',
      body: JSON.stringify(input),
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
