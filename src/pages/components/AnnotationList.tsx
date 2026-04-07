import React from 'react';
import { Card, List, Space, Tag } from 'antd';
import { Annotation } from '../../types';

interface AnnotationListProps {
  annotations: Annotation[];
  totalCount: number;
}

const AnnotationList: React.FC<AnnotationListProps> = ({ annotations, totalCount }) => {
  return (
    <Card className="section-card" title="标注列表" extra={<Tag color="blue">Annotations</Tag>}>
      {totalCount > 0 ? (
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
  );
};

export default AnnotationList;
