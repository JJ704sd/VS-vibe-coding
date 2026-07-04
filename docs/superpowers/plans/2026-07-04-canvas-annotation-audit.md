# Canvas 标注链路审查报告

**日期**：2026-07-04
**范围**：`src/components/Canvas/ECGCanvas.tsx`、`src/components/Canvas/constants.ts`（新）、`src/hooks/useECGCanvas.ts`、`src/pages/AnnotationStudio.tsx`、`src/pages/components/AnnotationToolbar.tsx`、`src/pages/components/AnnotationList.tsx`、`src/utils/exportUtils.ts`、`src/utils/signalProcessor.ts`、`src/store/ecgSlice.ts`、`src/types/index.ts`、`scripts/verify-canvas-coords.mjs`（新）
**方法**：第一性原理阅读代码 + Fabric.js 5.x 源码核对 + 回归测试覆盖 + 手工一致性脚本
**输出约定**：仅列被代码证据支持的风险；每条都列 Evidence、Reproduction、Fix、Regression。已修。

---

## 0. 速读表（TL;DR）

| # | BUG | 一句话 | Severity | 状态 |
|---|---|---|---|---|
| C-01 | 导入新记录后未清空旧标注，跨记录污染 | `applyImportedLeads` 没 dispatch `setAnnotations([])`，Fabric 与 Redux 双轨状态 | **P1** | ✅ 修 |
| C-02 | 自动 R 峰 `viewWidth = 1200` 硬编码 | `AnnotationStudio.tsx:656` 字面常量，与 ECGCanvas width 解耦 | **P1** | ✅ 修 |
| C-03 | `AnnotationToolbar` 缺 ST/U 按钮 | 类型层声明 7 种，UI 只暴露 3 种 | **P2** | ✅ 修 |
| C-04 | `annotation.x` 字段仅 hook 路径设，组件路径缺失 | 单一 source of truth 模糊 | **P2** | ✅ 修（向后兼容） |
| C-05 | ECGCanvas 的 `handleAddAnnotation` / `handleDeleteSelectedAnnotation` 命令式 add/remove Fabric 对象，与 Redux 双轨 | Redux 不是真正的 single source of truth | **P1** | ✅ 修（重构派生） |
| C-06 | 导出 CSV 无单位说明（position 是 px，不是 sample index） | 跨工具语义不清 | P2 | 文档级改进，不修 |
| C-07 | `findRPeaks` 在 `threshold=0` 时永不退出 inPeak | 边界行为 | P3 | 文档化（测试锁住） |

Severity 标度：与 `AUDIT-2026-07-04-model-canvas.md` 一致。

---

## 1. 当前坐标定义（基于代码证据）

### 1.1 `Annotation.position` 的语义

`src/types/index.ts:1-10`：

```ts
export interface Annotation {
  id: string;
  type: 'P' | 'Q' | 'R' | 'S' | 'T' | 'ST' | 'U';
  position: number;        // ← 单一数字
  confidence: number;
  manual: boolean;
  timestamp?: number;
  x?: number;              // ← 可选
  y?: number;              // ← 可选
}
```

### 1.2 写入路径（3 条）

| 路径 | 触发 | 设的字段 | 代码位置（修复前） |
|------|------|----------|---------------------|
| 手动双击波形 | ECGCanvas `mouse:dblclick` | `position: pointer.x` | `ECGCanvas.tsx:286-293` |
| 自动 R 峰 | `handleAutoDetectRPeaks` | `position: (i / (n-1)) * viewWidth`，`viewWidth=1200` 硬编码 | `AnnotationStudio.tsx:656-664` |
| hook addMarker | `useECGCanvas.addMarker` | `position: position.x, x: position.x, y: position.y` | `useECGCanvas.ts:228-238` |

修复后（C-04）：手动路径与自动 R 峰都同时设 `x: pointer.x` / `x: position`，保持向后兼容（旧数据 `x` undefined 时回退 `position`）。

### 1.3 坐标系语义

- `pointer.x` 是 `canvasInstance.getPointer(opt.e)` 返回值。
- Fabric 5.x `Canvas.prototype.getPointer(e)` 不传 `ignoreZoom` 时调 `restorePointerVpt(pointer)`（`node_modules/fabric/dist/fabric.js:12533`），**返回画布逻辑坐标**（未应用 zoom/pan 变换）。
- 波形绘制 `ECGCanvas.tsx:181-185`：`x = (i / Math.max(1, lead.data.length - 1)) * width` —— 画布逻辑坐标。
- 自动 R 峰（修复前）`AnnotationStudio.tsx:660`：`position = (sampleIndex / Math.max(1, lead.data.length - 1)) * viewWidth`（**viewWidth=1200 字面常量**）—— 画布逻辑坐标。
- 修复后（C-02）：`viewWidth = ECG_CANVAS_VIEW_WIDTH`（`src/components/Canvas/constants.ts`），与 ECGCanvas 默认 width 共享常量。

