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

  return (
    <Layout className="app-layout">
      <Sider width={220} theme="dark" breakpoint="lg" collapsedWidth={80} className="app-sider">
        <div className="app-logo">ECG Platform</div>
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
          <span className="app-header-title">心电图标注与分析平台</span>
          <span className="app-header-status">在线</span>
        </Header>
        {children}
      </Layout>
    </Layout>
  );
};

export default MainLayout;
