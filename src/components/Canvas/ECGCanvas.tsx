import React, { useEffect, useRef, useState, useCallback } from 'react';
import { fabric } from 'fabric';
import { useSelector, useDispatch } from 'react-redux';
import { Button, Select, Space, Tooltip } from 'antd';
import { ZoomInOutlined, ZoomOutOutlined, FullscreenOutlined } from '@ant-design/icons';
import { RootState } from '../../store';
import { setCanvasState, addAnnotation, removeAnnotation } from '../../store/ecgSlice';
import { Annotation, ECGLead } from '../../types';

interface ECGCanvasProps {
  width?: number;
  height?: number;
  leads?: ECGLead[];
  onAnnotationChange?: (annotations: Annotation[]) => void;
  controlledTool?: 'pan' | 'annotate';
  annotationType?: Annotation['type'];
  deleteSignal?: number;
}

const ECGCanvas: React.FC<ECGCanvasProps> = ({
  width = 1200,
  height = 600,
  leads = [],
  onAnnotationChange,
  controlledTool,
  annotationType,
  deleteSignal = 0,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fabricCanvasRef = useRef<fabric.Canvas | null>(null);
  const [selectedTool, setSelectedTool] = useState<string>('pan');
  const selectedToolRef = useRef<string>('pan');
  const annotationTypeRef = useRef<Annotation['type'] | undefined>(undefined);
  const selectedAnnotationIdRef = useRef<string | null>(null);
  const dispatch = useDispatch();

  const { canvas, annotations } = useSelector((state: RootState) => state.ecg);

  useEffect(() => {
    selectedToolRef.current = selectedTool;
  }, [selectedTool]);

  useEffect(() => {
    if (controlledTool) {
      setSelectedTool(controlledTool);
      selectedToolRef.current = controlledTool;
    }
  }, [controlledTool]);

  useEffect(() => {
    annotationTypeRef.current = annotationType;
  }, [annotationType]);

  useEffect(() => {
    if (!canvasRef.current || fabricCanvasRef.current) return;

    const canvasInstance = new fabric.Canvas(canvasRef.current, {
      width,
      height,
      backgroundColor: '#07111f',
      selection: false,
      fireRightClick: true,
      stopContextMenu: true,
    });

    canvasInstance.on('mouse:wheel', (opt) => {
      const delta = opt.e.deltaY;
      let zoom = canvasInstance.getZoom() * (delta > 0 ? 0.95 : 1.05);
      zoom = Math.min(Math.max(zoom, 0.5), 5);
      canvasInstance.zoomToPoint({ x: opt.e.offsetX, y: opt.e.offsetY }, zoom);
      dispatch(setCanvasState({ zoom }));
      opt.e.preventDefault();
      opt.e.stopPropagation();
    });

    let isDragging = false;
    let lastPosX = 0;
    let lastPosY = 0;

    canvasInstance.on('mouse:down', (opt) => {
      if (selectedToolRef.current === 'pan') {
        const pointer = canvasInstance.getPointer(opt.e);
        isDragging = true;
        lastPosX = pointer.x;
        lastPosY = pointer.y;
      }
    });

    canvasInstance.on('mouse:move', (opt) => {
      if (selectedToolRef.current === 'pan' && isDragging) {
        const pointer = canvasInstance.getPointer(opt.e);
        const vpt = canvasInstance.viewportTransform;
        if (vpt) {
          vpt[4] += pointer.x - lastPosX;
          vpt[5] += pointer.y - lastPosY;
          canvasInstance.requestRenderAll();
          lastPosX = pointer.x;
          lastPosY = pointer.y;
          dispatch(setCanvasState({ panX: vpt[4], panY: vpt[5] }));
        }
      }
    });

    canvasInstance.on('mouse:up', () => {
      isDragging = false;
    });

    canvasInstance.on('mouse:dblclick', (opt) => {
      if (selectedToolRef.current === 'annotate') {
        const pointer = canvasInstance.getPointer(opt.e);
        handleAddAnnotation(pointer);
      }
    });

    canvasInstance.on('selection:created', (event) => {
      const targetName = event.selected?.[0]?.name;
      if (typeof targetName === 'string' && targetName.startsWith('annotation_')) {
        selectedAnnotationIdRef.current = targetName.replace('annotation_', '');
      }
    });

    canvasInstance.on('selection:updated', (event) => {
      const targetName = event.selected?.[0]?.name;
      if (typeof targetName === 'string' && targetName.startsWith('annotation_')) {
        selectedAnnotationIdRef.current = targetName.replace('annotation_', '');
      }
    });

    canvasInstance.on('selection:cleared', () => {
      selectedAnnotationIdRef.current = null;
    });

    fabricCanvasRef.current = canvasInstance;

    return () => {
      canvasInstance.dispose();
      fabricCanvasRef.current = null;
    };
  }, [dispatch, height, width]);

  useEffect(() => {
    if (!fabricCanvasRef.current || leads.length === 0) return;
    renderWaveforms();
  }, [leads]);

  useEffect(() => {
    if (!deleteSignal) return;
    handleDeleteSelectedAnnotation();
  }, [deleteSignal]);

  const renderWaveforms = useCallback(() => {
    const canvasInstance = fabricCanvasRef.current;
    if (!canvasInstance) return;

    canvasInstance.getObjects().forEach((obj) => {
      if (
        obj.name?.startsWith('waveform_') ||
        obj.name?.startsWith('label_') ||
        obj.name?.startsWith('grid_')
      ) {
        canvasInstance.remove(obj);
      }
    });

    const colors = ['#47f5c8', '#7ec8ff', '#ffd76b', '#ff8ca8', '#8fe35f', '#c8a8ff'];
    const leadBandHeight = height / Math.max(1, leads.length);
    const centerOffset = leadBandHeight / 2;
    const minorGridSize = Math.max(10, Math.floor(leadBandHeight / 8));

    leads.forEach((lead, index) => {
      const color = colors[index % colors.length];
      const yOffset = index * leadBandHeight + centerOffset;
      const points: number[] = [];
      let maxAbs = 0.01;
      for (let i = 0; i < lead.data.length; i++) {
        const abs = Math.abs(lead.data[i]);
        if (abs > maxAbs) maxAbs = abs;
      }
      const amplitudeScale = (leadBandHeight * 0.34) / maxAbs;

      lead.data.forEach((value, i) => {
        const x = (i / Math.max(1, lead.data.length - 1)) * width;
        const y = yOffset - value * amplitudeScale;
        points.push(x, y);
      });

      const polyline = new fabric.Polyline(
        points.reduce((acc: { x: number; y: number }[], val, i) => {
          if (i % 2 === 0) acc.push({ x: val, y: points[i + 1] });
          return acc;
        }, []),
        {
          stroke: color,
          strokeWidth: 1.7,
          fill: 'transparent',
          selectable: false,
          evented: false,
          name: `waveform_${lead.name}`,
          strokeLineJoin: 'round',
          strokeLineCap: 'round',
          shadow: new fabric.Shadow({
            color: `${color}88`,
            blur: 6,
            offsetX: 0,
            offsetY: 0,
          }),
        }
      );

      canvasInstance.add(polyline);

      const label = new fabric.Text(lead.name, {
        left: 12,
        top: yOffset - 14,
        fontSize: 13,
        fontWeight: '600',
        fill: color,
        selectable: false,
        name: `label_${lead.name}`,
      });
      canvasInstance.add(label);
    });

    drawGrid(canvasInstance, minorGridSize, leadBandHeight);
    canvasInstance.renderAll();
  }, [leads, width, height]);

  const drawGrid = (canvasInstance: fabric.Canvas, minorGridSize: number, leadBandHeight: number) => {
    const gridLines: fabric.Object[] = [];

    const majorXStep = minorGridSize * 5;
    const majorYStep = Math.max(20, Math.floor(leadBandHeight / 2));

    for (let y = 0; y <= height; y += minorGridSize) {
      gridLines.push(
        new fabric.Line([0, y, width, y], {
          stroke: y % majorYStep === 0 ? '#26354a' : '#1a2536',
          strokeWidth: y % majorYStep === 0 ? 1.1 : 0.6,
          selectable: false,
          evented: false,
          name: `grid_h_${y}`,
        })
      );
    }

    for (let x = 0; x <= width; x += minorGridSize) {
      gridLines.push(
        new fabric.Line([x, 0, x, height], {
          stroke: x % majorXStep === 0 ? '#2b3c54' : '#1d2a3c',
          strokeWidth: x % majorXStep === 0 ? 1.1 : 0.6,
          selectable: false,
          evented: false,
          name: `grid_v_${x}`,
        })
      );
    }

    for (let index = 1; index < leads.length; index += 1) {
      const y = index * leadBandHeight;
      gridLines.push(
        new fabric.Line([0, y, width, y], {
          stroke: '#3a4f6f',
          strokeWidth: 1.4,
          selectable: false,
          evented: false,
          name: `grid_sep_${index}`,
        })
      );
    }

    gridLines.forEach((line) => {
      canvasInstance.add(line);
      canvasInstance.sendToBack(line);
    });
  };

  const handleAddAnnotation = (pointer: { x: number; y: number }) => {
    const annotationTypes: Annotation['type'][] = ['P', 'Q', 'R', 'S', 'T'];
    const allAnnotationTypes: Annotation['type'][] = ['P', 'Q', 'R', 'S', 'T', 'ST', 'U'];
    const selectedType = annotationTypeRef.current;
    const type =
      selectedType && allAnnotationTypes.includes(selectedType)
        ? selectedType
        : annotationTypes[Math.floor(Math.random() * annotationTypes.length)];

    const newAnnotation: Annotation = {
      id: `ann_${Date.now()}`,
      type,
      position: pointer.x,
      confidence: 1.0,
      manual: true,
      timestamp: Date.now(),
    };

    dispatch(addAnnotation(newAnnotation));
    onAnnotationChange?.([...annotations, newAnnotation]);

    const circle = new fabric.Circle({
      radius: 8,
      fill: 'transparent',
      stroke: '#ff0000',
      strokeWidth: 2,
      left: pointer.x - 8,
      top: pointer.y - 8,
      selectable: true,
      name: `annotation_${newAnnotation.id}`,
    });

    const label = new fabric.Text(type, {
      fontSize: 12,
      fill: '#ff0000',
      left: pointer.x - 4,
      top: pointer.y - 20,
      selectable: false,
      name: `annotation_label_${newAnnotation.id}`,
    });

    fabricCanvasRef.current?.add(circle, label);
    fabricCanvasRef.current?.renderAll();
  };

  const handleDeleteSelectedAnnotation = () => {
    const annotationId = selectedAnnotationIdRef.current;
    const canvasInstance = fabricCanvasRef.current;
    if (!annotationId || !canvasInstance) {
      return;
    }

    canvasInstance.getObjects().forEach((obj) => {
      if (
        obj.name === `annotation_${annotationId}` ||
        obj.name === `annotation_label_${annotationId}`
      ) {
        canvasInstance.remove(obj);
      }
    });
    canvasInstance.discardActiveObject();
    canvasInstance.renderAll();
    dispatch(removeAnnotation(annotationId));
    selectedAnnotationIdRef.current = null;
  };

  const handleZoom = (direction: 'in' | 'out' | 'reset') => {
    const canvasInstance = fabricCanvasRef.current;
    if (!canvasInstance) return;

    if (direction === 'reset') {
      canvasInstance.setViewportTransform([1, 0, 0, 1, 0, 0]);
      dispatch(setCanvasState({ zoom: 1, panX: 0, panY: 0 }));
    } else {
      const newZoom =
        direction === 'in' ? canvasInstance.getZoom() * 1.2 : canvasInstance.getZoom() * 0.8;
      canvasInstance.setZoom(newZoom);
      dispatch(setCanvasState({ zoom: newZoom }));
    }
    canvasInstance.renderAll();
  };

  const activeToolLabel = selectedTool === 'annotate' ? '标注' : '平移';
  const annotationCount = annotations.length;
  const leadCount = leads.length;

  return (
    <div className="ecg-canvas-container">
      <div
        style={{
          position: 'absolute',
          top: 12,
          left: 12,
          right: 12,
          zIndex: 10,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          padding: '10px 12px',
          borderRadius: 14,
          background: 'rgba(8, 14, 24, 0.64)',
          border: '1px solid rgba(255, 255, 255, 0.08)',
          backdropFilter: 'blur(16px)',
        }}
      >
        <Space size={8} wrap>
          <Tooltip title="放大">
            <Button icon={<ZoomInOutlined />} onClick={() => handleZoom('in')} size="small" />
          </Tooltip>
          <Tooltip title="缩小">
            <Button icon={<ZoomOutOutlined />} onClick={() => handleZoom('out')} size="small" />
          </Tooltip>
          <Tooltip title="重置视图">
            <Button icon={<FullscreenOutlined />} onClick={() => handleZoom('reset')} size="small" />
          </Tooltip>
          <Select
            value={selectedTool}
            onChange={setSelectedTool}
            style={{ width: 110 }}
            options={[
              { value: 'pan', label: '平移' },
              { value: 'annotate', label: '标注' },
            ]}
          />
        </Space>

        <Space size={10} wrap>
          <span style={{ color: '#e7eef7', fontSize: 12 }}>导联 {leadCount}</span>
          <span style={{ color: '#e7eef7', fontSize: 12 }}>标注 {annotationCount}</span>
          <span style={{ color: '#e7eef7', fontSize: 12 }}>模式 {activeToolLabel}</span>
        </Space>
      </div>

      <div
        style={{
          position: 'absolute',
          bottom: 12,
          left: 12,
          zIndex: 10,
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '8px 12px',
          borderRadius: 999,
          background: 'rgba(8, 14, 24, 0.64)',
          border: '1px solid rgba(255, 255, 255, 0.08)',
          color: '#d8e3f2',
          backdropFilter: 'blur(16px)',
        }}
      >
        <span style={{ fontSize: 12 }}>缩放 {Math.round(canvas.zoom * 100)}%</span>
        <span style={{ opacity: 0.4 }}>•</span>
        <span style={{ fontSize: 12 }}>
          {selectedTool === 'annotate' ? '双击波形添加标注' : '拖拽移动波形'}
        </span>
      </div>
      <canvas ref={canvasRef} style={{ display: 'block' }} />
    </div>
  );
};

export default ECGCanvas;
