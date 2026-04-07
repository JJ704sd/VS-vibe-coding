import { ModelPrediction } from '../types';

export interface MinimaxConfig {
  endpoint: string;
  apiKey: string;
  model?: string;
  useProxy?: boolean;
}

interface MinimaxResponse {
  predictions?: Array<{ className?: string; probability?: number; label?: string; score?: number }>;
  output_text?: string;
  choices?: Array<{ message?: { content?: string } }>;
  [key: string]: unknown;
}

const DEFAULT_CLASSES = ['正常', '房颤', '室上性心动过速', '室性心动过速', '停搏'];
const PROXY_ENDPOINT = '/api/ecg/analyze';
type RawPredictionItem = {
  className?: string;
  probability?: number;
  label?: string;
  score?: number;
};

class MinimaxService {
  /**
   * Analyze ECG data using Minimax API.
   *
   * When useProxy is true, requests are sent to the local proxy server
   * which securely forwards them to Minimax without exposing the API key.
   */
  async analyzeECG(signalData: number[][], config: MinimaxConfig): Promise<ModelPrediction[]> {
    const useProxy = config.useProxy ?? true;

    if (useProxy) {
      return this.analyzeViaProxy(signalData, config);
    }

    // Direct API call (not recommended - exposes API key)
    return this.analyzeDirect(signalData, config);
  }

  private async analyzeViaProxy(
    signalData: number[][],
    config: MinimaxConfig
  ): Promise<ModelPrediction[]> {
    const proxyUrl = PROXY_ENDPOINT;

    const payload = {
      model: config.model || 'abab6.5s-chat',
      signalData,
      _startTime: Date.now(),
    };

    const response = await fetch(proxyUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error(`代理调用失败: HTTP ${response.status}`);
    }

    const raw = (await response.json()) as MinimaxResponse;
    const predictions = this.extractPredictions(raw);
    if (predictions.length > 0) {
      return predictions;
    }

    throw new Error('代理返回内容中未解析到有效 predictions');
  }

  private async analyzeDirect(
    signalData: number[][],
    config: MinimaxConfig
  ): Promise<ModelPrediction[]> {
    if (!config.endpoint.trim()) {
      throw new Error('Minimax endpoint 不能为空');
    }
    if (!config.apiKey.trim()) {
      throw new Error('Minimax API Key 不能为空');
    }

    const payload = {
      model: config.model || 'abab6.5s-chat',
      messages: [
        {
          role: 'system',
          content:
            '你是ECG分类助手。请返回JSON对象，字段为predictions，数组元素为{className, probability}，概率总和约为1。',
        },
        {
          role: 'user',
          content: JSON.stringify({
            task: 'classify_ecg',
            classes: DEFAULT_CLASSES,
            signal: signalData,
          }),
        },
      ],
      temperature: 0.1,
    };

    const response = await fetch(config.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error(`Minimax 调用失败: HTTP ${response.status}`);
    }

    const raw = (await response.json()) as MinimaxResponse;
    const predictions = this.extractPredictions(raw);
    if (predictions.length > 0) {
      return predictions;
    }

    throw new Error('Minimax 返回内容中未解析到有效 predictions');
  }

  private extractPredictions(raw: MinimaxResponse): ModelPrediction[] {
    if (Array.isArray(raw.predictions)) {
      return this.normalizePredictions(raw.predictions);
    }

    const maybeText =
      raw.output_text ||
      (Array.isArray(raw.choices) ? raw.choices[0]?.message?.content : undefined);

    if (typeof maybeText === 'string') {
      const parsed = this.tryParseJsonFromText(maybeText);
      if (parsed && Array.isArray(parsed.predictions)) {
        return this.normalizePredictions(parsed.predictions as RawPredictionItem[]);
      }
    }

    return [];
  }

  private tryParseJsonFromText(text: string): { predictions?: unknown[] } | null {
    try {
      return JSON.parse(text);
    } catch {
      const match = text.match(/\{[\s\S]*\}/);
      if (!match) {
        return null;
      }
      try {
        return JSON.parse(match[0]);
      } catch {
        return null;
      }
    }
  }

  private normalizePredictions(predictions: RawPredictionItem[]): ModelPrediction[] {
    const mapped = predictions
      .map((item) => ({
        className: item.className || item.label || '未知',
        probability: typeof item.probability === 'number' ? item.probability : item.score || 0,
      }))
      .filter((item) => item.className && Number.isFinite(item.probability));

    const total = mapped.reduce((sum, item) => sum + item.probability, 0);
    const normalized =
      total > 0 ? mapped.map((item) => ({ ...item, probability: item.probability / total })) : mapped;

    return normalized.sort((a, b) => b.probability - a.probability);
  }
}

export const minimaxService = new MinimaxService();
