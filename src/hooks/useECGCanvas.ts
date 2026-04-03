import { useCallback, useEffect, useMemo, useRef } from 'react';
import { fabric } from 'fabric';
import { useDispatch, useSelector } from 'react-redux';
import { RootState } from '../store';
import {
  addAnnotation,
  removeAnnotation,
  setCanvasState,
  updateAnnotation,
} from '../store/ecgSlice';
import {
  Annotation,
  AnnotationLayerConfig,
  ECGLead,
  WaveformLayerConfig,
} from '../types';

interface UseECGCanvasOptions {
  width?: number;
  height?: number;
  leads?: ECGLead[];
  waveformConfig?: Partial<WaveformLayerConfig>;
  annotationConfig?: Partial<AnnotationLayerConfig>;
  onAnnotationAdd?: (annotation: Annotation) => void;
  onAnnotationUpdate?: (annotation: Annotation) => void;
  onAnnotationRemove?: (id: string) => void;
}

interface UseECGCanvasReturn {
  canvas: fabric.Canvas | null;
  containerRef: React.RefObject<HTMLDivElement | null>;
  zoom: number;
  panX: number;
  panY: number;
  selectedLead: string | null;
  selectedAnnotation: string | null;
  addMarker: (type: Annotation['type'], position: { x: number; y: number }) => void;
  removeMarker: (id: string) => void;
  updateMarker: (id: string, updates: Partial<Annotation>) => void;
  setZoom: (zoom: number) => void;
  resetView: () => void;
  exportAsImage: () => string | null;
  exportAsSVG: () => string | null;
}

