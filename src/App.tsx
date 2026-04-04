import React, { Suspense, lazy } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { Layout, Spin } from 'antd';
import MainLayout from './components/Layout/MainLayout';
import './index.css';

const { Content } = Layout;
const Dashboard = lazy(() => import(/* webpackChunkName: "dashboard-page" */ './pages/Dashboard'));
const CaseList = lazy(() => import(/* webpackChunkName: "case-list-page" */ './pages/CaseList'));
const CaseDetail = lazy(() => import(/* webpackChunkName: "case-detail-page" */ './pages/CaseDetail'));
const AnnotationStudio = lazy(
  () => import(/* webpackChunkName: "annotation-studio-page" */ './pages/AnnotationStudio')
);
const AIModels = lazy(() => import(/* webpackChunkName: "ai-models-page" */ './pages/AIModels'));
const Settings = lazy(() => import(/* webpackChunkName: "settings-page" */ './pages/Settings'));

const routeFallback = (
  <div className="route-loading">
    <Spin size="large" tip="Loading workspace..." />
  </div>
);

const App: React.FC = () => {
  return (
    <MainLayout>
      <Content className="app-content">
        <Suspense fallback={routeFallback}>
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
        </Suspense>
      </Content>
    </MainLayout>
  );
};

export default App;
