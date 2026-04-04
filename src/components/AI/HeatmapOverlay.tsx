import React, { useEffect, useId, useMemo, useRef } from 'react';
import * as d3 from 'd3';

interface HeatmapOverlayProps {
  width: number;
  height: number;
  heatmapData: number[];
  opacity?: number;
  colorScheme?: 'default' | 'fire' | 'medical';
  showColorBar?: boolean;
  onHover?: (index: number, value: number) => void;
}

export const HeatmapOverlay: React.FC<HeatmapOverlayProps> = ({
  width,
  height,
  heatmapData,
  opacity = 0.5,
  colorScheme = 'default',
  showColorBar = false,
  onHover
}) => {
  const svgRef = useRef<SVGSVGElement>(null);
  const gradientId = useId();
  const glowId = useId();
  const clampedValues = useMemo(
    () => heatmapData.map((value) => Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0))),
    [heatmapData]
  );
  const hasData = clampedValues.length > 0;

  const colorScales = useMemo(() => ({
    default: d3.scaleSequential(d3.interpolateViridis).domain([0, 1]),
    fire: d3.scaleSequential(d3.interpolateYlOrRd).domain([0, 1]),
    medical: d3.scaleSequential(d3.interpolateBlues).domain([0, 1])
  }), []);

  useEffect(() => {
    if (!svgRef.current || !hasData) return;

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    const colorScale = colorScales[colorScheme];
    const stepX = width / clampedValues.length;
    const plotHeight = Math.max(height - (showColorBar ? 22 : 0), 8);

    const defs = svg.append('defs');

    const gradient = defs
      .append('linearGradient')
      .attr('id', `${gradientId}-heatmap-gradient`)
      .attr('x1', '0%')
      .attr('x2', '100%')
      .attr('y1', '0%')
      .attr('y2', '0%');

    const glow = defs.append('filter')
      .attr('id', `${glowId}-heatmap-glow`)
      .attr('x', '-20%')
      .attr('y', '-20%')
      .attr('width', '140%')
      .attr('height', '140%');

    glow.append('feGaussianBlur')
      .attr('stdDeviation', 2)
      .attr('result', 'blur');

    glow.append('feColorMatrix')
      .attr('in', 'blur')
      .attr('type', 'matrix')
      .attr('values', '1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 0.2 0')
      .attr('result', 'softGlow');

    glow.append('feBlend')
      .attr('in', 'SourceGraphic')
      .attr('in2', 'softGlow')
      .attr('mode', 'screen');

    const stops = [0, 0.25, 0.5, 0.75, 1];
    stops.forEach(stop => {
      gradient.append('stop')
        .attr('offset', `${stop * 100}%`)
        .attr('stop-color', colorScale(stop));
    });

    const heatmapGroup = svg.append('g')
      .attr('class', 'heatmap-group')
      .attr('filter', `url(#${glowId}-heatmap-glow)`);

    const rectWidth = Math.max(stepX - 1, 1);
    
    heatmapGroup.append('rect')
      .attr('x', 0)
      .attr('y', 0)
      .attr('width', width)
      .attr('height', plotHeight)
      .attr('rx', 16)
      .attr('fill', `url(#${gradientId}-heatmap-gradient)`)
      .attr('opacity', 0.12);

    clampedValues.forEach((value, index) => {
      const x = index * stepX;
      
      heatmapGroup.append('rect')
        .attr('x', x)
        .attr('y', 0)
        .attr('width', rectWidth)
        .attr('height', plotHeight)
        .attr('rx', Math.min(10, rectWidth / 2))
        .attr('fill', colorScale(value))
        .attr('opacity', opacity)
        .attr('stroke', 'rgba(255, 255, 255, 0.68)')
        .attr('stroke-width', 0.8)
        .style('pointer-events', onHover ? 'all' : 'none')
        .style('cursor', onHover ? 'pointer' : 'default')
        .on('mouseenter', () => {
          if (onHover) onHover(index, value);
        })
        .on('mouseleave', () => {
          if (onHover) onHover(-1, 0);
        });
    });

    if (showColorBar) {
      const legendWidth = Math.min(132, Math.max(96, width * 0.24));
      const legendX = Math.max(width - legendWidth - 14, 12);
      const legendY = Math.max(height - 18, 12);

      const legend = svg.append('g')
        .attr('class', 'heatmap-legend')
        .attr('transform', `translate(${legendX}, ${legendY})`);

      legend.append('rect')
        .attr('width', legendWidth)
        .attr('height', 10)
        .attr('rx', 999)
        .attr('fill', 'rgba(255, 255, 255, 0.24)');

      legend.append('rect')
        .attr('width', legendWidth)
        .attr('height', 10)
        .attr('rx', 999)
        .attr('fill', `url(#${gradientId}-heatmap-gradient)`)
        .attr('opacity', 0.88);

      legend.append('text')
        .attr('x', 0)
        .attr('y', -6)
        .attr('fill', '#6c7f97')
        .attr('font-size', 10)
        .attr('font-weight', 600)
        .text('低');

      legend.append('text')
        .attr('x', legendWidth)
        .attr('y', -6)
        .attr('fill', '#6c7f97')
        .attr('font-size', 10)
        .attr('font-weight', 600)
        .attr('text-anchor', 'end')
        .text('高');
    }

  }, [width, height, opacity, colorScheme, colorScales, onHover, hasData, clampedValues, gradientId, glowId, showColorBar]);

  return (
    <svg 
      ref={svgRef} 
      width={width} 
      height={height}
      className="heatmap-overlay"
      aria-hidden="true"
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        pointerEvents: onHover ? 'auto' : 'none',
        zIndex: 10,
        overflow: 'visible'
      }}
    />
  );
};

