import React from 'react';
import { Card, Button, Space, Tag } from 'antd';
import { Annotation } from '../../types';

interface AnnotationToolbarProps {
  activeTool: 'pan' | 'annotate';
  activeAnnotationType: Annotation['type'];
  onSelectTool: (tool: 'pan' | 'annotate') => void;
  onSelectAnnotationType: (type: Annotation['type']) => void;
  onDeleteAnnotation: () => void;
}

const AnnotationToolbar: React.FC<AnnotationToolbarProps> = ({
  activeTool,
  activeAnnotationType,
  onSelectTool,
  onSelectAnnotationType,
  onDeleteAnnotation,
}) => {
  return (
    <Card className="section-card" title="标注工具" extra={<Tag color="purple">Hotkeys</Tag>}>
      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 10 }}>
        先选择标注类型，再在波形区双击落点；删除时先单击选中标注。
      </div>
      <Space direction="vertical" style={{ width: '100%' }}>
        <Button
          type={activeTool === 'annotate' && activeAnnotationType === 'P' ? 'primary' : 'default'}
          block
          onClick={() => onSelectAnnotationType('P')}
        >
          标注 P 波 (Ctrl+1)
        </Button>
        <Button
          type={activeTool === 'annotate' && activeAnnotationType === 'R' ? 'primary' : 'default'}
          block
          onClick={() => onSelectAnnotationType('R')}
        >
          标注 QRS (Ctrl+2)
        </Button>
        <Button
          type={activeTool === 'annotate' && activeAnnotationType === 'T' ? 'primary' : 'default'}
          block
          onClick={() => onSelectAnnotationType('T')}
        >
          标注 T 波 (Ctrl+3)
        </Button>
        <Button block onClick={() => onSelectTool('pan')}>
          切换平移模式
        </Button>
        <Button block danger onClick={onDeleteAnnotation}>
          删除已选标注
        </Button>
      </Space>
    </Card>
  );
};

export default AnnotationToolbar;