export function useECGCanvas(options: UseECGCanvasOptions = {}): UseECGCanvasReturn {
  const {
    width = 1200,
    height = 600,
    leads = [],
    waveformConfig = {},
    annotationConfig = {},
    onAnnotationAdd,
    onAnnotationUpdate,
    onAnnotationRemove,
  } = options;

  const dispatch = useDispatch();
  const canvasState = useSelector((state: RootState) => state.ecg.canvas);
  const annotations = useSelector((state: RootState) => state.ecg.annotations);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<fabric.Canvas | null>(null);

  const mergedWaveformConfig = useMemo<WaveformLayerConfig>(
    () => ({
      gridVisible: true,
      gridColor: '#1a1a1a',
      gridSize: 25,
      backgroundColor: '#000000',
      amplitude: 50,
      timeScale: 25,
      ...waveformConfig,
    }),
    [waveformConfig]
  );

  const mergedAnnotationConfig = useMemo<AnnotationLayerConfig>(
    () => ({
      markerRadius: 8,
      markerColor: '#ff0000',
      labelFontSize: 12,
      labelColor: '#ff0000',
      showConfidence: true,
      ...annotationConfig,
    }),
    [annotationConfig]
  );

  const renderCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    canvas.clear();
    canvas.backgroundColor = mergedWaveformConfig.backgroundColor;

    if (mergedWaveformConfig.gridVisible) {
      for (let y = 0; y <= height; y += mergedWaveformConfig.gridSize) {
        const line = new fabric.Line([0, y, width, y], {
          stroke: mergedWaveformConfig.gridColor,
          strokeWidth: 0.5,
          selectable: false,
          evented: false,
        });
        canvas.add(line);
        canvas.sendToBack(line);
      }

      for (let x = 0; x <= width; x += mergedWaveformConfig.gridSize) {
        const line = new fabric.Line([x, 0, x, height], {
          stroke: mergedWaveformConfig.gridColor,
          strokeWidth: 0.5,
          selectable: false,
          evented: false,
        });
        canvas.add(line);
        canvas.sendToBack(line);
      }
    }

    const leadHeight = height / Math.max(1, leads.length + 1);
    const colors = ['#00ff00', '#ffff00', '#00ffff', '#ff00ff', '#ff6600', '#888888'];

    leads.forEach((lead, leadIndex) => {
      const color = colors[leadIndex % colors.length];
      const yOffset = (leadIndex + 1) * leadHeight;
      const points = lead.data.map((value, pointIndex) => ({
        x: (pointIndex / Math.max(1, lead.data.length - 1)) * width,
        y: yOffset - value * mergedWaveformConfig.amplitude,
      }));

      canvas.add(
        new fabric.Text(lead.name, {
          left: 10,
          top: yOffset - 16,
          fontSize: 12,
          fill: color,
          selectable: false,
          evented: false,
        })
      );

      if (points.length > 1) {
        canvas.add(
          new fabric.Polyline(points, {
            stroke: color,
            strokeWidth: 1.5,
            fill: 'transparent',
            selectable: false,
            evented: false,
          })
        );
      }
    });

    annotations.forEach((annotation) => {
      const x = annotation.x ?? annotation.position;
      const y = annotation.y ?? 100;
      canvas.add(
        new fabric.Circle({
          radius: mergedAnnotationConfig.markerRadius,
          left: x - mergedAnnotationConfig.markerRadius,
          top: y - mergedAnnotationConfig.markerRadius,
          fill: 'transparent',
          stroke: mergedAnnotationConfig.markerColor,
          strokeWidth: 2,
          selectable: false,
          evented: false,
        })
      );
      canvas.add(
        new fabric.Text(annotation.type, {
          left: x - 4,
          top: y - mergedAnnotationConfig.markerRadius - mergedAnnotationConfig.labelFontSize - 2,
          fontSize: mergedAnnotationConfig.labelFontSize,
          fill: mergedAnnotationConfig.labelColor,
          selectable: false,
          evented: false,
        })
      );
    });

    canvas.renderAll();
  }, [annotations, height, leads, mergedAnnotationConfig, mergedWaveformConfig, width]);

  useEffect(() => {
    if (!containerRef.current || canvasRef.current) {
      return;
    }

    const element = document.createElement('canvas');
    containerRef.current.appendChild(element);

    const canvas = new fabric.Canvas(element, {
      width,
      height,
      backgroundColor: mergedWaveformConfig.backgroundColor,
      selection: false,
    });

    canvas.on('mouse:wheel', (event) => {
      const delta = event.e.deltaY;
      const nextZoom = Math.min(Math.max(canvas.getZoom() * (delta > 0 ? 0.95 : 1.05), 0.2), 5);
      canvas.zoomToPoint({ x: event.e.offsetX, y: event.e.offsetY }, nextZoom);
      dispatch(setCanvasState({ zoom: nextZoom }));
      event.e.preventDefault();
      event.e.stopPropagation();
    });

    canvasRef.current = canvas;
    renderCanvas();

    return () => {
      canvas.dispose();
      canvasRef.current = null;
      if (containerRef.current?.contains(element)) {
        containerRef.current.removeChild(element);
      }
    };
  }, [dispatch, height, mergedWaveformConfig.backgroundColor, renderCanvas, width]);

  useEffect(() => {
    renderCanvas();
  }, [renderCanvas]);

  const addMarker = useCallback((type: Annotation['type'], position: { x: number; y: number }) => {
    const annotation: Annotation = {
      id: `ann_${Date.now()}`,
      type,
      position: position.x,
      x: position.x,
      y: position.y,
      confidence: 1,
      manual: true,
      timestamp: Date.now(),
    };

    dispatch(addAnnotation(annotation));
    onAnnotationAdd?.(annotation);
  }, [dispatch, onAnnotationAdd]);

  const removeMarker = useCallback((id: string) => {
    dispatch(removeAnnotation(id));
    onAnnotationRemove?.(id);
  }, [dispatch, onAnnotationRemove]);

  const updateMarker = useCallback((id: string, updates: Partial<Annotation>) => {
    const current = annotations.find((annotation) => annotation.id === id);
    if (!current) {
      return;
    }

    const next = { ...current, ...updates };
    dispatch(updateAnnotation(next));
    onAnnotationUpdate?.(next);
  }, [annotations, dispatch, onAnnotationUpdate]);

  const setZoom = useCallback((zoom: number) => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    canvas.setZoom(zoom);
    canvas.renderAll();
    dispatch(setCanvasState({ zoom }));
  }, [dispatch]);

  const resetView = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    canvas.setViewportTransform([1, 0, 0, 1, 0, 0]);
    canvas.renderAll();
    dispatch(setCanvasState({ zoom: 1, panX: 0, panY: 0 }));
  }, [dispatch]);

  const exportAsImage = useCallback(() => {
    return canvasRef.current?.toDataURL({ format: 'png', multiplier: 2 }) || null;
  }, []);

  const exportAsSVG = useCallback(() => {
    return canvasRef.current?.toSVG() || null;
  }, []);

  return {
    canvas: canvasRef.current,
    containerRef,
    zoom: canvasState.zoom,
    panX: canvasState.panX,
    panY: canvasState.panY,
    selectedLead: canvasState.selectedLead,
    selectedAnnotation: canvasState.selectedAnnotation,
    addMarker,
    removeMarker,
    updateMarker,
    setZoom,
    resetView,
    exportAsImage,
    exportAsSVG,
  };
}

export default useECGCanvas;