interface ModelLoaderProps {
  modelUrl?: string;
  onLoad?: () => void;
  onError?: (error: Error) => void;
  showProgress?: boolean;
}

export const ModelLoader: React.FC<ModelLoaderProps> = ({
  modelUrl = '/models/ecg-classifier/model.json',
  onLoad,
  onError,
  showProgress = true
}) => {
  void onLoad;
  void onError;

  return (
    <section className="ai-status-card">
      <div className="ai-status-card__header">
        <div>
          <div className="ai-status-card__eyebrow">模型加载</div>
          <div className="ai-status-card__title">ECG 分类器</div>
        </div>
        <span className="status-pill status-pill--working">准备中</span>
      </div>
      <div className="ai-status-card__body">
        <div className="ai-status-card__row">
          <span>资源路径</span>
          <code>{modelUrl}</code>
        </div>
        <div className="ai-status-card__row">
          <span>状态</span>
          <span>正在加载推理权重与特征配置</span>
        </div>
        {showProgress ? (
          <div className="ai-status-card__progress" aria-hidden="true">
            <span />
          </div>
        ) : null}
      </div>
    </section>
  );
};

interface InferencePanelProps {
  predictions: Array<{ className: string; probability: number }>;
  inferenceTime?: number;
  heatmapData?: number[];
  onPredictionClick?: (prediction: { className: string; probability: number }) => void;
}

export const InferencePanel: React.FC<InferencePanelProps> = ({
  predictions,
  inferenceTime,
  heatmapData,
  onPredictionClick
}) => {
  const rankedPredictions = [...predictions].sort((a, b) => b.probability - a.probability).slice(0, 5);
  const peakProbability = rankedPredictions[0]?.probability ?? 0;
  const avgHeatmap = heatmapData?.length
    ? heatmapData.reduce((sum, value) => sum + Math.max(0, Math.min(1, value)), 0) / heatmapData.length
    : 0;

  return (
    <section className="inference-panel">
      <div className="inference-panel__header">
        <div>
          <div className="inference-panel__eyebrow">推理结果</div>
          <div className="inference-panel__title">心律分析</div>
        </div>
        <div className="inference-panel__meta">
          <span>{inferenceTime ? `${inferenceTime.toFixed(0)} ms` : '实时'}</span>
          <span>{Math.round(avgHeatmap * 100)}% 热区</span>
        </div>
      </div>

      <div className="inference-panel__summary">
        <div>
          <span>最高置信度</span>
          <strong>{Math.round(peakProbability * 100)}%</strong>
        </div>
        <div>
          <span>候选节律</span>
          <strong>{rankedPredictions[0]?.className ?? '待识别'}</strong>
        </div>
      </div>

      <div className="inference-panel__list">
        {rankedPredictions.map((prediction) => {
          const widthPct = `${Math.round(prediction.probability * 100)}%`;

          return (
            <button
              key={prediction.className}
              type="button"
              className="inference-row"
              onClick={() => onPredictionClick?.(prediction)}
            >
              <div className="inference-row__meta">
                <span className="inference-row__name">{prediction.className}</span>
                <span className="inference-row__value">{Math.round(prediction.probability * 100)}%</span>
              </div>
              <div className="inference-row__bar" aria-hidden="true">
                <span style={{ width: widthPct }} />
              </div>
            </button>
          );
        })}
      </div>
      {heatmapData?.length ? (
        <div className="inference-panel__strip" aria-hidden="true">
          {heatmapData.slice(0, 20).map((value, index) => (
            <span
              key={`${index}-${value.toFixed(2)}`}
              style={{
                opacity: 0.35 + Math.max(0, Math.min(1, value)) * 0.55
              }}
            />
          ))}
        </div>
      ) : null}
    </section>
  );
};

export default HeatmapOverlay;
