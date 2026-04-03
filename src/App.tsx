import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { Layout } from 'antd';
import MainLayout from './components/Layout/MainLayout';
import Dashboard from './pages/Dashboard';
import CaseList from './pages/CaseList';
import CaseDetail from './pages/CaseDetail';
import AnnotationStudio from './pages/AnnotationStudio';
import AIModels from './pages/AIModels';
import Settings from './pages/Settings';
import './index.css';

const { Content } = Layout;

const App: React.FC = () => {
  return (
    <MainLayout>
      <Content className="app-content">
        <Routes>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/cases" element={<CaseList />} />
          <Route path="/cases/:patientId" element={<CaseDetail />} />
          <Route path="/annotation" element={<AnnotationStudio />} />
          <Route path="/annotation/:recordId" element={<AnnotationStudio />} />
          <Route path="/ai-models" element={<AIModels />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </Content>
    </MainLayout>
  );
};

export default App;
