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
import { useEffect, useRef } from 'react';
import { useLocation, useParams } from 'react-router-dom';
import ECGCanvas from '../components/Canvas/ECGCanvas';
import { useDispatch, useSelector } from 'react-redux';
import { RootState } from '../store';
import { setModelLoading, setModelLoaded, setInferenceResults, setAnnotations } from '../store/ecgSlice';
import { modelService } from '../services/modelService';
import { Annotation, ECGLead } from '../types';
import { ecgParserService } from '../services/ecgParser';
import { WFDBParser } from '../utils/dicomParser';
import { minimaxService } from '../services/minimaxService';
import { calculateSignalQuality, extractFeatures, findRPeaks } from '../utils/signalProcessor';
import { exportRecord } from '../utils/exportUtils';

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
  const { modelLoading, modelLoaded, inferenceResults, annotations } = useSelector(
    (state: RootState) => state.ecg
  );

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
    let result = '';
    for (let index = 0; index < bytes.length; index += 1) {
      result += String.fromCharCode(bytes[index]);
    }
    return result;
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
    if (!minimaxEndpoint.trim() || !minimaxApiKey.trim()) {
      message.warning('请先填写 Minimax Endpoint 和 API Key');
      return;
    }

    setMinimaxLoading(true);
    try {
      const signalData = leads.map((lead) => lead.data);
      const predictions = await minimaxService.analyzeECG(signalData, {
        endpoint: minimaxEndpoint.trim(),
        apiKey: minimaxApiKey.trim(),
        model: minimaxModel.trim() || undefined,
      });
      dispatch(setInferenceResults(predictions));
      message.success('Minimax 分析完成');
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
          导入心电数据、执行 AI 推理并完成人工标注。这个页面需要承载最高的信息密度，所以我把流程、操作和分析拆成了更清晰的层次。
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

      <Row gutter={[16, 16]} style={{ marginTop: 18 }}>
        <Col xs={24} xl={5}>
          <Space direction="vertical" size={16} style={{ width: '100%' }}>
            <Card className="section-card" title="使用流程">
              <Space direction="vertical" size={8} style={{ width: '100%' }}>
                <Text type="secondary">1. 导入 JSON、DICOM、HL7 或 WFDB 数据。</Text>
                <Text type="secondary">2. 选择导联，必要时调整 R 峰阈值与回放窗口。</Text>
                <Text type="secondary">3. 切换到标注模式，在波形上完成人工修订。</Text>
                <Text type="secondary">4. 运行 AI 或 Minimax 分析，再导出 JSON / CSV。</Text>
              </Space>
            </Card>

            <Card className="section-card" title="数据导入">
              <Space direction="vertical" style={{ width: '100%', marginBottom: 12 }}>
                <Input
                  placeholder="粘贴 GitHub Raw JSON 链接"
                  value={githubRawUrl}
                  onChange={(event) => setGithubRawUrl(event.target.value)}
                />
                <Button icon={<LinkOutlined />} onClick={handleGithubUrlImport} loading={importing} block>
                  从 URL 导入
                </Button>
              </Space>

              <Upload.Dragger
                className="glass-panel"
                accept=".json,.dcm,.hl7,.hea,.dat"
                beforeUpload={handleFileUpload}
                multiple
                disabled={importing}
                showUploadList={false}
              >
                <p className="ant-upload-drag-icon">
                  <CloudUploadOutlined style={{ fontSize: 42, color: '#275ef1' }} />
                </p>
                <p>点击或拖拽文件上传</p>
                <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                  单文件支持 JSON / DICOM / HL7，WFDB 需同时提供 .hea 与 .dat
                </p>
              </Upload.Dragger>

              <div style={{ marginTop: 12 }}>
                <Upload.Dragger
                  className="glass-panel"
                  accept=".hea,.dat"
                  beforeUpload={handleMitbihFolderUpload}
                  multiple
                  directory
                  disabled={importing}
                  showUploadList={false}
                >
                  <p className="ant-upload-drag-icon">
                    <CloudUploadOutlined style={{ fontSize: 34, color: '#0f9d9a' }} />
                  </p>
                  <p>MIT-BIH 一键批量导入（选择文件夹）</p>
                  <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    仅识别三位数字记录名（如 100.hea + 100.dat）
                  </p>
                </Upload.Dragger>
              </div>

              {wfdbBatches.length > 0 ? (
                <div style={{ marginTop: 12 }}>
                  <div
                    style={{
                      fontSize: 12,
                      color: 'var(--text-muted)',
                      marginBottom: 8,
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      gap: 8,
                    }}
                  >
                    <span>已解析 WFDB 记录（可切换加载）</span>
                    <Button size="small" onClick={() => setWfdbBatches([])}>
                      清空
                    </Button>
                  </div>
                  <Space direction="vertical" style={{ width: '100%' }}>
                    {wfdbBatches.map((batch) => (
                      <Button
                        key={batch.id}
                        size="small"
                        onClick={() =>
                          applyImportedLeads(batch.leads, {
                            recordId: batch.id,
                            patientId: currentPatientId || undefined,
                          })
                        }
                        style={{ textAlign: 'left' }}
                      >
                        {batch.id} · {batch.leads.length} 导联
                      </Button>
                    ))}
                  </Space>
                </div>
              ) : null}
            </Card>

            <Card className="section-card" title="标注工具">
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 10 }}>
                先选择标注类型，再在波形区双击落点；删除时先单击选中标注。
              </div>
              <Space direction="vertical" style={{ width: '100%' }}>
                <Button
                  type={activeTool === 'annotate' && activeAnnotationType === 'P' ? 'primary' : 'default'}
                  block
                  onClick={() => handleSelectAnnotationType('P')}
                >
                  标注 P 波 (Ctrl+1)
                </Button>
                <Button
                  type={activeTool === 'annotate' && activeAnnotationType === 'R' ? 'primary' : 'default'}
                  block
                  onClick={() => handleSelectAnnotationType('R')}
                >
                  标注 QRS (Ctrl+2)
                </Button>
                <Button
                  type={activeTool === 'annotate' && activeAnnotationType === 'T' ? 'primary' : 'default'}
                  block
                  onClick={() => handleSelectAnnotationType('T')}
                >
                  标注 T 波 (Ctrl+3)
                </Button>
                <Button block onClick={() => setActiveTool('pan')}>
                  切换平移模式
                </Button>
                <Button block danger onClick={handleDeleteAnnotation}>
                  删除已选标注
                </Button>
              </Space>
            </Card>
          </Space>
        </Col>

        <Col xs={24} xl={11}>
          <Card className="workspace-card" title="ECG 波形显示" style={{ height: '100%' }}>
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
            <Card className="section-card" title="智能辅助">
              <Space direction="vertical" style={{ width: '100%' }}>
                <select
                  value={analysisLeadName}
                  onChange={(event) => setAnalysisLeadName(event.target.value)}
                  style={{
                    width: '100%',
                    height: 40,
                    borderRadius: 12,
                    border: '1px solid rgba(26, 43, 67, 0.14)',
                    padding: '0 12px',
                    background: 'rgba(255,255,255,0.9)',
                  }}
                >
                  {leads.map((lead) => (
                    <option key={lead.name} value={lead.name}>
                      {lead.name}
                    </option>
                  ))}
                </select>
                <Input
                  size="small"
                  type="number"
                  min={0.2}
                  max={0.95}
                  step={0.05}
                  value={peakThreshold}
                  onChange={(event) => setPeakThreshold(Number(event.target.value))}
                  placeholder="R 峰阈值 (0.2 - 0.95)"
                />
                <Button onClick={handleAutoDetectRPeaks} block>
                  自动检测 R 峰
                </Button>
                <Space wrap style={{ width: '100%' }}>
                  <Button onClick={() => handleExportCurrentRecord('json')} block>
                    导出当前记录 JSON
                  </Button>
                  <Button onClick={() => handleExportCurrentRecord('csv')} block>
                    导出当前记录 CSV
                  </Button>
                </Space>
              </Space>
            </Card>

            <Card className="section-card" title="动态回放">
              <Space direction="vertical" style={{ width: '100%' }}>
                <Button onClick={() => setPlaybackEnabled((previous) => !previous)} block>
                  {playbackEnabled ? '暂停动态回放' : '启动动态回放'}
                </Button>
                <Input
                  size="small"
                  type="number"
                  min={4}
                  max={240}
                  step={4}
                  value={playbackStep}
                  onChange={(event) => setPlaybackStep(Math.max(4, Number(event.target.value) || 4))}
                  placeholder="回放速度（每帧步长）"
                />
                <Input
                  size="small"
                  type="number"
                  min={300}
                  max={6000}
                  step={100}
                  value={playbackWindowSize}
                  onChange={(event) =>
                    setPlaybackWindowSize(Math.max(300, Number(event.target.value) || DEFAULT_PLAYBACK_WINDOW))
                  }
                  placeholder="窗口长度（样本点）"
                />
                <Button
                  onClick={() => {
                    setPlaybackCursor(0);
                    setLeads(buildStreamingLeads(sourceLeadsRef.current, 0, playbackWindowSize));
                  }}
                  block
                >
                  回放重置到起点
                </Button>
                <Text type="secondary">当前游标: {playbackCursor}</Text>
              </Space>
            </Card>

            <Card className="section-card" title="AI 辅助">
              <Space direction="vertical" style={{ width: '100%' }}>
                <Button icon={<RobotOutlined />} onClick={handleModelLoad} loading={modelLoading} block>
                  {modelLoaded ? '模型已加载' : '加载模型'}
                </Button>
                <Button
                  icon={<ThunderboltOutlined />}
                  onClick={handleAnalyze}
                  disabled={!modelLoaded}
                  loading={isAnalyzing}
                  block
                >
                  AI 分析
                </Button>
                <Input
                  size="small"
                  placeholder="Minimax Endpoint (可选)"
                  value={minimaxEndpoint}
                  onChange={(event) => setMinimaxEndpoint(event.target.value)}
                />
                <Input.Password
                  size="small"
                  placeholder="Minimax API Key (可选)"
                  value={minimaxApiKey}
                  onChange={(event) => setMinimaxApiKey(event.target.value)}
                />
                <Input
                  size="small"
                  placeholder="Minimax Model (可选)"
                  value={minimaxModel}
                  onChange={(event) => setMinimaxModel(event.target.value)}
                />
                <Button
                  onClick={handleMinimaxAnalyze}
                  loading={minimaxLoading}
                  disabled={isAnalyzing || modelLoading}
                  block
                >
                  调用 Minimax API
                </Button>
              </Space>
            </Card>

            <Card className="section-card" title="信号概览">
              {leads.length > 0 ? (
                <Space direction="vertical" style={{ width: '100%' }} size={8}>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <Text type="secondary">导联数</Text>
                    <Text strong>{leads.length}</Text>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <Text type="secondary">采样率</Text>
                    <Text strong>{leads[0]?.samplingRate || 0} Hz</Text>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <Text type="secondary">样本数</Text>
                    <Text strong>{leads[0]?.data.length || 0}</Text>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <Text type="secondary">信号质量</Text>
                    <Text strong>{Math.round(calculateSignalQuality(getActiveLead().data))}%</Text>
                  </div>
                  <Progress
                    percent={Math.round(calculateSignalQuality(getActiveLead().data))}
                    strokeColor={{ from: '#275ef1', to: '#0f9d9a' }}
                  />
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <Text type="secondary">总标注数</Text>
                    <Text strong>{annotations.length}</Text>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <Text type="secondary">R 峰标注</Text>
                    <Text strong>{annotations.filter((item) => item.type === 'R').length}</Text>
                  </div>
                </Space>
              ) : (
                <div className="empty-panel">暂无信号数据</div>
              )}
            </Card>

            <Card className="section-card" title="AI 诊断结果">
              {inferenceResults.length > 0 ? (
                <List
                  dataSource={inferenceResults}
                  renderItem={(item) => (
                    <List.Item style={{ paddingInline: 0 }}>
                      <Space direction="vertical" style={{ width: '100%' }}>
                        <Tag color={item.probability > 0.5 ? 'red' : 'blue'}>{item.className}</Tag>
                        <Progress
                          percent={Math.round(item.probability * 100)}
                          size="small"
                          status={item.probability > 0.5 ? 'exception' : 'normal'}
                        />
                      </Space>
                    </List.Item>
                  )}
                />
              ) : (
                <div className="empty-panel">请先加载模型并运行分析</div>
              )}
            </Card>

            <Card className="section-card" title="标注列表">
              {annotations.length > 0 ? (
                <List
                  size="small"
                  dataSource={annotations}
                  renderItem={(item) => (
                    <List.Item style={{ paddingInline: 0 }}>
                      <Space>
                        <Tag color="blue">{item.type}</Tag>
                        <span>位置: {Math.round(item.position)}</span>
                      </Space>
                    </List.Item>
                  )}
                />
              ) : (
                <div className="empty-panel">暂无标注</div>
              )}
            </Card>
          </Space>
        </Col>
      </Row>
    </div>
  );
};

export default AnnotationStudio;
