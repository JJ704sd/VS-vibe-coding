export interface Annotation {
  id: string;
  type: 'P' | 'Q' | 'R' | 'S' | 'T' | 'ST' | 'U';
  position: number;
  confidence: number;
  manual: boolean;
  timestamp?: number;
  x?: number;
  y?: number;
}

export interface ECGLead {
  name: string;
  data: number[];
  samplingRate: number;
}

export interface ECGRecord {
  id: string;
  patientId: string;
  deviceId: string;
  timestamp: string;
  leads: ECGLead[];
  duration: number;
  samplingRate: number;
  annotations: Annotation[];
  signalQuality: number;
  diagnosis?: {
    label: string;
    confidence: number;
  };
}

export interface Patient {
  id: string;
  name: string;
  age: number;
  gender: 'M' | 'F';
  records: ECGRecord[];
  createdAt: string;
  updatedAt: string;
}

export interface ModelPrediction {
  className: string;
  probability: number;
  heatmap?: number[];
}

export interface CanvasState {
  zoom: number;
  panX: number;
  panY: number;
  selectedLead: string | null;
  selectedAnnotation: string | null;
}

export interface AppState {
  patients: Patient[];
  currentPatient: Patient | null;
  currentRecord: ECGRecord | null;
  canvas: CanvasState;
  modelLoading: boolean;
  inferenceResults: ModelPrediction[];
  offlineMode: boolean;
}

export interface DrawOptions {
  color: string;
  lineWidth: number;
  opacity: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface LeadLayout {
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface WaveformLayerConfig {
  gridVisible: boolean;
  gridColor: string;
  gridSize: number;
  backgroundColor: string;
  amplitude: number;
  timeScale: number;
}

export interface AnnotationLayerConfig {
  markerRadius: number;
  markerColor: string;
  labelFontSize: number;
  labelColor: string;
  showConfidence: boolean;
}

export interface CommentLayerConfig {
  fontFamily: string;
  fontSize: number;
  color: string;
  backgroundColor: string;
  padding: number;
}

export interface ECGPanelConfig {
  width: number;
  height: number;
  leadLayout: LeadLayout[];
  waveformConfig: WaveformLayerConfig;
  annotationConfig: AnnotationLayerConfig;
  commentConfig: CommentLayerConfig;
}

export interface SignalProcessorConfig {
  samplingRate: number;
  filterBand: [number, number];
  removeBaseline: boolean;
  normalize: boolean;
}

export interface ECGParserResult {
  success: boolean;
  data?: ECGData;
  error?: string;
}

export interface ECGData {
  leads: ECGLead[];
  duration: number;
  samplingRate: number;
  patientInfo?: PatientInfo;
  deviceInfo?: DeviceInfo;
}

export interface PatientInfo {
  id?: string;
  name?: string;
  age?: number;
  gender?: string;
}

export interface DeviceInfo {
  manufacturer?: string;
  model?: string;
  serialNumber?: string;
}

export interface ModelConfig {
  url: string;
  inputShape: number[];
  outputClasses: string[];
  quantization?: 'float32' | 'float16' | 'int8';
}

export interface InferenceResult {
  predictions: ModelPrediction[];
  inferenceTime: number;
  heatmap?: number[][];
}

export interface FirebaseConfig {
  apiKey: string;
  projectId: string;
  storageBucket: string;
  messagingSenderId: string;
  appId: string;
}

export interface ExportOptions {
  format: 'json' | 'csv' | 'tcx' | 'pdf';
  includeAnnotations: boolean;
  includeDiagnosis: boolean;
  includeMetadata: boolean;
}

export interface ECGSummary {
  heartRate: number;
  rhythm: string;
  prInterval: number;
  qrsDuration: number;
  qtInterval: number;
  qtCorrected: number;
}

export interface DiagnosticReport {
  id: string;
  patientId: string;
  recordId: string;
  timestamp: string;
  summary: ECGSummary;
  diagnosis: string;
  confidence: number;
  annotations: Annotation[];
  aiGenerated: boolean;
}

export interface UploadFile {
  id: string;
  name: string;
  size: number;
  type: string;
  lastModified: number;
  status: 'pending' | 'uploading' | 'success' | 'error';
  progress?: number;
  error?: string;
}

export interface TimelineEvent {
  id: string;
  patientId: string;
  recordId?: string;
  type: 'create' | 'update' | 'delete' | 'annotate' | 'diagnose' | 'export';
  description: string;
  timestamp: string;
  userId?: string;
}