import React, { useState } from 'react';
import {
  Card,
  Row,
  Col,
  Button,
  Upload,
  message,
  List,
  Progress,
  Tag,
  Space,
  Input,
  Typography,
} from 'antd';
import {
  CloudUploadOutlined,
  RobotOutlined,
  ThunderboltOutlined,
  LinkOutlined,
} from '@ant-design/icons';
import { useEffect, useRef, useCallback } from 'react';
import { useLocation, useParams } from 'react-router-dom';
import ECGCanvas from '../components/Canvas/ECGCanvas';
import { useDispatch, useSelector } from 'react-redux';
import {
  selectModelLoading,
  selectModelLoaded,
  selectInferenceResults,
  selectAnnotationCount,
  selectAnnotationStats,
  selectAnnotations,
} from '../store/selectors';
import { setModelLoading, setModelLoaded, setInferenceResults, setAnnotations } from '../store/ecgSlice';
import { modelService } from '../services/modelService';
import { firebaseService } from '../services/firebaseService';
import { Annotation, ECGLead } from '../types';
import { ecgParserService } from '../services/ecgParser';
import { WFDBParser } from '../utils/dicomParser';
import { minimaxService } from '../services/minimaxService';
import { calculateSignalQuality, extractFeatures, findRPeaks } from '../utils/signalProcessor';
import { exportRecord } from '../utils/exportUtils';
import {
  AnnotationToolbar,
  ImportPanel,
  PlaybackControls,
  AIAnalysisPanel,
  SignalMetrics,
  AnnotationList,
  SmartAssistancePanel,
} from './components';

interface WfdbBatchRecord {
  id: string;
  leads: ECGLead[];
  createdAt: number;
}

interface ImportedRecordContext {
  patientId?: string;
  recordId?: string;
}

const ECG_CYCLE_TEMPLATE = [
  0.0, 0.02, 0.05, 0.08, 0.12, 0.08, 0.03, 0.0, -0.02, -0.03, -0.01, 0.0, 0.0, 0.02, 0.05,
  0.12, 0.28, 0.65, 1.0, 0.35, -0.22, -0.45, -0.2, 0.0, 0.02, 0.04, 0.08, 0.12, 0.14, 0.12,
  0.08, 0.03, 0.0, -0.01, 0.0, 0.0,
];

const buildLeadSignal = (
  sampleCount: number,
  scale: number,
  phaseOffset: number,
  baseline: number
): number[] => {
  const cycleLength = ECG_CYCLE_TEMPLATE.length;
  return Array.from({ length: sampleCount }, (_, index) => {
    const templateIndex = (index + phaseOffset) % cycleLength;
    const slowDrift = Math.sin(index * 0.004) * 0.03;
    const tinyNoise = Math.sin(index * 0.13) * 0.004;
    return ECG_CYCLE_TEMPLATE[templateIndex] * scale + baseline + slowDrift + tinyNoise;
  });
};

const createDemoLeads = (): ECGLead[] => {
  const sampleCount = 1800;
  return [
    { name: 'I', data: buildLeadSignal(sampleCount, 0.9, 0, 0), samplingRate: 500 },
    { name: 'II', data: buildLeadSignal(sampleCount, 1.0, 2, 0.01), samplingRate: 500 },
    { name: 'III', data: buildLeadSignal(sampleCount, 0.8, 4, -0.01), samplingRate: 500 },
    { name: 'aVR', data: buildLeadSignal(sampleCount, -0.6, 6, 0), samplingRate: 500 },
    { name: 'aVL', data: buildLeadSignal(sampleCount, 0.7, 8, 0.005), samplingRate: 500 },
    { name: 'aVF', data: buildLeadSignal(sampleCount, 0.95, 10, 0), samplingRate: 500 },
  ];
};

const INITIAL_DEMO_LEADS = createDemoLeads();

const MITBIH_RECORD_ID_PATTERN = /^\d{3}$/;
const DEFAULT_PLAYBACK_WINDOW = 1800;

