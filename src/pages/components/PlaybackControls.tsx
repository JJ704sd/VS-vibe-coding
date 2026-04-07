import React from 'react';
import { Card, Button, Space, Tag, Input, Typography } from 'antd';

const { Text } = Typography;

interface PlaybackControlsProps {
  playbackEnabled: boolean;
  playbackStep: number;
  playbackWindowSize: number;
  playbackCursor: number;
  onTogglePlayback: () => void;
  onStepChange: (step: number) => void;
  onWindowSizeChange: (size: number) => void;
  onReset: () => void;
}

const DEFAULT_PLAYBACK_WINDOW = 1800;

const PlaybackControls: React.FC<PlaybackControlsProps> = ({
  playbackEnabled,
  playbackStep,
  playbackWindowSize,
  playbackCursor,
  onTogglePlayback,
  onStepChange,
  onWindowSizeChange,
  onReset,
}) => {
  return (
    <Card
      className="section-card"
      title="动态回放"
      extra={<Tag color={playbackEnabled ? 'blue' : 'default'}>{playbackEnabled ? 'Live' : 'Paused'}</Tag>}
    >
      <Space direction="vertical" style={{ width: '100%' }}>
        <Button onClick={onTogglePlayback} block>
          {playbackEnabled ? '暂停动态回放' : '启动动态回放'}
        </Button>
        <Input
          size="small"
          type="number"
          min={4}
          max={240}
          step={4}
          value={playbackStep}
          onChange={(e) => onStepChange(Math.max(4, Number(e.target.value) || 4))}
          placeholder="回放速度（每帧步长）"
        />
        <Input
          size="small"
          type="number"
          min={300}
          max={6000}
          step={100}
          value={playbackWindowSize}
          onChange={(e) =>
            onWindowSizeChange(Math.max(300, Number(e.target.value) || DEFAULT_PLAYBACK_WINDOW))
          }
          placeholder="窗口长度（样本点）"
        />
        <Button onClick={onReset} block>
          回放重置到起点
        </Button>
        <Text type="secondary">当前游标: {playbackCursor}</Text>
      </Space>
    </Card>
  );
};

export default PlaybackControls;
