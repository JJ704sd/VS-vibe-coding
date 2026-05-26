# Repository Guidelines

## 项目结构与模块组织

本仓库是 ECG 标注与训练演示平台。前端源码位于 `src/`：页面在 `src/pages/`，共享组件在 `src/components/`，业务服务在 `src/services/`，Redux 状态在 `src/store/`，工具函数在 `src/utils/`，类型在 `src/types/`。静态入口和模板分别在 `public/`、`templates/`。本地病例 mock API 位于 `mock-api/`，ECGFounder Sidecar 位于 `proxy-server/`，项目文档和计划位于 `docs/`、`.planning/`。

## 构建、测试与本地开发

- `npm start`：同时启动前端开发服务和 mock API。
- `npm run dev:web`：仅启动 Webpack dev server。
- `npm run dev:api`：仅启动 `mock-api/server.js`。
- `npm run build`：生产构建到 `dist/`。
- `npm run lint`：运行 ESLint。
- `npm run typecheck`：运行主项目和测试 TypeScript 类型检查。
- `npm run test:unit` 或 `npm test`：运行 Node 内置 test runner 的前端单测。
- `npm run test:backend`：运行 `proxy-server/tests` 下的 pytest。
- `npm run check`：执行 lint、typecheck、前端单测和 build。
- `npm run preflight:demo -- --live`：检查演示端口、Sidecar、runner 和 observer。

## 编码风格与命名约定

使用 TypeScript strict mode、ESLint 和 Prettier。保持 2 空格缩进，React 组件使用 `PascalCase`，hooks 使用 `useXxx`，服务模块使用清晰的领域名，如 `trainingApi.ts`。新增页面保持 lazy route 模式；新增服务优先放入 `src/services/`，共享展示逻辑优先放入 `src/pages/components/` 或 `src/components/`。

## 测试规范

前端测试文件使用 `*.test.ts`，尽量靠近被测服务或 view model。后端测试位于 `proxy-server/tests/test_*.py`。修复 bug 时优先补回归测试；涉及训练合同、parser、Sidecar API 或关键 UI 数据流时，至少运行相关最小测试，并在合并前运行 `npm run check` 和 `npm run test:backend`。

## 提交与 PR 规范

Git 历史使用简短 Conventional Commits 风格，例如 `feat: show agent decision summaries`、`fix: handle preflight permission errors`、`docs: update review after main merge`。PR 应说明变更范围、验证命令、演示影响和已知风险；涉及 UI 的改动应附截图或说明可复核页面；涉及 ECGFounder 外部仓库的改动必须单独分支、单独 PR。

## 安全与配置提示

当前 API 地址和 `ECGFOUNDER_BASE` 主要面向本地 demo。不要提交真实病例数据、模型权重、训练缓存或 `outputs/` 大文件。Sidecar 暴露本地训练和 checkpoint 能力，部署到非本机前需限制 CORS、校验路径并增加鉴权。