### 1.4 结论

- `position` 的语义是"**画布逻辑坐标 px**"（0..width），与 waveform x 单位一致。
- 没有"是 sample index 还是 px"的元数据 → 导出 CSV/JSON 无单位说明（C-06，未修）。
- 自动 R 峰的 `viewWidth=1200` 是字面常量 → 易破坏（C-02，已修）。
- ECGCanvas 路径与 hook 路径写入字段不一致 → 单一 source of truth 模糊（C-04，已修）。

---

## 2. BUG 详情

### C-01（P1）— 导入新记录后未清空旧标注，跨记录污染

**修复前证据**：
- `AnnotationStudio.tsx:196-220` `applyImportedLeads` 更新 `sourceLeadsRef.current` / `setLeads` / `setPlaybackCursor(0)` / `setAnalysisLeadName`，**没有 `dispatch(setAnnotations([]))`**。
- `ECGCanvas.tsx:155-163` `renderWaveforms` 在 leads 变化时清理 `waveform_/label_/grid_`，**不清理 `annotation_/annotation_label_`**。
- `handleAddAnnotation` (`ECGCanvas.tsx:295-319` 修复前) 直接 `fabricCanvasRef.current?.add(circle, label)` 手动 add，**不通过 Redux 派生**。
- `handleDeleteSelectedAnnotation` (`ECGCanvas.tsx:329-339` 修复前) 直接 `canvasInstance.remove(obj)` + `dispatch(removeAnnotation)`，**Redux 与 Fabric 双轨状态**。

**后果**：
1. 导入新记录后，**旧标注 circle + label 仍挂在新画布上**，视觉错位（基于旧画布逻辑坐标）。
2. Redux store 的 `annotations` 数组仍保留旧值。
3. 导出 JSON/CSV 时 `annotations` 数组包含旧记录的标注 + 新自动 R 峰，**用户无法分辨**。
4. 自动 R 峰检测 `annotations.filter((item) => !item.id.startsWith('auto_r_'))` 只清 auto_r，**手动标注跨记录会被错误保留**。

**复现**（修复前）：
1. 进入默认 demo 数据（6 导联，1800 采样）。
2. Ctrl+1 双击波形任意位置 → 加 P 标注（Redux + Fabric 都加）。
3. 文件 → 选择任意 JSON / WFDB / DICOM 导入新记录。
4. 观察：新波形已加载，但旧 P 标注圈仍浮在新波形上（Fabric 旧对象未清）。
5. 导出 JSON / CSV：`annotations` 数组包含旧 P 标注 + 新自动 R 峰（如有）。

**修复**：
1. `ECGCanvas.handleAddAnnotation` 改为只 dispatch（`ECGCanvas.tsx:294-318` 修复后）—— 不再 `fabricCanvasRef.current?.add(circle, label)`。
2. `ECGCanvas.handleDeleteSelectedAnnotation` 改为只 dispatch（`ECGCanvas.tsx:320-335` 修复后）—— 不再 `canvasInstance.remove(obj)`。
3. 新增 `useEffect([annotations])` + `renderAnnotationObjects` 函数（`ECGCanvas.tsx:157-167, 337-387` 修复后）—— **Redux annotations 是唯一 source of truth**，Fabric 对象每次从 Redux 派生。
4. `AnnotationStudio.applyImportedLeads` 加 `dispatch(setAnnotations([]))`（`AnnotationStudio.tsx:209-217` 修复后）—— 导入新记录时清空 Redux。

**回归测试**：
- `src/store/ecgSlice.test.ts` —— `setAnnotations([])` 清空、`addAnnotation` 追加、`removeAnnotation` 按 id 删、`clearECG` 全清。
- `scripts/verify-canvas-coords.mjs` 第 4 项：`applyImportedLeads` 必须 dispatch `setAnnotations([])`。
- `scripts/verify-canvas-coords.mjs` 第 7-8 项：ECGCanvas 不再命令式 add annotation 对象 + `useEffect([annotations])` 桥接存在。

### C-02（P1）— 自动 R 峰 `viewWidth = 1200` 硬编码

**修复前证据**：`AnnotationStudio.tsx:656` `const viewWidth = 1200;` —— 字面常量。

