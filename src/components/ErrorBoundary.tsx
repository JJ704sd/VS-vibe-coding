import React, { Component, ErrorInfo, ReactNode } from 'react';
import { Card, Button, Typography, Space } from 'antd';
import { WarningOutlined } from '@ant-design/icons';

const { Text, Title } = Typography;

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
    };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    this.setState({ errorInfo });
    this.props.onError?.(error, errorInfo);
    console.error('[ErrorBoundary] Caught error:', error, errorInfo);
  }

  handleReload = (): void => {
    this.setState({ hasError: false, error: null, errorInfo: null });
    window.location.reload();
  };

  handleReset = (): void => {
    this.setState({ hasError: false, error: null, errorInfo: null });
  };

  render(): ReactNode {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <Card
          style={{
            margin: 24,
            textAlign: 'center',
            background: 'linear-gradient(135deg, #fff5f5 0%, #fff 100%)',
            border: '1px solid #ffccc7',
          }}
        >
          <Space direction="vertical" size="large" style={{ width: '100%' }}>
            <WarningOutlined style={{ fontSize: 48, color: '#ff4d4f' }} />
            <Title level={4} style={{ color: '#cf1322', margin: 0 }}>
              页面渲染出错
            </Title>
            <Text type="secondary">
              应用程序遇到了一些问题，请尝试刷新页面或联系技术支持。
            </Text>
            {process.env.NODE_ENV === 'development' && this.state.error && (
              <Card
                size="small"
                style={{
                  background: '#f5f5f5',
                  textAlign: 'left',
                  maxHeight: 200,
                  overflow: 'auto',
                }}
              >
                <Text code style={{ fontSize: 12, wordBreak: 'break-all' }}>
                  {this.state.error.toString()}
                </Text>
                {this.state.errorInfo?.componentStack && (
                  <pre style={{ fontSize: 10, marginTop: 8, whiteSpace: 'pre-wrap' }}>
                    {this.state.errorInfo.componentStack}
                  </pre>
                )}
              </Card>
            )}
            <Space>
              <Button onClick={this.handleReset}>重试</Button>
              <Button type="primary" onClick={this.handleReload}>
                刷新页面
              </Button>
            </Space>
          </Space>
        </Card>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
