import React from 'react';
import { Layout, Menu } from 'antd';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  DashboardOutlined,
  FileTextOutlined,
  EditOutlined,
  RobotOutlined,
  SettingOutlined,
} from '@ant-design/icons';

const { Sider, Header } = Layout;

const pageMeta: Record<string, { title: string; subtitle: string; tag: string }> = {
  '/dashboard': {
    title: '仪表盘',
    subtitle: '查看全局负载、模型状态与近期处理趋势。',
    tag: 'Overview',
  },
  '/cases': {
    title: '病例管理',
    subtitle: '检索患者、创建记录并快速进入工作流。',
    tag: 'Registry',
  },
  '/annotation': {
    title: '标注工作台',
    subtitle: '导入心电数据、执行推理并完成人工修订。',
    tag: 'Workbench',
  },
  '/ai-models': {
    title: 'AI 模型',
    subtitle: '查看模型状态、准确率和运行策略。',
    tag: 'Models',
  },
  '/settings': {
    title: '系统设置',
    subtitle: '调整显示、采样与推理偏好。',
    tag: 'Preferences',
  },
};

const MainLayout: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const navigate = useNavigate();
  const location = useLocation();

  const menuItems = [
    {
      key: '/dashboard',
      icon: <DashboardOutlined />,
      label: '仪表盘',
    },
    {
      key: '/cases',
      icon: <FileTextOutlined />,
      label: '病例管理',
    },
    {
      key: '/annotation',
      icon: <EditOutlined />,
      label: '标注工作台',
    },
    {
      key: '/ai-models',
      icon: <RobotOutlined />,
      label: 'AI 模型',
    },
    {
      key: '/settings',
      icon: <SettingOutlined />,
      label: '设置',
    },
  ];

  const selectedKey =
    menuItems.find((item) => location.pathname === item.key || location.pathname.startsWith(`${item.key}/`))
      ?.key || '/dashboard';
  const currentPage = pageMeta[selectedKey] || pageMeta['/dashboard'];

  return (
    <Layout className="app-layout">
      <Sider width={220} theme="dark" breakpoint="lg" collapsedWidth={80} className="app-sider">
        <div className="app-brand">
          <div className="app-brand-mark">ECG</div>
          <div>
            <div className="app-brand-title">ECG Platform</div>
            <div className="app-brand-subtitle">Clinical Workbench</div>
          </div>
        </div>
        <div className="app-brand-status">
          <div className="app-brand-status-line">
            <span>Workspace</span>
            <strong>Ready</strong>
          </div>
          <div className="app-brand-status-line" style={{ marginTop: 8 }}>
            <span>Routes</span>
            <strong>Lazy-loaded</strong>
          </div>
        </div>
        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={[selectedKey]}
          items={menuItems}
          onClick={({ key }) => navigate(key)}
          className="app-menu"
          style={{ marginTop: 10 }}
        />
      </Sider>

      <Layout className="app-content-layout">
        <Header className="app-header">
          <div className="app-header-copy">
            <span className="app-header-title">{currentPage.title}</span>
            <span className="app-header-subtitle">{currentPage.subtitle}</span>
          </div>
          <div className="app-header-cluster">
            <span className="app-header-tag">Workspace online</span>
            <span className="app-header-tag">{currentPage.tag}</span>
          </div>
        </Header>
        {children}
      </Layout>
    </Layout>
  );
};

export default MainLayout;
