import { ModelPrediction } from '../types';

/**
 * Configuration for {@link MinimaxService.analyzeECG}.
 *
 * Since the C-12 fix the sidecar proxy is the **only** supported
 * transport: the API key is read from the `MINIMAX_API_KEY` env var
 * inside `proxy-server/main.py` and never reaches the browser. The
 * `endpoint` / `apiKey` / `useProxy` fields are kept on the interface
 * for backward compatibility with existing call sites, but are no
 * longer consulted by the service.
 */
export interface MinimaxConfig {
  /**
   * Previously the user-supplied URL the service would `fetch` directly.
   * Now ignored — all traffic is forwarded through the local
   * `/api/ecg/analyze` sidecar route.
   * @deprecated since 2026-07-07 (C-11). Kept for backward compatibility.
   */
  endpoint?: string;
  /**
   * Previously the user-supplied API key sent as `Authorization: Bearer`
   * in the direct-call branch. Now ignored — the key lives in
   * `MINIMAX_API_KEY` on the sidecar.
   * @deprecated since 2026-07-07 (C-11). Kept for backward compatibility.
   */
  apiKey?: string;
  /** Model name to send to MiniMax (default `abab6.5s-chat`). */
  model?: string;
  /**
   * Previously toggled between the direct API call and the proxy. After
   * C-12 the sidecar route is the only path, so the flag is ignored.
   * @deprecated since 2026-07-07 (C-11). Kept for backward compatibility.
   */
  useProxy?: boolean;
}

interface MinimaxResponse {
  predictions?: Array<{ className?: string; probability?: number; label?: string; score?: number }>;
  output_text?: string;
  choices?: Array<{ message?: { content?: string } }>;
  [key: string]: unknown;
}

const PROXY_ENDPOINT = '/api/ecg/analyze';
type RawPredictionItem = {
  className?: string;
  probability?: number;
  label?: string;
  score?: number;
};

class MinimaxService {
  /**
   * Analyze ECG data using the local proxy-server.
   *
   * The request is forwarded to the sidecar `POST /api/ecg/analyze`
   * route, which in turn calls MiniMax with the operator-supplied
   * `MINIMAX_API_KEY`. The previous `useProxy=false` direct-call
   * branch (C-11) was removed because it exposed the user-supplied
   * API key in the browser's `Authorization` header and could be
   * pointed at any SSRF-friendly endpoint.
   */
  async analyzeECG(
    signalData: number[][],
    config: MinimaxConfig = {}
  ): Promise<ModelPrediction[]> {
    return this.analyzeViaProxy(signalData, config);
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
