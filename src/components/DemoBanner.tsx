import React from 'react';
import { Alert } from 'antd';
import { ExperimentOutlined } from '@ant-design/icons';

/**
 * Global, non-dismissible banner that makes the demo / non-clinical boundary
 * visible on every page of the application. Sits at the top of the main
 * content area inside MainLayout.
 *
 * Why a banner (and not just a footer):
 *   - The UI looks plausibly medical at a glance, and a footer disclaimer
 *     is easy to miss. The header is the one region the eye lands on first
 *     when a new page loads.
 *   - "DISMISSIBLE" was deliberately left out: the only way to silence this
 *     banner is to point the deployment at real data and real models, at
 *     which point the `DEMO_DATA` / `DEMO_INFERENCE` build-time flags should
 *     also flip to false and the banner will no longer be rendered.
 *
 * The banner is *not* a substitute for documentation: README and the
 * SmartAssistancePanel copy still call out the same boundary in prose, and
 * the AIModels / AnnotationStudio pages have their own in-context tags.
 */
const DemoBanner: React.FC = () => (
  <Alert
    className="demo-banner"
    type="warning"
    showIcon
    icon={<ExperimentOutlined />}
    banner
    message="Demo / Research Preview — Not a Medical Device"
    description={
      <>
        本平台用于研究、教学与 UI 演示，所有患者数据来自本地 PTB-XL 备份，
        推理模型在 TF.js 不可用时进入 mock 路径，诊断结果仅供辅助参考，<b>不可用于临床决策</b>。
        Production deployments must replace the mock data source and load a
        validated model before any clinical use.
      </>
    }
  />
);

export default DemoBanner;