**后果**：
- 当前 OK，但任何 ECGCanvas width 调整（如 Card 宽度变化）会让自动 R 峰标注位置错位。
- "1200px" 没有出现在任何 docs 或 shared constant 里——后来者改 width 时不会想到改这一行。

**复现**（修复前）：
1. 修改 `ECGCanvas.tsx:21` 默认 width 为 `width = 800`。
2. 加 6 导联 demo 数据。
3. 点"自动标注 R 峰"。
4. 观察：自动 R 峰标注位置基于 1200 计算（`AnnotationStudio.tsx:660`），但画布 width=800 → 标注圈超出画布右边 ~50%。

**修复**：
1. 新建 `src/components/Canvas/constants.ts` 导出 `ECG_CANVAS_VIEW_WIDTH = 1200`。
2. `ECGCanvas.tsx` 顶部 import + 默认 width 引用（C-05 顺手做）。
3. `ECGCanvas.tsx` 末尾 `export { ECG_CANVAS_VIEW_WIDTH }` —— 保持现有 `import { ECG_CANVAS_VIEW_WIDTH } from '.../ECGCanvas'` 不破坏。
4. `AnnotationStudio.tsx:31` import 同一常量，替换 `viewWidth = 1200`。

**回归测试**：
- `src/utils/signalProcessor.findRPeaks.test.ts` 末两项：`Canvas mapping ... ECG_CANVAS_VIEW_WIDTH` 验算 + `ECG_CANVAS_VIEW_WIDTH matches 1200`（防漂移 pin）。
- `scripts/verify-canvas-coords.mjs` 第 1-3 项：硬编码检测 + re-export 检测 + import 检测。

### C-03（P2）— `AnnotationToolbar` 缺 ST/U 按钮

**修复前证据**：`AnnotationToolbar.tsx:25-46` 只暴露 P / QRS(R) / T 三个按钮。`Annotation['type']`（`types/index.ts:3`）定义 7 种。`ECGCanvas.tsx:295-296` 全部支持。

**复现**：
1. AnnotationStudio 看 AnnotationToolbar 卡片。
2. 只有 P / QRS / T / 平移 / 删除 5 个按钮，无 ST / U 入口。

**修复**：`AnnotationToolbar.tsx` 加 ST 段、U 波两个按钮。

**回归测试**：`scripts/verify-canvas-coords.mjs` 第 6 项。

### C-04（P2）— `annotation.x` 字段仅 hook 路径设，组件路径缺失

**修复前证据**：
- `useECGCanvas.ts:232-234`：`position: position.x, x: position.x, y: position.y`（三字段）。
- `ECGCanvas.tsx:286-293`（修复前）：`position: pointer.x`（单一字段）。
- AnnotationStudio 用的是 ECGCanvas 组件路径，`annotation.x` 永远 undefined。
- 自动 R 峰 `AnnotationStudio.tsx:657-664`（修复前）同样只写 position。

**后果**：
- `annotation.position` 是单一 source of truth，但 `x?: number` 类型层声明误导读代码的人。
- 下游 hook `useECGCanvas.ts:159` 读 `annotation.x ?? annotation.position`，**偶然能用**。

**修复**：
1. `ECGCanvas.handleAddAnnotation`（修复后）同时设 `position: pointer.x, x: pointer.x, y: pointer.y`。
2. `handleAutoDetectRPeaks`（修复后）同时设 `position, x: position`（y 不设，因为 auto R 峰是相对窗口的索引）。
3. `renderAnnotationObjects` 用 `annotation.x ?? annotation.position` 读，向后兼容旧数据。

**回归测试**：`src/utils/exportUtils.test.ts` "exportToJSON includes annotations with full field shape" + "writes annotation.position as-is"。

### C-05（P1）— ECGCanvas 命令式 add/remove annotation 对象，与 Redux 双轨

**修复前证据**：见 C-01 描述中的双轨机制。

**修复**：同 C-01（handleAddAnnotation / handleDeleteSelectedAnnotation 改为只 dispatch，新增 `useEffect([annotations])` 派生）。

**回归测试**：
- `src/store/ecgSlice.test.ts` 覆盖 `setAnnotations([])`、`addAnnotation`、`removeAnnotation`、`clearECG`。
- `scripts/verify-canvas-coords.mjs` 第 7-8 项：命令式 add 检测 + useEffect 桥接检测。

### C-06（P2，未修）— 导出 CSV 无单位说明

**证据**：`exportUtils.ts:52` 表头 `Type,Position,Confidence,Manual` 没说 position 是 px 还是 sample index。

**为何不修**：影响导出语义清晰度，但不改任何函数行为；属于 doc-level 改进。本次按"最小可验证修复"原则聚焦于功能正确性。**TODO**：在下次 CSV/JSON 格式 bump 时一起加 `PositionUnit` 列或 JSON 顶层 `coordinateSpace` 字段。

