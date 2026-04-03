import React, { useEffect, useRef } from 'react';
import { fabric } from 'fabric';
import { useSelector } from 'react-redux';
import { RootState } from '../../store';
import {
  Annotation,
  AnnotationLayerConfig,
  ECGLead,
  WaveformLayerConfig,
} from '../../types';

interface WaveformRendererProps {
  canvas: fabric.Canvas | null;
  leads: ECGLead[];
  config?: Partial<WaveformLayerConfig>;
}

const defaultWaveformConfig: WaveformLayerConfig = {
  gridVisible: true,
  gridColor: '#1a1a1a',
  gridSize: 25,
  backgroundColor: '#000000',
  amplitude: 50,
  timeScale: 25,
};

export const WaveformRenderer: React.FC<WaveformRendererProps> = ({
  canvas,
  leads,
  config = {},
}) => {
  const mergedConfig = { ...defaultWaveformConfig, ...config };
  const isRendering = useRef(false);
  const canvasState = useSelector((state: RootState) => state.ecg.canvas);

  useEffect(() => {
    if (!canvas || isRendering.current || leads.length === 0) {
      return;
    }

    isRendering.current = true;

    canvas.getObjects().forEach((obj) => {
      if (
        obj.name?.startsWith('waveform_') ||
        obj.name?.startsWith('grid_') ||
        obj.name?.startsWith('label_')
      ) {
        canvas.remove(obj);
      }
    });

    const width = canvas.getWidth() || 1200;
    const height = canvas.getHeight() || 600;

    if (mergedConfig.gridVisible) {
      for (let i = 0; i <= height / mergedConfig.gridSize; i += 1) {
        const y = i * mergedConfig.gridSize;
        const line = new fabric.Line([0, y, width, y], {
          stroke: mergedConfig.gridColor,
          strokeWidth: 0.5,
          selectable: false,
          evented: false,
          name: `grid_h_${i}`,
        });
        canvas.add(line);
        canvas.sendToBack(line);
      }

      for (let i = 0; i <= width / mergedConfig.gridSize; i += 1) {
        const x = i * mergedConfig.gridSize;
        const line = new fabric.Line([x, 0, x, height], {
          stroke: mergedConfig.gridColor,
          strokeWidth: 0.5,
          selectable: false,
          evented: false,
          name: `grid_v_${i}`,
        });
        canvas.add(line);
        canvas.sendToBack(line);
      }
    }

    const colors = ['#00ff00', '#ffff00', '#00ffff', '#ff00ff', '#ff6600', '#888888'];
    const leadHeight = height / (leads.length + 1);

    leads.forEach((lead, index) => {
      const color = colors[index % colors.length];
      const yOffset = (index + 1) * leadHeight;

      canvas.add(
        new fabric.Text(lead.name, {
          left: 10,
          top: yOffset - 7,
          fontSize: 14,
          fill: color,
          selectable: false,
          evented: false,
          name: `label_${lead.name}`,
        })
      );

      const stepX = width / Math.max(1, lead.data.length - 1);
      const points = lead.data.map((value, pointIndex) => ({
        x: pointIndex * stepX,
        y: yOffset - value * mergedConfig.amplitude,
      }));

      if (points.length > 1) {
        canvas.add(
          new fabric.Polyline(points, {
            stroke: color,
            strokeWidth: 1.5,
            fill: 'transparent',
            selectable: false,
            evented: false,
            name: `waveform_${lead.name}`,
          })
        );
      }
    });

    canvas.renderAll();
    isRendering.current = false;
  }, [canvas, canvasState.zoom, leads, mergedConfig]);

  return null;
};

interface AnnotationLayerProps {
  canvas: fabric.Canvas | null;
  annotations: Annotation[];
  config?: Partial<AnnotationLayerConfig>;
}

const defaultAnnotationConfig: AnnotationLayerConfig = {
  markerRadius: 8,
  markerColor: '#ff0000',
  labelFontSize: 12,
  labelColor: '#ff0000',
  showConfidence: true,
};

export const AnnotationLayer: React.FC<AnnotationLayerProps> = ({
  canvas,
  annotations,
  config = {},
}) => {
  const mergedConfig = { ...defaultAnnotationConfig, ...config };
  const isRendering = useRef(false);

  useEffect(() => {
    if (!canvas || isRendering.current) {
      return;
    }

    isRendering.current = true;

    canvas.getObjects().forEach((obj) => {
      if (
        obj.name?.startsWith('annotation_') ||
        obj.name?.startsWith('annotation_label_')
      ) {
        canvas.remove(obj);
      }
    });

    annotations.forEach((annotation) => {
      const x = annotation.x ?? annotation.position;
      const y = annotation.y ?? 100;
      const colorMap: Record<string, string> = {
        P: '#00ff00',
        Q: '#ff6600',
        R: '#ff0000',
        S: '#ff6600',
        T: '#00ff00',
        ST: '#ffff00',
        U: '#00ffff',
      };
      const color = colorMap[annotation.type] || mergedConfig.markerColor;

      const circle = new fabric.Circle({
        radius: mergedConfig.markerRadius,
        fill: 'transparent',
        stroke: color,
        strokeWidth: 2,
        left: x - mergedConfig.markerRadius,
        top: y - mergedConfig.markerRadius,
        selectable: true,
      });

      const labelText =
        mergedConfig.showConfidence && annotation.confidence < 1
          ? `${annotation.type} ${Math.round(annotation.confidence * 100)}%`
          : annotation.type;

      const label = new fabric.Text(labelText, {
        fontSize: mergedConfig.labelFontSize,
        fill: color,
        left: x - mergedConfig.labelFontSize,
        top: y - mergedConfig.markerRadius - mergedConfig.labelFontSize - 4,
        selectable: false,
        name: `annotation_label_${annotation.id}`,
      });

      canvas.add(
        new fabric.Group([circle, label], {
          left: x,
          top: y,
          originX: 'center',
          originY: 'center',
          name: `annotation_${annotation.id}`,
          data: { annotationId: annotation.id },
        })
      );
    });

    canvas.renderAll();
    isRendering.current = false;
  }, [annotations, canvas, mergedConfig]);

  return null;
};

export default WaveformRenderer;
