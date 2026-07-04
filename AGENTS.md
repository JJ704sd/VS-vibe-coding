# Repository Guidelines

> 通用 AI 代理 / 人类贡献者规范 · 最近更新:2026-07-04

## 适用范围

本文件按 [agents.md spec](https://agents.md/) 编写,供任何 AI 编码代理(GitHub Copilot、Cursor、Codex、Aider、Devin、Gemini CLI 等)和人类贡献者共同遵守。

**如果你用的是 Claude Code**,请同时阅读 [`CLAUDE.md`](CLAUDE.md) — 它包含项目架构、命令清单、调试速查、任务路由等 Claude 专属决策框架,与本文档是补充关系而非替代。

## 项目结构与模块组织

本仓库是 ECG 标注与训练演示平台。

| 目录 | 用途 |
|------|------|
| `src/pages/` | 页面级组件 |
| `src/components/` | 共享组件 |
| `src/pages/components/` | 页面内共享展示逻辑 |
| `src/services/` | 业务服务(API / 解析 / 导出) |
| `src/store/` | Redux 状态切片 |
| `src/utils/` | 工具函数 |
| `src/types/` | TypeScript 类型 |
| `src/config/` | 运行配置(env.ts 等) |
| `public/` / `templates/` | 静态入口 / HTML 模板 |
| `mock-api/` | 本地病例 mock API |
| `proxy-server/` | ECGFounder Python sidecar |
| `docs/` | 文档 / specs / plans |
| `.planning/` | 当前活跃的多步任务跟踪 |

## 编码风格与命名约定

- TypeScript strict mode + ESLint + Prettier
- 2 空格缩进
- React 组件:`PascalCase`
- hooks:`useXxx`
- 服务模块:清晰领域名(如 `trainingApi.ts`, `ecgAssistantApi.ts`)
- 新增页面保持 lazy route 模式(`React.lazy()` + `Suspense`)
- 新增服务优先放 `src/services/`,共享展示逻辑优先放 `src/pages/components/` 或 `src/components/`
- Redux 状态字段含不可序列化数据(如 TF tensor)必须**排除**在序列化之外

## 测试规范

- 前端测试:`*.test.ts`,尽量靠近被测服务或 view model
- 后端测试:`proxy-server/tests/test_*.py`
- 修复 bug 优先补回归测试
- 涉及训练合同 / parser / Sidecar API / 关键 UI 数据流时,**至少**运行相关最小测试
- 合并前跑全量:`npm run check` + `npm run test:backend`
- 不引入冗余测试(thin wrapper / mock 自指 / 与其他文件 100% 重叠的 → 删)

## 提交与 PR 规范

**Commit message**:简短 Conventional Commits 风格,例如:

- `feat: show agent decision summaries`
- `fix: handle preflight permission errors`
- `docs: update review after main merge`
- `refactor: extract ecg lead normalization`
- `chore: prune redundant test files`

**PR 描述**应说明:

- 变更范围
- 验证命令
- 演示影响
- 已知风险
- UI 改动附截图或说明可复核页面
- 涉及 ECGFounder 外部仓改动**必须**单独分支、单独 PR

## 安全与配置提示

- 当前 API 地址和 `ECGFOUNDER_BASE` 主要面向本地 demo
- **不要**提交真实病例数据、模型权重、训练缓存或 `outputs/` 大文件
- Sidecar 暴露本地训练和 checkpoint 能力,部署到非本机前需:
  - 限制 CORS
  - 校验路径
  - 增加鉴权

## 环境变量与运行配置

环境变量机制、关键变量表、新增端点步骤详见 [`CLAUDE.md` § 环境变量与运行配置](CLAUDE.md#环境变量与运行配置)。

简要原则:

- 唯一配置源:`src/config/env.ts`
- 不要直接 `process.env.X || fallback`(绕过兜底链)
- webpack `DefinePlugin` 把 `process.env.X` 替换成编译期常量
- dev 读仓库根 `.env`;prod 只读 shell 环境

## 必读文档(按需)

- [`CLAUDE.md`](CLAUDE.md) — Claude Code 专属指令(架构、命令、调试速查、任务路由)
- `SPEC.md` — 项目规格
- `docs/superpowers/specs/` — 各子模块详细设计
- `docs/superpowers/plans/` — 历史实施计划
- `.planning/` — 当前活跃任务跟踪
- `CHANGELOG.md` — 变更记录
- `README.md` — 仓库入口