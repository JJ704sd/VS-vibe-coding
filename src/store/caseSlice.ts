import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import { Patient, ECGRecord } from '../types';

interface CasesState {
  patients: Patient[];
  currentPatient: Patient | null;
  currentRecord: ECGRecord | null;
  searchQuery: string;
  filters: {
    dateRange: [string, string] | null;
    diagnosis: string | null;
    deviceType: string | null;
  };
  pagination: {
    page: number;
    pageSize: number;
    total: number;
  };
  loading: boolean;
  error: string | null;
}

const initialState: CasesState = {
  patients: [],
  currentPatient: null,
  currentRecord: null,
  searchQuery: '',
  filters: {
    dateRange: null,
    diagnosis: null,
    deviceType: null,
  },
  pagination: {
    page: 1,
    pageSize: 20,
    total: 0,
  },
  loading: false,
  error: null,
};

const casesSlice = createSlice({
  name: 'cases',
  initialState,
  reducers: {
    setPatients: (state, action: PayloadAction<Patient[]>) => {
      state.patients = action.payload;
    },
    addPatient: (state, action: PayloadAction<Patient>) => {
      state.patients.push(action.payload);
    },
    updatePatient: (state, action: PayloadAction<Patient>) => {
      const index = state.patients.findIndex(p => p.id === action.payload.id);
      if (index !== -1) {
        state.patients[index] = action.payload;
      }
    },
    removePatient: (state, action: PayloadAction<string>) => {
      state.patients = state.patients.filter(p => p.id !== action.payload);
    },
    setCurrentPatient: (state, action: PayloadAction<Patient | null>) => {
      state.currentPatient = action.payload;
    },
    setCurrentRecord: (state, action: PayloadAction<ECGRecord | null>) => {
      state.currentRecord = action.payload;
    },
    addRecordToPatient: (state, action: PayloadAction<{ patientId: string; record: ECGRecord }>) => {
      const patient = state.patients.find(p => p.id === action.payload.patientId);
      if (patient) {
        patient.records.push(action.payload.record);
      }
    },
    setSearchQuery: (state, action: PayloadAction<string>) => {
      state.searchQuery = action.payload;
    },
    setFilters: (state, action: PayloadAction<Partial<CasesState['filters']>>) => {
      state.filters = { ...state.filters, ...action.payload };
    },
    clearFilters: (state) => {
      state.filters = initialState.filters;
    },
    setPagination: (state, action: PayloadAction<Partial<CasesState['pagination']>>) => {
      state.pagination = { ...state.pagination, ...action.payload };
    },
    setLoading: (state, action: PayloadAction<boolean>) => {
      state.loading = action.payload;
    },
    setError: (state, action: PayloadAction<string | null>) => {
      state.error = action.payload;
    },
    clearCases: () => {
      return { ...initialState };
    },
  },
});

export const {
  setPatients,
  addPatient,
  updatePatient,
  removePatient,
  setCurrentPatient,
  setCurrentRecord,
  addRecordToPatient,
  setSearchQuery,
  setFilters,
  clearFilters,
  setPagination,
  setLoading,
  setError,
  clearCases,
} = casesSlice.actions;

export default casesSlice.reducer;