### C-07（P3，未修）— `findRPeaks` 在 `threshold=0` 时永不退出 inPeak

**证据**：`signalProcessor.ts:122-123` 退出条件 `normalized[i] < threshold * 0.5`，threshold=0 时永远不成立 → inPeak 永不退出 → 不 push peak。

**为何不修**：行为已有，已加测试 pin 住，避免未来 refactor 改变这个边界行为时不知情。

**回归测试**：`src/utils/signalProcessor.findRPeaks.test.ts` "findRPeaks threshold of 0 returns no peaks (inPeak never exits)"。

---

## 3. zoom / pan 后坐标稳定性（用户原始问题第 3 项）

**结论**：**当前稳定**（width=1200 不变的前提下）。

**代码证据**：
- `ECGCanvas.tsx:77-85` 滚轮 zoom：`canvasInstance.zoomToPoint({ x: opt.e.offsetX, y: opt.e.offsetY }, zoom)` —— zoom 围绕鼠标点，**所有 Fabric 对象（包括 annotation_）自动应用 viewport transform**。
- `ECGCanvas.tsx:100-113` pan：直接修改 `viewportTransform[4/5]`，所有 Fabric 对象跟随平移。
- Annotation 存的是画布逻辑坐标（`pointer.x` 是 `getPointer` 反向变换后的值），与 waveform polyline 共用同一坐标系。

**未来风险**：
- 如果未来 ECGCanvas width 改变（如 Card 变窄），annotation.position 的语义就漂移——`renderAnnotationObjects` 的 `left = x - 8` 会让 circle 偏离波形。
- 修复 C-02 后，width 变化只会影响"px vs canvas width 比例"，不会让自动 R 峰乱飞。
- **未修**：未把 annotation.position 改为 sample index（架构升级，不在本次范围）。

---

## 4. 删除选中标注（用户原始问题第 4 项）

**修复前证据**：`ECGCanvas.tsx:322-341`（修复前）
```ts
canvasInstance.getObjects().forEach((obj) => {
  if (obj.name === `annotation_${annotationId}` || obj.name === `annotation_label_${annotationId}`) {
    canvasInstance.remove(obj);
  }
});
canvasInstance.discardActiveObject();
canvasInstance.renderAll();
dispatch(removeAnnotation(annotationId));
selectedAnnotationIdRef.current = null;
```

**修复后**：`ECGCanvas.tsx:320-335`
```ts
const canvasInstance = fabricCanvasRef.current;
canvasInstance?.discardActiveObject();
canvasInstance?.renderAll();
dispatch(removeAnnotation(annotationId));
selectedAnnotationIdRef.current = null;
```
Redux dispatch 触发 `useEffect([annotations])` → `renderAnnotationObjects` → 重新派生（自动剔除已删的）。

**`selectedAnnotationIdRef` 来源**：
- `selection:created` / `selection:updated`：`event.selected?.[0]?.name?.startsWith('annotation_')` → `targetName.replace('annotation_', '')`。
- `selection:cleared`：置 null。
- `discardActiveObject` 触发 Fabric 内部 `selection:cleared` 事件（验证：Fabric 5.x 行为）。

**边界**：annotation_label_（前缀也是 `annotation_`）被识别为选中时会得到 `label_xxx` 这个无效 ID。但 annotation_label_ 是 `selectable: false`，Fabric 不会选中它，所以这条路径不会触发。

---

## 5. 修复改动清单

### 修改

| 文件 | 改动 |
|------|------|
| `src/components/Canvas/ECGCanvas.tsx` | 1) 引入 `ECG_CANVAS_VIEW_WIDTH`；2) `handleAddAnnotation` 改为只 dispatch；3) `handleDeleteSelectedAnnotation` 改为只 dispatch；4) 新增 `useEffect([annotations])` + `renderAnnotationObjects` 派生；5) `renderWaveforms` 维持原样（清 waveform/label/grid_） |
| `src/pages/AnnotationStudio.tsx` | 1) `import { ECG_CANVAS_VIEW_WIDTH }`；2) `applyImportedLeads` 加 `dispatch(setAnnotations([]))`；3) `handleAutoDetectRPeaks` 用常量 + 同时设 `x: position` |
| `src/pages/components/AnnotationToolbar.tsx` | 加 ST 段、U 波两个按钮 |

### 新增