const AnnotationStudio: React.FC = () => {
  const { Title, Text } = Typography;
  const location = useLocation();
  const { recordId: routeRecordId } = useParams<{ recordId?: string }>();
  const dispatch = useDispatch();
  const modelLoading = useSelector(selectModelLoading);
  const modelLoaded = useSelector(selectModelLoaded);
  const inferenceResults = useSelector(selectInferenceResults);
  const annotations = useSelector(selectAnnotations);
  const annotationStats = useSelector(selectAnnotationStats);

  const sourceLeadsRef = useRef<ECGLead[]>(INITIAL_DEMO_LEADS.map((lead) => ({ ...lead, data: [...lead.data] })));
  const [leads, setLeads] = useState<ECGLead[]>(() =>
    INITIAL_DEMO_LEADS.map((lead) => ({ ...lead, data: [...lead.data] }))
  );

  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [activeTool, setActiveTool] = useState<'pan' | 'annotate'>('pan');
  const [activeAnnotationType, setActiveAnnotationType] = useState<Annotation['type']>('P');
  const [deleteSignal, setDeleteSignal] = useState(0);
  const [githubRawUrl, setGithubRawUrl] = useState('');
  const [minimaxEndpoint, setMinimaxEndpoint] = useState('');
  const [minimaxApiKey, setMinimaxApiKey] = useState('');
  const [minimaxModel, setMinimaxModel] = useState('abab6.5s-chat');
  const [minimaxLoading, setMinimaxLoading] = useState(false);
  const [wfdbPending, setWfdbPending] = useState<
    Record<string, { hea?: File; dat?: File }>
  >({});
  const [wfdbBatches, setWfdbBatches] = useState<WfdbBatchRecord[]>([]);
  const [currentPatientId, setCurrentPatientId] = useState('');
  const [currentRecordId, setCurrentRecordId] = useState('');
  const [analysisLeadName, setAnalysisLeadName] = useState('II');
  const [peakThreshold, setPeakThreshold] = useState(0.55);
  const [playbackEnabled, setPlaybackEnabled] = useState(false);
  const [playbackCursor, setPlaybackCursor] = useState(0);
  const [playbackStep, setPlaybackStep] = useState(24);
  const [playbackWindowSize, setPlaybackWindowSize] = useState(DEFAULT_PLAYBACK_WINDOW);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const nextPatientId = params.get('patientId')?.trim();
    const nextRecordId = routeRecordId?.trim() || params.get('recordId')?.trim();

    if (nextPatientId) {
      setCurrentPatientId(nextPatientId);
    }

    if (nextRecordId) {
      setCurrentRecordId(nextRecordId);
    }
  }, [location.search, routeRecordId]);

  const cloneLeads = (inputLeads: ECGLead[]): ECGLead[] =>
    inputLeads.map((lead) => ({
      ...lead,
      data: [...lead.data],
    }));

  const buildStreamingLeads = (
    inputLeads: ECGLead[],
    cursor: number,
    stepWindowSize: number
  ): ECGLead[] => {
    if (inputLeads.length === 0) {
      return [];
    }

    const minLength = Math.min(...inputLeads.map((lead) => lead.data.length));
    if (!Number.isFinite(minLength) || minLength <= 0) {
      return cloneLeads(inputLeads);
    }

    const targetWindowSize = Math.max(300, Math.min(stepWindowSize, minLength));
    const boundedCursor = ((cursor % minLength) + minLength) % minLength;

    return inputLeads.map((lead, leadIndex) => {
      const nextData: number[] = [];
      for (let index = 0; index < targetWindowSize; index += 1) {
        const sourceIndex = (boundedCursor + index) % lead.data.length;
        const raw = lead.data[sourceIndex];
        const modulation = 1 + Math.sin((boundedCursor + index) * 0.002 + leadIndex * 0.35) * 0.018;
        const drift = Math.sin((boundedCursor + index) * 0.0009 + leadIndex * 0.7) * 0.01;
        nextData.push(raw * modulation + drift);
      }

      return {
        ...lead,
        data: nextData,
      };
    });
  };

  const applyImportedLeads = (nextLeads: ECGLead[], context?: ImportedRecordContext): void => {
    if (nextLeads.length === 0) {
      message.error('解析成功但未发现有效导联数据');
      return;
    }

    if (context?.patientId) {
      setCurrentPatientId(context.patientId);
    }
    if (context?.recordId) {
      setCurrentRecordId(context.recordId);
    }

    sourceLeadsRef.current = cloneLeads(nextLeads);
    setPlaybackCursor(0);
    if (!nextLeads.some((lead) => lead.name === analysisLeadName)) {
      setAnalysisLeadName(nextLeads[0].name);
    }
    setLeads(
      playbackEnabled
        ? buildStreamingLeads(sourceLeadsRef.current, 0, playbackWindowSize)
        : cloneLeads(sourceLeadsRef.current)
    );
    message.success(`导入成功，已加载 ${nextLeads.length} 条导联`);
  };

  useEffect(() => {
    if (!playbackEnabled) {
      setLeads(cloneLeads(sourceLeadsRef.current));
      return;
    }

    const timer = window.setInterval(() => {
      const sourceLeads = sourceLeadsRef.current;
      if (sourceLeads.length === 0) {
        return;
      }

      const minLength = Math.min(...sourceLeads.map((lead) => lead.data.length));
      if (!Number.isFinite(minLength) || minLength <= 0) {
        return;
      }

      setPlaybackCursor((previousCursor) => {
        const nextCursor = (previousCursor + playbackStep + minLength) % minLength;
        setLeads(buildStreamingLeads(sourceLeads, nextCursor, playbackWindowSize));
        return nextCursor;
      });
    }, 120);

    return () => {
      window.clearInterval(timer);
    };
  }, [playbackEnabled, playbackStep, playbackWindowSize]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null;
      const tagName = target?.tagName?.toLowerCase();
      const isEditable = tagName === 'input' || tagName === 'textarea' || target?.isContentEditable;

      if (isEditable) {
        return;
      }

      if (event.ctrlKey && event.key === '1') {
        event.preventDefault();
        handleSelectAnnotationType('P');
        return;
      }

      if (event.ctrlKey && event.key === '2') {
        event.preventDefault();
        handleSelectAnnotationType('R');
        return;
      }

      if (event.ctrlKey && event.key === '3') {
        event.preventDefault();
        handleSelectAnnotationType('T');
        return;
      }

      if (event.code === 'Space') {
        event.preventDefault();
        setPlaybackEnabled((previous) => !previous);
        return;
      }

      if (event.key === 'Escape') {
        setActiveTool('pan');
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Persist annotations to Firebase when they change
  const saveAnnotationsToFirebase = useCallback(
    async (recordId: string, annots: Annotation[]) => {
      if (!recordId || !firebaseService.isInitialized()) return;
      try {
        await firebaseService.updateRecordAnnotations(recordId, annots);
      } catch (error) {
        console.warn('[AnnotationStudio] Failed to save annotations:', error);
      }
    },
    []
  );

  useEffect(() => {
    if (!currentRecordId || currentRecordId.startsWith('local-')) return;
    const timeoutId = setTimeout(() => {
      saveAnnotationsToFirebase(currentRecordId, annotations);
    }, 1000); // Debounce saves by 1 second
    return () => clearTimeout(timeoutId);
  }, [annotations, currentRecordId, saveAnnotationsToFirebase]);

  const parseJsonTextAndApply = async (jsonText: string): Promise<void> => {
    const parsed = await ecgParserService.parseJSON(jsonText);
    if (!parsed.success || !parsed.record) {
      throw new Error(parsed.error || 'JSON 解析失败');
    }

    applyImportedLeads(parsed.record.leads, {
      patientId: parsed.record.patientId || undefined,
      recordId: parsed.record.id,
    });
  };

  const getFileBaseName = (fileName: string): string => {
    return fileName.replace(/\.[^/.]+$/, '').toLowerCase();
  };

  const arrayBufferToBinaryString = (buffer: ArrayBuffer): string => {
    const bytes = new Uint8Array(buffer);
    // Use TextDecoder for efficient conversion, fallback to String.fromCharCode for small buffers
    if (typeof TextDecoder !== 'undefined') {
      return new TextDecoder('ascii').decode(bytes);
    }
    // Fallback for environments without TextDecoder
    return String.fromCharCode(...bytes);
  };

  const parseWfdbPair = async (heaFile: File, datFile: File): Promise<ECGLead[]> => {
    const parser = new WFDBParser();
    const headerText = await heaFile.text();
    const datBinary = arrayBufferToBinaryString(await datFile.arrayBuffer());
    const ecgData = parser.parse(headerText, datBinary);

    if (!ecgData || ecgData.leads.length === 0) {
      throw new Error('WFDB 解析失败，请确认 .hea 与 .dat 匹配');
    }

    return ecgData.leads;
  };

  const isMitbihRecordId = (recordId: string): boolean => MITBIH_RECORD_ID_PATTERN.test(recordId);

  const mergeBatches = (incoming: WfdbBatchRecord[]): void => {
    if (incoming.length === 0) {
      return;
    }

    setWfdbBatches((previous) => {
      const mergedMap = new Map<string, WfdbBatchRecord>();
      previous.forEach((item) => {
        mergedMap.set(item.id, item);
      });
      incoming.forEach((item) => {
        mergedMap.set(item.id, item);
      });

      return Array.from(mergedMap.values()).sort((a, b) => a.id.localeCompare(b.id));
    });
  };

  const handleMitbihFolderUpload = async (file: File, fileList: File[]): Promise<boolean> => {
    const firstFile = fileList[0];
    const firstUid = (firstFile as File & { uid?: string }).uid;
    const currentUid = (file as File & { uid?: string }).uid;

    if (firstUid && currentUid && firstUid !== currentUid) {
      return false;
    }

    const pairedFiles: Record<string, { hea?: File; dat?: File }> = {};
    const skippedNames: string[] = [];

    fileList.forEach((currentFile) => {
      const name = currentFile.name.toLowerCase();
      const isHea = name.endsWith('.hea');
      const isDat = name.endsWith('.dat');
      if (!isHea && !isDat) {
        skippedNames.push(currentFile.name);
        return;
      }

      const baseName = getFileBaseName(currentFile.name);
      if (!isMitbihRecordId(baseName)) {
        skippedNames.push(currentFile.name);
        return;
      }

      const entry = pairedFiles[baseName] || {};
      pairedFiles[baseName] = {
        ...entry,
        hea: isHea ? currentFile : entry.hea,
        dat: isDat ? currentFile : entry.dat,
      };
    });

    const completeRecordIds = Object.keys(pairedFiles).filter(
      (recordId) => pairedFiles[recordId].hea && pairedFiles[recordId].dat
    );
    const missingPairIds = Object.keys(pairedFiles).filter(
      (recordId) => !pairedFiles[recordId].hea || !pairedFiles[recordId].dat
    );

    if (completeRecordIds.length === 0) {
      message.error('未发现可导入的 MIT-BIH 记录，请确认文件名为三位数字且 .hea/.dat 成对');
      return false;
    }

    setImporting(true);
    try {
      const sortedIds = completeRecordIds.sort();
      const successBatches: WfdbBatchRecord[] = [];
      const failedIds: string[] = [];

      for (const recordId of sortedIds) {
        const entry = pairedFiles[recordId];
        try {
          const parsedLeads = await parseWfdbPair(entry.hea as File, entry.dat as File);
          successBatches.push({
            id: recordId,
            leads: parsedLeads,
            createdAt: Date.now(),
          });
        } catch {
          failedIds.push(recordId);
        }
      }

      mergeBatches(successBatches);
      if (successBatches.length > 0) {
        applyImportedLeads(successBatches[0].leads, {
          recordId: successBatches[0].id,
          patientId: currentPatientId || undefined,
        });
      }

      if (missingPairIds.length > 0) {
        message.warning(`以下记录缺少配对文件: ${missingPairIds.join(', ')}`);
      }
      if (skippedNames.length > 0) {
        message.info(`已跳过 ${skippedNames.length} 个非 MIT-BIH 文件`);
      }
      if (failedIds.length > 0) {
        message.warning(`以下记录解析失败: ${failedIds.join(', ')}`);
      }
      message.success(`MIT-BIH 批量导入完成: 成功 ${successBatches.length} 条记录`);
    } finally {
      setImporting(false);
    }

    return false;
  };

  const handleGithubUrlImport = async (): Promise<void> => {
    const url = githubRawUrl.trim();
    if (!url) {
      message.warning('请输入 GitHub Raw 数据链接');
      return;
    }

    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      message.warning('链接格式不正确，请输入完整 URL');
      return;
    }

    // SSRF protection: validate URL points to githubusercontent.com
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(url);
    } catch {
      message.warning('链接格式不正确');
      return;
    }

    const validHosts = ['raw.githubusercontent.com', 'raw.githubusercontent.org'];
    if (!validHosts.includes(parsedUrl.hostname.toLowerCase())) {
      message.warning('只支持 GitHub Raw (raw.githubusercontent.com) 链接');
      return;
    }

    // Additional security: reject URLs with suspicious patterns
    const suspiciousPatterns = [/@/, /:/, /\.\./, /localhost/i, /127\.0\.0\.1/i, /0x/i];
    const fullUrl = url.toLowerCase();
    for (const pattern of suspiciousPatterns) {
      if (pattern.test(fullUrl)) {
        message.warning('检测到可疑 URL 模式，已拒绝');
        return;
      }
    }

    setImporting(true);
    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`下载失败: HTTP ${response.status}`);
      }

      const text = await response.text();
      await parseJsonTextAndApply(text);
    } catch (error) {
      message.error(error instanceof Error ? error.message : 'URL 导入失败');
    } finally {
      setImporting(false);
    }
  };

  const handleSelectAnnotationType = (type: Annotation['type']): void => {
    setActiveTool('annotate');
    setActiveAnnotationType(type);
  };

  const handleDeleteAnnotation = (): void => {
    setDeleteSignal((previous) => previous + 1);
  };

  const getActiveLead = (): ECGLead => {
    const matched = leads.find((lead) => lead.name === analysisLeadName);
    return matched || leads[0];
  };

  const activeLead = leads.length > 0 ? getActiveLead() : null;
  const signalQuality = activeLead ? Math.round(calculateSignalQuality(activeLead.data)) : 0;
  const studioSummary = [
    { label: '导联', value: leads.length || 0 },
    { label: '标注', value: annotationStats.total || 0 },
    { label: 'AI 结果', value: inferenceResults.length || 0 },
    { label: '信号质量', value: `${signalQuality}%` },
  ];

  const buildRecordId = (): string => {
    if (currentRecordId) {
      return currentRecordId;
    }

    if (wfdbBatches.length > 0) {
      return wfdbBatches[0].id;
    }
    return `local-${Date.now()}`;
  };

  const handleModelLoad = async (): Promise<void> => {
    dispatch(setModelLoading(true));
    try {
      await modelService.loadModel('/models/ecg-classifier/model.json');
      dispatch(setModelLoaded(true));
      if (modelService.isUsingMockInference()) {
        message.warning('未找到真实模型，已切换到模拟推理模式');
      } else {
        message.success('真实模型加载成功');
      }
    } catch {
      message.error('模型加载失败');
    } finally {
      dispatch(setModelLoading(false));
    }
  };

  const handleAnalyze = async (): Promise<void> => {
    if (!modelLoaded) {
      message.warning('请先加载模型');
      return;
    }

    setIsAnalyzing(true);
    try {
      const signalData = leads.map((lead) => lead.data);
      const results = await modelService.predictWithHeatmap(signalData);
      dispatch(setInferenceResults(results));
      message.success('分析完成');
    } catch {
      message.error('分析失败');
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleMinimaxAnalyze = async (): Promise<void> => {
    const hasDirectConfig = minimaxEndpoint.trim() && minimaxApiKey.trim();
    const useProxy = !hasDirectConfig;

    if (!useProxy && (!minimaxEndpoint.trim() || !minimaxApiKey.trim())) {
      message.warning('请先填写 Minimax Endpoint 和 API Key');
      return;
    }

    setMinimaxLoading(true);
    try {
      const signalData = leads.map((lead) => lead.data);

      // Determine if we should use proxy or direct API
      const hasDirectConfig = minimaxEndpoint.trim() && minimaxApiKey.trim();
      const useProxy = !hasDirectConfig;

      const predictions = await minimaxService.analyzeECG(signalData, {
        endpoint: minimaxEndpoint.trim(),
        apiKey: minimaxApiKey.trim(),
        model: minimaxModel.trim() || undefined,
        useProxy,
      });
      dispatch(setInferenceResults(predictions));
      message.success(useProxy ? 'Minimax 分析完成（通过代理）' : 'Minimax 分析完成');
    } catch (error) {
      message.error(error instanceof Error ? error.message : 'Minimax 分析失败');
    } finally {
      setMinimaxLoading(false);
    }
  };

  const handleAutoDetectRPeaks = (): void => {
    if (leads.length === 0) {
      message.warning('当前没有可分析的导联数据');
      return;
    }

    const lead = getActiveLead();
    const peaks = findRPeaks(lead.data, peakThreshold);
    if (peaks.length === 0) {
      message.warning('未检测到 R 峰，请降低阈值后重试');
      return;
    }

    const viewWidth = 1200;
    const autoRAnnotations: Annotation[] = peaks.slice(0, 250).map((sampleIndex) => ({
      id: `auto_r_${lead.name}_${sampleIndex}`,
      type: 'R',
      position: (sampleIndex / Math.max(1, lead.data.length - 1)) * viewWidth,
      confidence: 0.75,
      manual: false,
      timestamp: Date.now(),
    }));

    const keptAnnotations = annotations.filter((item) => !item.id.startsWith('auto_r_'));
    dispatch(setAnnotations([...keptAnnotations, ...autoRAnnotations]));
    message.success(`已自动标注 ${autoRAnnotations.length} 个 R 峰（导联 ${lead.name}）`);
  };

  const handleExportCurrentRecord = (format: 'json' | 'csv'): void => {
    if (leads.length === 0) {
      message.warning('没有可导出的 ECG 数据');
      return;
    }

    const activeLead = getActiveLead();
    const features = extractFeatures(activeLead.data, activeLead.samplingRate || 500);
    const record = {
      id: buildRecordId(),
      patientId: currentPatientId || 'local-patient',
      deviceId: 'web-import',
      timestamp: new Date().toISOString(),
      leads,
      duration: leads[0]?.data.length ? leads[0].data.length / (leads[0].samplingRate || 500) : 0,
      samplingRate: leads[0]?.samplingRate || 500,
      annotations,
      signalQuality: calculateSignalQuality(activeLead.data),
      diagnosis:
        inferenceResults.length > 0
          ? { label: inferenceResults[0].className, confidence: inferenceResults[0].probability }
          : { label: features.heartRate ? `HR ${features.heartRate} bpm` : '未分析', confidence: 0.5 },
    };

    exportRecord(record, {
      format,
      includeAnnotations: true,
      includeDiagnosis: true,
      includeMetadata: true,
    });
    message.success(`已导出 ${format.toUpperCase()} 文件`);
  };

  const handleFileUpload = async (file: File): Promise<boolean> => {
    const lowerName = file.name.toLowerCase();
    const isHea = lowerName.endsWith('.hea');
    const isDat = lowerName.endsWith('.dat');

    if (isHea || isDat) {
      const key = getFileBaseName(file.name);
      const currentEntry = wfdbPending[key] || {};
      const nextEntry = {
        ...currentEntry,
        hea: isHea ? file : currentEntry.hea,
        dat: isDat ? file : currentEntry.dat,
      };

      if (!nextEntry.hea || !nextEntry.dat) {
        setWfdbPending((previous) => ({
          ...previous,
          [key]: nextEntry,
        }));
        message.info(`已暂存 ${file.name}，请继续上传同名的 ${isHea ? '.dat' : '.hea'} 文件`);
        return false;
      }

      setWfdbPending((previous) => {
        const nextState = { ...previous };
        delete nextState[key];
        return nextState;
      });

      setImporting(true);
      try {
        const parsedLeads = await parseWfdbPair(nextEntry.hea, nextEntry.dat);
        const batchId = key;
        const nextBatch: WfdbBatchRecord = {
          id: batchId,
          leads: parsedLeads,
          createdAt: Date.now(),
        };

        setWfdbBatches((previous) => {
          const others = previous.filter((item) => item.id !== batchId);
          return [nextBatch, ...others];
        });
        applyImportedLeads(parsedLeads, {
          recordId: batchId,
          patientId: currentPatientId || undefined,
        });
        message.success(`WFDB 解析完成: ${batchId}`);
      } catch (error) {
        message.error(error instanceof Error ? error.message : 'WFDB 导入失败');
      } finally {
        setImporting(false);
      }

      return false;
    }

    setImporting(true);
    try {
      if (lowerName.endsWith('.json')) {
        const text = await file.text();
        await parseJsonTextAndApply(text);
      } else {
        const parsed = await ecgParserService.parseFile(file, {
          removeBaseline: true,
          normalize: true,
        });
        if (!parsed.success || !parsed.record) {
          throw new Error(parsed.error || '文件解析失败');
        }
        applyImportedLeads(parsed.record.leads, {
          recordId: parsed.record.id,
          patientId: parsed.record.patientId || currentPatientId || undefined,
        });
      }
    } catch (error) {
      message.error(error instanceof Error ? error.message : '文件导入失败');
    } finally {
      setImporting(false);
    }

    return false;
  };

  return (
    <div className="page-shell page-shell-wide">
      <section className="page-hero">
        <div className="page-kicker">Workbench</div>
        <Title className="page-title">标注工作台</Title>
        <Text className="page-subtitle">
          导入心电数据、执行 AI 推理并完成人工标注。把高频操作放在同一层，把波形和分析结果留给主工作区。
        </Text>
        <div className="page-actions">
          <Tag color={currentPatientId ? 'blue' : 'default'} className="app-header-tag">
            当前患者: {currentPatientId || '未绑定'}
          </Tag>
          <Tag color={currentRecordId ? 'green' : 'default'} className="app-header-tag">
            当前记录: {currentRecordId || '自动生成'}
          </Tag>
          <Tag color="geekblue" className="app-header-tag">
            支持格式: JSON / DICOM / HL7 / WFDB
          </Tag>
        </div>
      </section>

      <div className="section-spacer">
        <Space wrap size={10}>
          {studioSummary.map((item) => (
            <span key={item.label} className="summary-chip">
              {item.label} {item.value}
            </span>
          ))}
          <span className="summary-chip">工具 {activeTool === 'annotate' ? `标注 ${activeAnnotationType}` : '平移'}</span>
        </Space>
      </div>

      <Row gutter={[16, 16]} className="section-spacer">
        <Col xs={24} xl={5}>
          <Space direction="vertical" size={16} style={{ width: '100%' }}>
            <Card className="section-card" title="使用流程" extra={<Tag color="blue">Flow</Tag>}>
              <Space direction="vertical" size={8} style={{ width: '100%' }}>
                <Text type="secondary">1. 导入 JSON、DICOM、HL7 或 WFDB 数据。</Text>
                <Text type="secondary">2. 选择导联，必要时调整 R 峰阈值与回放窗口。</Text>
                <Text type="secondary">3. 切换到标注模式，在波形上完成人工修订。</Text>
                <Text type="secondary">4. 运行 AI 或 Minimax 分析，再导出 JSON / CSV。</Text>
              </Space>
            </Card>

            <ImportPanel
              githubRawUrl={githubRawUrl}
              onGithubUrlChange={setGithubRawUrl}
              onGithubUrlImport={handleGithubUrlImport}
              importing={importing}
              wfdbBatches={wfdbBatches}
              onWfdbBatchUpload={handleFileUpload}
              onWfdbFolderUpload={handleMitbihFolderUpload}
              onSelectBatch={(batch) =>
                applyImportedLeads(batch.leads, {
                  recordId: batch.id,
                  patientId: currentPatientId || undefined,
                })
              }
              onClearBatches={() => setWfdbBatches([])}
            />

            <AnnotationToolbar
              activeTool={activeTool}
              activeAnnotationType={activeAnnotationType}
              onSelectTool={(tool) => setActiveTool(tool)}
              onSelectAnnotationType={handleSelectAnnotationType}
              onDeleteAnnotation={handleDeleteAnnotation}
            />
          </Space>
        </Col>

        <Col xs={24} xl={11}>
          <Card className="workspace-card" title="ECG 波形显示" style={{ height: '100%' }} extra={<Tag color="cyan">Canvas</Tag>}>
            <Space wrap size={8} style={{ marginBottom: 14 }}>
              <span className="summary-chip">主导联 {analysisLeadName}</span>
              <span className="summary-chip">播放 {playbackEnabled ? '开启' : '关闭'}</span>
              <span className="summary-chip">窗口 {playbackWindowSize}</span>
              <span className="summary-chip">步长 {playbackStep}</span>
            </Space>
            <ECGCanvas
              leads={leads}
              height={520}
              controlledTool={activeTool}
              annotationType={activeAnnotationType}
              deleteSignal={deleteSignal}
            />
          </Card>
        </Col>

        <Col xs={24} xl={8}>
          <Space direction="vertical" size={16} style={{ width: '100%' }}>
            <SmartAssistancePanel
              modelLoaded={modelLoaded}
              analysisLeadName={analysisLeadName}
              peakThreshold={peakThreshold}
              leads={leads}
              onLeadNameChange={setAnalysisLeadName}
              onPeakThresholdChange={setPeakThreshold}
              onAutoDetectRPeaks={handleAutoDetectRPeaks}
              onExportJSON={() => handleExportCurrentRecord('json')}
              onExportCSV={() => handleExportCurrentRecord('csv')}
            />

            <PlaybackControls
              playbackEnabled={playbackEnabled}
              playbackStep={playbackStep}
              playbackWindowSize={playbackWindowSize}
              playbackCursor={playbackCursor}
              onTogglePlayback={() => setPlaybackEnabled((prev) => !prev)}
              onStepChange={setPlaybackStep}
              onWindowSizeChange={setPlaybackWindowSize}
              onReset={() => {
                setPlaybackCursor(0);
                setLeads(buildStreamingLeads(sourceLeadsRef.current, 0, playbackWindowSize));
              }}
            />

            <AIAnalysisPanel
              modelLoaded={modelLoaded}
              modelLoading={modelLoading}
              isAnalyzing={isAnalyzing}
              minimaxLoading={minimaxLoading}
              minimaxEndpoint={minimaxEndpoint}
              minimaxApiKey={minimaxApiKey}
              minimaxModel={minimaxModel}
              onLoadModel={handleModelLoad}
              onAnalyze={handleAnalyze}
              onMinimaxAnalyze={handleMinimaxAnalyze}
              onEndpointChange={setMinimaxEndpoint}
              onApiKeyChange={setMinimaxApiKey}
              onModelChange={setMinimaxModel}
            />

            <SignalMetrics
              leads={leads}
              signalQuality={signalQuality}
              annotationStats={annotationStats}
              inferenceResults={inferenceResults}
            />

            <AnnotationList annotations={annotations} totalCount={annotationStats.total} />
          </Space>
        </Col>
      </Row>
    </div>
  );
};

export default AnnotationStudio;
