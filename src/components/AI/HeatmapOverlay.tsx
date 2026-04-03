import React, { useEffect, useRef, useMemo } from 'react';
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

  const colorScales = useMemo(() => ({
    default: d3.scaleSequential(d3.interpolateViridis).domain([0, 1]),
    fire: d3.scaleSequential(d3.interpolateYlOrRd).domain([0, 1]),
    medical: d3.scaleSequential(d3.interpolateBlues).domain([0, 1])
  }), []);

  useEffect(() => {
    if (!svgRef.current || !heatmapData || heatmapData.length === 0) return;

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    const colorScale = colorScales[colorScheme];
    const stepX = width / heatmapData.length;

    const gradient = svg.append('defs')
      .append('linearGradient')
      .attr('id', 'heatmap-gradient')
      .attr('x1', '0%')
      .attr('x2', '100%');

    const stops = [0, 0.25, 0.5, 0.75, 1];
    stops.forEach(stop => {
      gradient.append('stop')
        .attr('offset', `${stop * 100}%`)
        .attr('stop-color', colorScale(stop));
    });

    const heatmapGroup = svg.append('g')
      .attr('class', 'heatmap-group');

    const rectWidth = Math.max(stepX - 1, 1);
    
    heatmapData.forEach((value, index) => {
      const x = index * stepX;
      
      heatmapGroup.append('rect')
        .attr('x', x)
        .attr('y', 0)
        .attr('width', rectWidth)
        .attr('height', height)
        .attr('fill', colorScale(value))
        .attr('opacity', opacity)
        .style('cursor', onHover ? 'pointer' : 'default')
        .on('mouseenter', () => {
          if (onHover) onHover(index, value);
        })
        .on('mouseleave', () => {
          if (onHover) onHover(-1, 0);
        });
    });

  }, [width, height, heatmapData, opacity, colorScheme, colorScales, onHover]);

  return (
    <svg 
      ref={svgRef} 
      width={width} 
      height={height}
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        pointerEvents: 'none',
        zIndex: 10
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
  return null;
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
  return null;
};

export default HeatmapOverlay;