| 文件 | 用途 |
|------|------|
| `src/components/Canvas/constants.ts` | `ECG_CANVAS_VIEW_WIDTH = 1200` 共享常量，避免测试加载 Fabric |
| `src/store/ecgSlice.test.ts` | 9 个 reducer 测试，覆盖 annotation 生命周期 |
| `src/utils/exportUtils.test.ts` | 9 个导出测试，覆盖 JSON/CSV 字段一致性 |
| `src/utils/signalProcessor.findRPeaks.test.ts` | 7 个 R 峰测试，含 viewWidth 集成 |
| `scripts/verify-canvas-coords.mjs` | 9 项手工一致性检查（grep 风格） |

### 改动量

```
src/components/Canvas/ECGCanvas.tsx        | 120 ++++++++++++++++++++---------
src/pages/AnnotationStudio.tsx             |  32 +++++---
src/pages/components/AnnotationToolbar.tsx |  14 ++++
3 files changed, 120 insertions(+), 46 deletions(-)
```

---

## 6. 验证命令清单（一次性跑完）

```bash
Set-Location "D:\VS vibe coding files\ecg-annotation-platform"

# A. 完整质量门（lint + typecheck + 85 unit tests + build）
npm run check
# 期望：85 tests pass, build 成功（main 1.5 MiB）

# B. Canvas 标注链路手工一致性脚本
node scripts/verify-canvas-coords.mjs
# 期望：9/9 checks pass，结尾 "All Canvas-coordinate invariants hold."

# C. 单独跑回归测试（仅新加的部分）
npm run test:unit -- --test-name-pattern="ecgSlice|exportUtils|findRPeaks"
# 期望：25/25 pass（9 reducer + 9 export + 7 R peak）

# D. git diff 卫生
git diff --check
# 期望：0 退出，无 whitespace 错误

# E. 看修改统计
git diff --stat
```

---

## 7. 验证结果（实际执行）

| 命令 | 结果 |
|------|------|
| `npm run typecheck` | ✅ 0 错误 |
| `npm run lint` | ✅ 0 错误 |
| `npm run test:unit` | ✅ **85/85 pass**（新增 25 + 既有 60） |
| `npm run build` | ✅ Webpack compiled successfully（main 1.5 MiB，无 size 警告） |
| `npm run check` | ✅ 全过 |
| `node scripts/verify-canvas-coords.mjs` | ✅ 9/9 checks pass |
| `git diff --check` | ✅ 0 退出 |

---

## 8. 用户原始 7 个问题的逐项回答

| # | 用户问题 | 回答 |
|---|----------|------|
| 1 | Fabric.js 渲染 | Fabric 5.3.0 Canvas，懒加载，按 grid + waveform + annotation 三层 object 管理。修复后 Redux annotations 是唯一 source of truth |
| 2 | P/Q/R/S/T/ST/U 标注添加 | 双击波形触发 `handleAddAnnotation(pointer)`，随机 fallback 仅在 `selectedTypeRef.current` 为 undefined 时生效。**修复 C-03** 后 UI 暴露全 7 种 |
| 3 | zoom/pan 后坐标稳定 | **当前稳定**（width=1200 不变）。annotation.position 是画布逻辑坐标（Fabric `getPointer` 反向变换），Fabric viewport transform 自动应用到所有 object |
| 4 | 删除选中标注 | selection:created/updated → `selectedAnnotationIdRef.current = id` → 点删除 → `discardActiveObject + dispatch(removeAnnotation)` → useEffect 重派生 |
| 5 | 自动 R 峰 | `findRPeaks`（阈值法 + abs-max 归一化）+ `handleAutoDetectRPeaks` 把 sample index 映射到 `viewWidth`。**修复 C-02** 后 viewWidth 用共享常量 |
| 6 | 导入新记录后的标注生命周期 | **修复 C-01** 后 `applyImportedLeads` dispatch `setAnnotations([])`，Fabric 旧 annotation objects 通过 `useEffect([annotations])` 自动清空 |
| 7 | 导出 JSON/CSV 一致性 | JSON 透传 annotations 完整对象；CSV 表头 `Type,Position,Confidence,Manual` 与每行字段顺序一致（`exportUtils.test.ts` pin 住）。**C-06 未修**（缺单位说明） |

---

## 9. 与 AUDIT-2026-07-04-model-canvas.md 的关系

本次审查聚焦 Canvas 标注链路，**不重叠**于 Model/Canvas/Parser 风险图。两者互补：

- `AUDIT-2026-07-04-model-canvas.md`（既有）：Model / Cache / Mock / Demo data / Lightweight parser 五轴。
- 本报告（新增）：Canvas 标注链路五项 BUG（C-01 到 C-05，已修；C-06 / C-07，未修但已 pin）。

---

完。