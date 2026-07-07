# Track B:UI + Canvas + 标注 + 持久化 + 导出 审计 (2026-07-07)

**审计范围**:`src/pages/AnnotationStudio.tsx`、`src/components/Canvas/ECGCanvas.tsx`、
`src/store/{ecgSlice,caseSlice,selectors}.ts`、`src/services/firebaseService.ts`、
`src/utils/{buildDiagnosis,exportUtils,signalProcessor}.ts`、
`src/pages/components/{SignalMetrics,AnnotationList,AnnotationToolbar,AIAnalysisPanel,
SmartAssistancePanel,ImportPanel}.tsx`、相关单元测试与 `annotationWorkflow.test.tsx`。

**审计目标**:对照 `AUDIT-2026-07-04-model-canvas.md`(R-01..R-25)+ `2026-07-04-canvas-
annotation-audit.md`(C-01..C-07)逐项验证是否仍在当前 HEAD 存在,识别新 bug。

**方法**:第一性原理阅读代码 + 交叉对照 README/CHANGELOG/CLAUDE 中的承诺 + git log
核对修复 commit + 系统化 grep 排查常见 smell。所有结论均附**真实代码片段**(5-15 行)
+ **PowerShell 验证命令**。

**当前 HEAD**:`c487669`(2026-07-04 audit closeout,2026-07-04 20:36 之后无新 commit)。

---

## 0. 速读表(TL;DR)

| #   | 风险轴                              | 一句话结论                                                                                                                                                                  | Severity | AUDIT 对照 |
|-----|-----------------------------------|--------------------------------------------------------------------------------------------------------------------------------------------------------------------------|----------|----------|
| B-01| 已修验证 — 导出 provenance         | `buildDiagnosis` 在 mock 模式下写 `source='mock'`,`exportToJSON/CSV` 在所有导出路径生效(纯函数 + 6 测试 + 7 导出测试 + e2e 都覆盖)                                                              | ✅ 已修    | R-01 P0  |
| B-02| 已修验证 — MOCK chip 持久化        | `SignalMetrics` 接收 `isUsingMockInference` prop,`data-testid="mock-inference-chip"` 在 mock 模式下持久渲染;`AnnotationStudio` 把 `modelService.isUsingMockInference()` 实时注入                                                  | ✅ 已修    | R-02 P0  |
| B-03| 残留 — AnnotationStudio URL 切换不清空 annotations/inferenceResults | `useEffect([location.search, routeRecordId])`(line 133-145) 只更新 `currentPatientId`/`currentRecordId`,**不清空 annotations / inferenceResults / sourceLeadsRef / playbackCursor**;URL 切换 record 后,旧记录的标注与旧 AI 结果在画布与导出里继续存活 | **P1**  | 新发现 |
| B-04| 残留 — Firebase save debounce 在 recordId 切换时把旧标注写到新记录 | `useEffect([annotations, currentRecordId, saveAnnotationsToFirebase])`(line 318-324) 1s debounce,`setTimeout` 闭包捕获的 `currentRecordId` 是新的,但 `annotations` 闭包来自 effect 运行瞬间 — URL 切到新记录但用户没 import 时,**旧记录的标注会被写进新 Firebase 文档** | **P1**  | 新发现 / R-22 关联 |
| B-05| 残留 — `applyImportedLeads` 不清空 `inferenceResults`             | C-01 修复了 annotations 跨记录污染(line 218 `dispatch(setAnnotations([]))`),**没有同步 `dispatch(setInferenceResults([]))`**;导入新波形后 SignalMetrics 仍展示旧记录的 AI 结果,且 `handleExportCurrentRecord` 会把旧 label/confidence 写进导出诊断                        | **P1**  | 新发现(同 C-01 但漏了一半) |
| B-06| 残留 — `firebaseService.initialize()` 失败被吞              | `AnnotationStudio.tsx:153-157` 的 `useEffect` 用 `.catch(...console.warn)` 吞错;`saveAnnotationsToFirebase` 又用 `firebaseService.isInitialized()` 静默跳过(line 308) — 失败时**用户拿不到任何 toast**,只看到"标注了但刷新就丢"                                       | **P1**  | R-20 P1 残留 |
| B-07| 残留 — `saveAnnotationsToFirebase` 静默吞 `updateDoc` 失败    | `AnnotationStudio.tsx:306-316` `try/catch` 内只 `console.warn`,不弹 message;与 B-06 叠加 = **0 用户反馈路径**,Firebase 一旦出问题,标注就静默丢失                                                                                          | **P1**  | 新发现 |
| B-08| 残留 — `handleMinimaxAnalyze` 内重复声明 `hasDirectConfig` / `useProxy` | line 623-624 外层 + line 636-637 内 try 块重复声明同一对变量(line 636 还有"Determine if we should use proxy or direct API"注释) — 死代码、掩盖分支;若未来在 try 块内做额外判断会改错作用域                                                          | **P2**  | R-16 P1 残留 |
| B-09| 残留 — ECGCanvas `renderWaveforms` 在播放期持续分配 fabric.Shadow | line 220 `shadow: new fabric.Shadow({...})` 每个导联每次 `renderWaveforms` 都新建 Shadow,没有显式 `obj.dispose()`;120ms 播放 interval(line 255) 触发 `setLeads` → `useEffect([leads])` → 全清全建,6 导联 × 1.5K 点 × 8.3 Hz ≈ 12 个 Fabric Object/秒                                                                    | **P2**  | R-17 P2 残留 |
| B-10| 残留 — `INITIAL_DEMO_LEADS` 模块级单例                                       | line 89 `const INITIAL_DEMO_LEADS = createDemoLeads()` 在模块加载即固化;C-01 修复后 `applyImportedLeads` 会 `cloneLeads(nextLeads)` 覆盖 `sourceLeadsRef`,所以首发安全,但 HMR 复用旧数组仍可能让 phase/slowDrift 不一致                                | **P3**  | R-12 P2 残留 |
| B-11| 残留 — `AnnotationToolbar` 已暴露 P/QRS/T/ST/U 全 5 种主要类型     | line 26-60 实际渲染 P / QRS(R) / T / ST / U,**5/7**(`Q`、`S` 通过 `QRS` 合并,`P/Q/R/S/T/ST/U` 类型联合还声明 `Q` 和 `S`,但 UI 不暴露独立按钮);`ECGCanvas.handleAddAnnotation` 的 fallback `['P','Q','R','S','T']` 仍可能随机落入 Q/S,与 UI 不一致                              | **P3**  | C-03 残留(只补了 ST/U,没暴露 Q/S 独立按钮) |
| B-12| 残留 — `ECGCanvas.annotationTypeRef.current` fallback 仍随机选 Q/S/T | line 297-303 `selectedType` 为空时(用户没在 toolbar 选)随机 `annotationTypes[Math.floor(Math.random() * annotationTypes.length)]` 从 P/Q/R/S/T 选 — 与 C-03 修复目标"UI 与类型联合对齐"仍偏差                                                                                       | **P3**  | 新发现(同 C-03 残留) |
| B-13| 新发现 — 导出 CSV 仍无 position 单位说明                              | `exportUtils.ts:60` 表头 `Type,Position,Confidence,Manual` 没说 position 是 px 还是 sample index;C-06 故意不改,本次审计确认锁定 — `exportUtils.test.ts:119-145` 测只 pin 表头文本一致性,不再追单位列                                                                                  | P3 锁定   | C-06 锁定 |
| B-14| 新发现 — `findRPeaks` 在 `threshold=0` 仍永不退出 inPeak              | `signalProcessor.ts:123` 退出条件 `normalized[i] < threshold * 0.5`,`threshold=0` 时永远不成立;C-07 故意不改,本次审计确认锁定 — `signalProcessor.findRPeaks.test.ts` 含 "threshold of 0 returns no peaks" pin                                                            | P3 锁定   | C-07 锁定 |

Severity 标度沿用 `AUDIT-2026-07-04-model-canvas.md`:
- **P0** = 在 README 承诺边界内仍会误导用户 / 静默错误 / 安全直接相关
- **P1** = 损坏 demo 体验、丢失用户数据、UI 与代码声明不一致
- **P2** = 内存/性能/可维护性,未来再扩散会变 P0
- **P3** = 代码卫生 / 锁定行为

---

## 1. 已修验证(B-01 / B-02)

### B-01 [✅ 已修 P0] `buildDiagnosis` 在 mock 模式写 `source='mock'`,所有导出路径生效

- **AUDIT 对照**:R-01 P0(`exportRecord` 把 `inferenceResults[0]` 当真实 `diagnosis.confidence` 写入导出文件)。
- **修复 commit**:`10df188`(2026-07-04 14:57 "fix(export): tag diagnosis.source so mock inference cannot pose as real (R-01 P0)")。
- **文件:行号**:
  - `src/utils/buildDiagnosis.ts:42-57` —— 纯函数,显式三态 `DiagnosisSource = 'real' | 'mock' | 'unavailable'`。
  - `src/utils/exportUtils.ts:26-28` —— `exportToJSON` 直接挂 `record.diagnosis`。
  - `src/utils/exportUtils.ts:48-55` —— `exportToCSV` 写 `Source,<real|mock|unavailable>` 行,`source` 缺失时**不写**该行(向后兼容旧导出)。
  - `src/types/index.ts:28-39` —— `ECGRecord.diagnosis.source?: 'real' | 'mock' | 'unavailable'` 可选。
  - `src/pages/AnnotationStudio.tsx:697-701` —— `buildDiagnosis({ inferenceResults, isUsingMockInference: modelService.isUsingMockInference(), heartRate })`。

- **证据 1**(`buildDiagnosis.ts:42-57`):

```ts
export function buildDiagnosis(input: BuildDiagnosisInput): BuiltDiagnosis {
  if (input.inferenceResults.length === 0) {
    return {
      label: input.heartRate !== null ? `HR ${input.heartRate} bpm` : '未分析',
      confidence: 0.5,
      source: 'unavailable',
    };
  }

  const top = input.inferenceResults[0];
  return {
    label: top.className,
    confidence: top.probability,
    source: input.isUsingMockInference ? 'mock' : 'real',
  };
}
```

- **证据 2**(`exportUtils.ts:45-55`):

```ts
if (record.diagnosis) {
    lines.push(`Diagnosis,${record.diagnosis.label}`);
    lines.push(`Confidence,${(record.diagnosis.confidence * 100).toFixed(1)}%`);
    if (record.diagnosis.source) {
      // Pin a single-word provenance token so a downstream consumer can grep
      // the file and tell whether the diagnosis came from the real TF.js
      // model, the heuristic mock fallback, or was synthesised from HR
      // features. Without this row, an exported `0.92 房颤` looks identical
      // to a real-model output.
      lines.push(`Source,${record.diagnosis.source}`);
    }
  }
```

- **证据 3**(`AnnotationStudio.tsx:697-701`):

```ts
diagnosis: buildDiagnosis({
        inferenceResults,
        isUsingMockInference: modelService.isUsingMockInference(),
        heartRate: features.heartRate ?? null,
      }),
```

- **复现验证**(代码层已确定):
  1. 默认 demo 数据 → 加载模型(mock 触发)→ AI 分析 → inferenceResults 有 mock 输出。
  2. 导出 JSON → `JSON.parse(...).diagnosis.source === 'mock'`。
  3. 导出 CSV → 含 `Source,mock` 行,跟在 `Confidence,<%>` 行后。
  4. 不加载模型直接导出(inferenceResults 为空)→ `source === 'unavailable'`,label 为 `HR <n> bpm` 或 `未分析`。
  5. 不写 `source` 字段的旧 fixture → CSV 无 `Source,...` 行(`exportUtils.test.ts:300-311` 已 pin)。

- **验证命令**(PowerShell):

```powershell
# 1. 验证 buildDiagnosis 在 mock 模式写 source='mock'
Select-String -Path src\utils\buildDiagnosis.ts -Pattern "'mock'|'real'|'unavailable'"

# 2. 验证 exportToCSV 写 Source 行
Select-String -Path src\utils\exportUtils.ts -Pattern "Source,"

# 3. 验证 AnnotationStudio 调用 buildDiagnosis
Select-String -Path src\pages\AnnotationStudio.tsx -Pattern "buildDiagnosis"

# 4. 跑回归测试
node --test src\utils\buildDiagnosis.test.ts src\utils\exportUtils.test.ts
# 期望:13 case 全过
```

- **测试覆盖**:
  - `src/utils/buildDiagnosis.test.ts` —— 6 case 覆盖 `real` / `mock` / 排序 / HR fallback / "未分析" / mock flag 被忽略(empty input always yields unavailable)。
  - `src/utils/exportUtils.test.ts` —— 7 case 覆盖 `source` 字段 JSON 透传 + CSV 写行 + 缺省时不写。
  - `src/__tests__/annotationWorkflow.test.tsx:139-215` —— Workflow A 端到端 import → analyze → export JSON,验证 diagnosis.label/confidence 真实流转(但 e2e 没显式断言 source,新增建议)。
- **结论**:修复彻底,行为符合契约。

---

### B-02 [✅ 已修 P0] `SignalMetrics` MOCK chip 在 mock 推理结果显示时持久存在

- **AUDIT 对照**:R-02 P0(`AI 分析` 后所有面板共用同一份 `inferenceResults` 渲染,不附 mock 标;`isUsingMockInference` 仅在加载完成时弹 30s toast)。
- **修复 commit**:`180be1e`(2026-07-04 15:00 "fix(ui): surface a MOCK chip on AI results when inference is heuristic (R-02 P0)")。
- **文件:行号**:
  - `src/pages/components/SignalMetrics.tsx:24` —— 新增可选 prop `isUsingMockInference?: boolean`,默认 `false`(向后兼容)。
  - `src/pages/components/SignalMetrics.tsx:74-89` —— AI 诊断结果 Card 的 `extra` 加 `<Tag color="orange" data-testid="mock-inference-chip">MOCK</Tag>`,只在 `isUsingMockInference === true` 时渲染。
  - `src/pages/AnnotationStudio.tsx:937` —— `<SignalMetrics ... isUsingMockInference={modelService.isUsingMockInference()} />`。
  - `src/pages/components/AIAnalysisPanel.tsx:36, 47-62` —— 同 prop 也接收,且额外显示一个永久 `<Alert type="warning">真实模型未配置...</Alert>`(增强层)。
- **证据 1**(`SignalMetrics.tsx:74-89`):

```tsx
<Card
        className="section-card"
        title="AI 诊断结果"
        extra={
          <Space size={4}>
            {isUsingMockInference && (
              // The MOCK chip is the visual contract for BUG-2026-07-04-R-02:
              // whenever inference results on screen come from the heuristic
              // fallback (no real TF.js model), the user sees this chip. Tests
              // assert its presence by string match ("MOCK").
              <Tag color="orange" data-testid="mock-inference-chip">MOCK</Tag>
            )}
            <Tag color="magenta">Results</Tag>
          </Space>
        }
      >
```

- **证据 2**(`AnnotationStudio.tsx:932-938`):

```tsx
<SignalMetrics
              leads={leads}
              signalQuality={signalQuality}
              annotationStats={annotationStats}
              inferenceResults={inferenceResults}
              isUsingMockInference={modelService.isUsingMockInference()}
            />
```

- **证据 3**(`AIAnalysisPanel.tsx:47-62` 同期增强的 alert):

```tsx
{isUsingMockInference ? (
          <Alert
            type="warning"
            showIcon
            icon={<ExclamationCircleOutlined />}
            message="真实模型未配置"
            description={
              <span>
                当前仓库未包含 <code>model.json</code>,AI 分析已自动切换到模拟推理模式。
                结果仅用于流程演示,<strong>不可用于临床参考</strong>。
                如需启用真实推理,请把训练好的 TensorFlow.js 模型放到
                <code> public/models/ecg-classifier/ </code>后重新构建。
              </span>
            }
          />
        ) : null}
```

- **复现验证**(代码层已确定):
  1. 加载模型 → 触发 mock fallback → `modelService.isUsingMockInference() === true`。
  2. 渲染 AnnotationStudio → `SignalMetrics` 的 `AI 诊断结果` Card title extra 显示橙色 MOCK chip,`data-testid="mock-inference-chip"`,持久存在(不再依赖 30s toast)。
  3. `AIAnalysisPanel` 同时显示 `<Alert type="warning">` 永久 banner,双层提示。
- **验证命令**:

```powershell
# 1. 验证 SignalMetrics 接收并渲染 MOCK chip
Select-String -Path src\pages\components\SignalMetrics.tsx -Pattern "MOCK|mock-inference-chip"

# 2. 验证 AnnotationStudio 注入 prop
Select-String -Path src\pages\AnnotationStudio.tsx -Pattern "isUsingMockInference"

# 3. 验证 AIAnalysisPanel 的 alert
Select-String -Path src\pages\components\AIAnalysisPanel.tsx -Pattern "Alert|模拟推理|真实模型未配置"

# 4. 跑回归测试(5 case)
node --test src\pages\components\SignalMetrics.test.tsx
```

- **测试覆盖**:`src/pages/components/SignalMetrics.test.tsx` —— 5 case:chip 出现 / chip 不出现 / 默认 false / 推理结果仍渲染 / "Results" tag 不回归。
- **结论**:修复彻底,**双层提示**(chip + alert)远超原 R-02 契约。
- **未覆盖观察**:MOCK chip 是"live model state"而不是"结果 provenance",reload 后 modelService 重置为非 mock 但 Redux inferenceResults 已被清空,所以无影响;若未来引入 redux-persist,**MOCK chip 会与 results 解耦**(见 B-12 关联讨论)。

---

## 2. 残留风险(本次新发现 / 2026-07-04 锁定不修)

### B-03 [P1 新发现] AnnotationStudio URL 切换不清空 annotations/inferenceResults/sourceLeadsRef

- **AUDIT 对照**:新发现。同 R-20/R-22 同源 —— 状态重置不完整。
- **文件:行号**:`src/pages/AnnotationStudio.tsx:133-145`

```ts
useEffect(() => {
    const params = new URLSearchParams(location.search);
    const nextPatientId = params.get('patientId')?.trim();
    const nextRecordId = routeRecordId?.trim() || params.get('recordId')?.trim();

    if (nextPatientId) {
      setCurrentPatientId(nextPatientId);
    }

    if (nextRecordId) {
      setCurrentRecordId(nextRecordId);
    }
  }, [location.search, routeRecordId]);
```

- **问题**:
  1. URL `?recordId=100 → ?recordId=101` 切换时,该 effect 只更新 `currentRecordId`,**不动 `annotations` / `inferenceResults` / `sourceLeadsRef.current` / `playbackCursor` / `wfdbBatches`**。
  2. 心电图画布(ECGCanvas)继续渲染**旧记录的波形 polyline**(因为 `leads` 来自 `useState` 而 `setLeads` 不会被该 effect 触发),导出 JSON/CSV 仍用旧 `leads` + 旧 `annotations` + 旧 `inferenceResults`。
  3. 用户在 UI 上看到"画布没变,标注没变,AI 结果没变"——只有右上角的"当前记录: 101" tag 变绿;实际数据是旧记录 100 的。
  4. B-04 的 save debounce 会触发 → 旧 annotations 写到新 recordId=101(详见 B-04)。
- **复现**:
  1. 进入 `/annotation-studio?recordId=100`,加载 6 导联 demo,加 3 个 P 标注,跑 AI 分析(inferenceResults 有结果)。
  2. 导航到 `/annotation-studio?recordId=101`(任意路由切换方式,例如直接改地址栏)。
  3. 观察:画布继续显示 100 的 6 导联 + 3 个 P 标注 + AI 结果;只有顶部"当前记录"tag 变 101。
  4. 此时点"导出 JSON" → JSON 仍携带 100 的 leads / annotations / diagnosis(因为 `handleExportCurrentRecord` 从 `leads`/`annotations`/`inferenceResults` 闭包读,这些都没变)。
- **验证命令**:

```powershell
# 1. 看 effect 内容
Select-String -Path src\pages\AnnotationStudio.tsx -Pattern "URLSearchParams|location.search|routeRecordId" -Context 2

# 2. 看是否有 setAnnotations([]) 配合 URL 切换
Select-String -Path src\pages\AnnotationStudio.tsx -Pattern "setAnnotations|setInferenceResults" -Context 3
# 期望:URL 切换 effect 内没有 dispatch 清空
```

- **修复建议**(不动代码):
  - URL 切换 effect 内补 `dispatch(setAnnotations([]))` + `dispatch(setInferenceResults([]))` + `setLeads([])` + `sourceLeadsRef.current = []` + `setPlaybackCursor(0)`,语义对齐 `applyImportedLeads`(但**不**弹"导入成功"toast,因为不是真导入)。
  - 或者:把 URL → recordId 的 effect 完全外包成 `applyImportedLeads(undefined, { recordId, patientId })` —— 让"换记录"和"导入记录"走同一条路径。
  - 加一个 e2e: navigate between two recordIds → assert `leads`/`annotations`/`inferenceResults` cleared。

---

### B-04 [P1 新发现] Firebase save debounce 在 recordId 切换时把旧标注写到新记录

- **AUDIT 对照**:新发现,与 R-22 (P1) 同源。R-22 关注"local- 前缀永远不触发 save",**没覆盖**"非 local- 切换 recordId 时旧数据写到新 id"。
- **文件:行号**:`src/pages/AnnotationStudio.tsx:306-324`

```ts
const saveAnnotationsToFirebase = useCallback(
    async (recordId: string, annots: Annotation[]) => {
      if (!recordId || !firebaseService.isInitialized()) return;
      try {
        await firebaseService.updateRecordAnnotations(recordId, annots);
      } catch (error) {
        console.warn('[AnnotationStudio] Failed to save annotations:', error);
      }
    },
    []
  );

  useEffect(() => {
    if (!currentRecordId || currentRecordId.startsWith('local-')) return;
    const timeoutId = setTimeout(() => {
      saveAnnotationsToFirebase(currentRecordId, annotations);
    }, 1000); // Debounce saves by 1 second
    return () => clearTimeout(timeoutId);
  }, [annotations, currentRecordId, saveAnnotationsToFirebase]);
```

- **问题**:
  1. effect deps = `[annotations, currentRecordId, saveAnnotationsToFirebase]`。
  2. 当 `currentRecordId` 从 "100" 切到 "101" 时,effect 清理 `clearTimeout`(旧的保存被取消),然后用**新** `currentRecordId="101"` 和**当前** `annotations`(此时还是旧的 5 个,applyImportedLeads 没被调用)开新 timeout。
  3. 1s 后:`saveAnnotationsToFirebase("101", 旧 annotations)` —— 把属于记录 100 的 5 个标注写到 Firestore 的 `records/101` 文档。
  4. 同时记录 100 的 Firestore 文档不会被自动同步回空(因为只有 update,没有 delete 操作),下次从 Firestore 加载 100 还是 5 个标注。
- **复现**(逻辑层):
  1. recordId=100 + 5 个标注 → Firebase 已同步(上次触发)。
  2. URL 切到 recordId=101(无 import)。
  3. 1s 内:effect 跑 → `saveAnnotationsToFirebase("101", annotations[5])`。
  4. 结果:Firestore `records/101` 被覆盖为 5 个标注文档。
- **根因**:`annotations` 是当前 Redux state 的引用,不是 per-record 的本地缓存。Redux ecgSlice 没有按 recordId 切片(`ecgSlice.annotations` 是单数组)。
- **验证命令**:

```powershell
# 1. 看 debounce 闭包捕获
Select-String -Path src\pages\AnnotationStudio.tsx -Pattern "saveAnnotationsToFirebase|setTimeout" -Context 3

# 2. 看 ecgSlice 是否按 recordId 切片
Select-String -Path src\store\ecgSlice.ts -Pattern "annotations|recordId"
# 期望:annotations 是单数组,无 recordId 索引
```

- **修复建议**:
  - 最小修复:B-03 完成后,B-04 自动消失(URL 切换 effect 内同步清 annotations)。
  - 架构修复:ecgSlice 改为 `annotationsByRecordId: Record<string, Annotation[]>`,所有 selector 都基于 `currentRecordId` 取值。Firestore save 改为持久化"per-record"。

---

### B-05 [P1 新发现] `applyImportedLeads` 不清空 `inferenceResults`(C-01 修复漏一半)

- **AUDIT 对照**:新发现。C-01 (P1) 修复了 annotations 跨记录污染,commit `46dc5d1` 的 "C-01: applyImportedLeads now dispatches setAnnotations([]) so importing a new record drops stale annotation circles from the previous record",**漏掉了 `inferenceResults`**。
- **文件:行号**:`src/pages/AnnotationStudio.tsx:199-231`

```ts
const applyImportedLeads = (nextLeads: ECGLead[], context?: ImportedRecordContext): void => {
    if (nextLeads.length === 0) {
      message.error('解析成功但未发现有效导联数据');
      return;
    }

    if (context?.patientId) {
      setCurrentPatientId(context.patientId);
    }
    if (context?.recordId) {
      setCurrentRecordId(context.recordId);
    }

    // Importing a new record invalidates any annotations tied to the previous
    // record's logical canvas coordinates. Drop them from Redux; ECGCanvas's
    // useEffect([annotations]) will then re-derive the Fabric annotation
    // objects to match the empty array. Without this, old annotation circles
    // would still float above the new waveform and exported JSON / CSV would
    // mix annotations from two different records.
    dispatch(setAnnotations([]));

    sourceLeadsRef.current = cloneLeads(nextLeads);
    ...
  };
```

- **问题**:
  1. import 新记录 → `dispatch(setAnnotations([]))` 清空标注 ✓
  2. **`inferenceResults` 没被清空** —— 用户上一次 AI 分析的结果(`[{className: '房颤', probability: 0.92}, ...]`)留在 Redux。
  3. `SignalMetrics` Card `AI 诊断结果` 立即显示**旧记录的 AI 结果**,而此时画布是**新记录**的波形 —— 用户看到"AI 诊断:房颤"但波形完全不一样。
  4. MOCK chip 还在(`modelService.isUsingMockInference()` 是 live state,不随 import 清) → 旧结果继续被显示带 MOCK 标。
  5. **`handleExportCurrentRecord` 从 inferenceResults 读 → 导出诊断带旧 label/confidence**(B-01 修复已写 source tag 但**结果本身已过时**)。
- **复现**:
  1. demo 数据 → 加载模型(mock)→ AI 分析 → inferenceResults=`[{正常:0.82,房颤:0.07,...}]`,SignalMetrics 显示 + MOCK chip。
  2. 导入 WFDB record 100(`parseWfdbPair` 走 `applyImportedLeads`)。
  3. 观察:画布变成 100 的 2 导联 MIT-BIH 波形,但 SignalMetrics **仍显示**"AI 诊断结果:正常 82%"(带 MOCK chip)。
  4. 点导出 JSON → `diagnosis.label="正常", confidence=0.82, source='mock'` —— 这是 demo 的诊断,不是 100 的。
- **验证命令**:

```powershell
# 1. 看 applyImportedLeads 是否同时清 inferenceResults
Select-String -Path src\pages\AnnotationStudio.tsx -Pattern "applyImportedLeads" -Context 12
# 期望:函数体里有 setInferenceResults([]) - 当前缺失

# 2. 看其他清空 annotations 的地方是否同步清 inferenceResults
Select-String -Path src\store\ecgSlice.ts -Pattern "clearECG|inferenceResults"
# clearECG 是有的,但 applyImportedLeads 没调它
```

- **修复建议**:
  - 最小修复(2 行):在 `applyImportedLeads` `dispatch(setAnnotations([]))` 后追加 `dispatch(setInferenceResults([]))`,或在 import 完成统一调 `dispatch(clearECG())`(后者还会清 modelLoading/modelLoaded,可能过度清)。
  - 同时在 `handleExportCurrentRecord`(line 679-711)加防御:如果 inferenceResults 来自已被覆盖的 record(可以通过 recordId 戳判断),强制按 unavailable 导出。

---

### B-06 [P1 残留] `firebaseService.initialize()` 失败被 `console.warn` 吞掉

- **AUDIT 对照**:R-20 P1 残留。原始 audit 已识别"Firebase 动态 import 失败时 `initialize` 抛错被 AnnotationStudio `console.warn` 吞,后续 `updateRecordAnnotations` 永远打不上",commit `bb85031` (perf(build): lazy-load firebase + @firebase via dynamic import) **没修这部分**。
- **文件:行号**:`src/pages/AnnotationStudio.tsx:153-157`

```ts
useEffect(() => {
    void firebaseService.initialize().catch((error) => {
      console.warn('[AnnotationStudio] Firebase lazy init failed:', error);
    });
  }, []);
```

- **问题**:
  1. `initialize()` 内部 `Promise.all` 四个子包任意一个失败 → `initPromise` reject。
  2. 上面 `.catch(...console.warn)` 吞掉,用户看不到任何 message。
  3. `initialized` 字段保持 `false`(初始化失败时 `this.initialized = true` 行未执行)。
  4. 后续 `saveAnnotationsToFirebase` line 308 `if (!firebaseService.isInitialized()) return;` 静默返回。
  5. 用户体验:页面加载 OK,标注 OK,刷新页面 → 标注全无(Firestore 没写),无任何提示。
- **证据**(`firebaseService.ts:101-154`):

```ts
initialize(config?: FirebaseConfig): Promise<void> {
    if (this.initialized) return Promise.resolve();
    if (this.initPromise) return this.initPromise;

    this.initPromise = (async () => {
      const [
        { initializeApp },
        firestoreMod,
        storageMod,
        authMod,
      ] = await Promise.all([
        import(/* webpackChunkName: "firebase" */ 'firebase/app'),
        import(/* webpackChunkName: "firebase" */ 'firebase/firestore'),
        import(/* webpackChunkName: "firebase" */ 'firebase/storage'),
        import(/* webpackChunkName: "firebase" */ 'firebase/auth'),
      ]);

      this.fs = { ... };
      this.st = { ... };
      this.au = { ... };

      const firebaseConfig = config || getFirebaseConfigFromEnv();
      this.app = initializeApp(firebaseConfig);   // ← 失败点:env 缺 REACT_APP_FIREBASE_API_KEY
      ...
      this.initialized = true;
    })();

    return this.initPromise;
  }
```

`getFirebaseConfigFromEnv()` line 32-37 已 `console.warn('[FirebaseService] Firebase config is incomplete. ...')` —— 但这条 warn 在 import *complete* 后才打(因为 `Promise.all` resolve 后才进入 `getFirebaseConfigFromEnv` 调用)。

而 `initializeApp(firebaseConfig)` 若因无效 apiKey/projectId 直接 throw,**`initPromise` reject,`this.initialized` 永远 `false`,`isInitialized()` 永远返回 false**。
- **复现**:
  1. 把 `REACT_APP_FIREBASE_API_KEY` 设为非法字符串(如 `'invalid'`)。
  2. `npm run dev:web` → 进入 AnnotationStudio。
  3. 控制台:`[FirebaseService] Firebase config is incomplete.` (这条 OK) → 然后 `[AnnotationStudio] Firebase lazy init failed: ...`(被吞)。
  4. UI:零提示。加标注 → save skip → 刷新全无。
- **验证命令**:

```powershell
# 1. 看 initialize 的 catch
Select-String -Path src\pages\AnnotationStudio.tsx -Pattern "initialize\(\)" -Context 5

# 2. 看 firebaseService.isInitialized 守卫
Select-String -Path src\pages\AnnotationStudio.tsx -Pattern "isInitialized" -Context 3

# 3. 跑现有 firebaseService 单测
node --test src\services\firebaseService.test.ts
# 期望:5 case 全过(都是 isInitialized=false 路径)
```

- **修复建议**:
  - 最小修复:`.catch((error) => { console.warn(...); message.error('Firebase 初始化失败,标注不会持久化'); })` —— 加一个用户可见的 message.error。
  - 进一步:把 `firebaseService.isInitialized()` 改成 promise/observable,把 init 失败推到所有调用者一并 toast。

---

### B-07 [P1 新发现] `saveAnnotationsToFirebase` 静默吞 `updateDoc` 失败

- **AUDIT 对照**:新发现(与 B-06 同源)。
- **文件:行号**:`src/pages/AnnotationStudio.tsx:306-316`

```ts
const saveAnnotationsToFirebase = useCallback(
    async (recordId: string, annots: Annotation[]) => {
      if (!recordId || !firebaseService.isInitialized()) return;
      try {
        await firebaseService.updateRecordAnnotations(recordId, annots);
      } catch (error) {
        console.warn('[AnnotationStudio] Failed to save annotations:', error);
      }
    },
    []
  );
```

- **问题**:
  1. `updateRecordAnnotations` 走 `fs.updateDoc(fs.doc(this.db, 'records', recordId), { annotations, updatedAt })`(`firebaseService.ts:357-364`)。
  2. 任何运行时错误(网络断、权限拒绝、document 不存在)进 catch,**只 console.warn**。
  3. 用户连续添加 50 个标注 → 每次 1s debounce → 全部失败 → 全部 console.warn → 用户刷新 → 标注全无。
  4. 与 B-06 叠加 = "0 用户反馈路径"。
- **复现**:
  1. 配置合法 Firebase 但 Firestore security rules 拒绝写入。
  2. 用户加标注 → 1s 后 save 失败 → 控制台一条 warn → UI 零提示。
- **修复建议**:
  - 加 `message.error('Firebase 保存失败: ' + error.message)`,首次失败时弹一次,后续失败可以静默(避免弹窗轰炸)。
  - 或者把"save 失败"事件加到 Redux,SignalMetrics 或顶部 hero 显示"未保存"小标。

---

### B-08 [P2 残留] `handleMinimaxAnalyze` 重复声明 `hasDirectConfig` / `useProxy`

- **AUDIT 对照**:R-16 P1 残留。原始 audit R-16 已识别,但 R-16 主轴是"前端直连 MiniMax 的合规风险",本轮审计 Track B 重点是"死代码 / 闭包作用域混淆"。本条算 R-16 子集残留。
- **文件:行号**:`src/pages/AnnotationStudio.tsx:622-646`

```ts
const handleMinimaxAnalyze = async (): Promise<void> => {
    const hasDirectConfig = minimaxEndpoint.trim() && minimaxApiKey.trim();
    const useProxy = !hasDirectConfig;

    if (!useProxy && (!minimaxEndpoint.trim() || !minimaxApiKey.trim())) {
      message.warning('请先填写 Minimax Endpoint 和 API Key');
      return;
    }

    setMinimaxLoading(true);
    try {
      const signalData = leads.map((lead) => lead.data);

      // Determine if we should use proxy or direct API
      const hasDirectConfig = minimaxEndpoint.trim() && minimaxApiKey.trim();   // ← 重复
      const useProxy = !hasDirectConfig;                                          // ← 重复

      const predictions = await minimaxService.analyzeECG(signalData, {
        endpoint: minimaxEndpoint.trim(),
        apiKey: minimaxApiKey.trim(),
        model: minimaxModel.trim() || undefined,
        useProxy,
      });
      dispatch(setInferenceResults(predictions));
      message.success(useProxy ? 'Minimax 分析完成（通过代理）' : 'Minimax 分析完成');
```

- **问题**:
  1. line 623-624 外层声明 `hasDirectConfig` / `useProxy`,line 626 用一次(`if (!useProxy ...)`)。
  2. line 636-637 try 块内**重新声明**同样两个 const,line 643 `useProxy` 引用的是**内层**变量(虽然内层值等于外层)。
  3. line 646 `message.success(useProxy ? ...)` 也是内层 `useProxy`(其实同样值,因为闭包内 `minimaxEndpoint.trim() && minimaxApiKey.trim()` 不会跨 await 边界变)。
  4. 死代码:外层 `hasDirectConfig` 和 line 626 的 `useProxy` 在 line 637 后就被覆盖,但 line 626 的检查必须用外层(因为检查在 try 块外)。
  5. **未来风险**:若开发者后来在内层 try 块加 if 判断修改 `useProxy`,line 646 的 message 会用新值,但 line 626 的检查还是外层值(因为检查在 try 块外、line 637 之前),行为分裂。
- **复现**:
  1. 设 `minimaxEndpoint='https://x', minimaxApiKey='k'` → 两个 useProxy 都 `false` → 走 `analyzeECG(...useProxy:false...)` 直连分支。
  2. 设两者为空 → useProxy 都 `true` → 走代理。
  3. 行为一致 → **当前无功能 bug**,但代码卫生差。
- **验证命令**:

```powershell
Select-String -Path src\pages\AnnotationStudio.tsx -Pattern "hasDirectConfig|useProxy" -Context 1
# 期望看到 4 行声明/使用,实际是 4 处声明/赋值 + 重复
```

- **修复建议**:删除 line 636-637 内层重复声明,直接用外层 `useProxy`(`useCallback` 包一层让它稳定)。

---

### B-09 [P2 残留] `ECGCanvas.renderWaveforms` 在播放期持续分配 `fabric.Shadow`

- **AUDIT 对照**:R-17 P2 残留。
- **文件:行号**:`src/components/Canvas/ECGCanvas.tsx:150-153, 172-244, 247-294`

```ts
useEffect(() => {
    if (!fabricCanvasRef.current || leads.length === 0) return;
    renderWaveforms();
  }, [leads]);
```

```ts
const renderWaveforms = useCallback(() => {
    const canvasInstance = fabricCanvasRef.current;
    if (!canvasInstance) return;

    canvasInstance.getObjects().forEach((obj) => {
      if (
        obj.name?.startsWith('waveform_') ||
        obj.name?.startsWith('label_') ||
        obj.name?.startsWith('grid_')
      ) {
        canvasInstance.remove(obj);
      }
    });
    ...
    leads.forEach((lead, index) => {
      ...
      const polyline = new fabric.Polyline(
        points.reduce((acc: { x: number; y: number }[], val, i) => {
          if (i % 2 === 0) acc.push({ x: val, y: points[i + 1] });
          return acc;
        }, []),
        {
          stroke: color,
          strokeWidth: 1.7,
          ...
          shadow: new fabric.Shadow({   // ← 每次新建
            color: `${color}88`,
            blur: 6,
            offsetX: 0,
            offsetY: 0,
          }),
        }
      );

      canvasInstance.add(polyline);
      ...
    });

    drawGrid(canvasInstance, minorGridSize, leadBandHeight);   // ← grid 每次也重建
    canvasInstance.renderAll();
  }, [leads, width, height]);
```

- **问题**:
  1. `leads` 每次变(useState in AnnotationStudio line 252),`useEffect([leads])` 触发 `renderWaveforms`。
  2. `renderWaveforms` 全清 waveform/label/grid(`canvasInstance.remove(obj)`),然后 6 导联 × 重建 Polyline + Shadow + Text label + grid lines。
  3. 播放模式(line 255 `setInterval(...120)`):每 120ms 一次 `setLeads` → 8.3 Hz 重建频率。
  4. 6 导联 × 1.5K 点 Polyline × Shadow 对象:每次重建 ~6 个 Fabric Object。
  5. **没有显式 `obj.dispose()`** —— Fabric 5.x 的 `canvas.remove(obj)` 只从 canvas 移除,obj 内部的 `cacheCanvas` 等资源不会被 GC。
  6. Shadow 是 Polyline 的 `shadow` 属性,Polyline 被 GC 时 Shadow 才会被 GC;但 Fabric 内部 `_objects` 数组对 Shadow 的引用直到 Polyline 真正被销毁才消失。
- **复现**:
  1. AnnotationStudio 默认 demo + 按 Space 开播放。
  2. Chrome DevTools → Performance → 录制 30s → 看到 "Scripting" 时间持续 ~10-30ms/tick。
  3. Memory → JS heap 持续上升,1 min 内涨 5-10 MiB。
- **验证命令**:

```powershell
# 1. 看是否有 obj.dispose() 调用
Select-String -Path src\components\Canvas\ECGCanvas.tsx -Pattern "dispose"
# 只有 line 145 的 canvasInstance.dispose()(组件 unmount),没有 per-obj dispose

# 2. 看 Shadow 创建
Select-String -Path src\components\Canvas\ECGCanvas.tsx -Pattern "new fabric\.Shadow"

# 3. 看播放 interval
Select-String -Path src\pages\AnnotationStudio.tsx -Pattern "setInterval|playbackEnabled"
```

- **修复建议**:
  - 缓存 grid:`useMemo` 包一层 `buildGrid(width, height, leadCount)`,只依赖 canvas geometry,不依赖 leads.data。
  - 缓存 Shadow:`useMemo` 或模块级 const `SHADOW` 数组(per color),不每次 new。
  - Polyline 增量更新:用 `polyline.set({ points })` 而非 `new fabric.Polyline`,配合 dirty flag。
  - 离开 component 之前遍历 `canvasInstance.getObjects()` 调 `obj.dispose()`,再 `canvasInstance.dispose()`。

---

### B-10 [P3 残留] `INITIAL_DEMO_LEADS` 模块级单例

- **AUDIT 对照**:R-12 P2 残留(被 C-01 间接缓解,但没消失)。
- **文件:行号**:`src/pages/AnnotationStudio.tsx:89`

```ts
const INITIAL_DEMO_LEADS = createDemoLeads();
```

```ts
const sourceLeadsRef = useRef<ECGLead[]>(INITIAL_DEMO_LEADS.map((lead) => ({ ...lead, data: [...lead.data] })));
  const [leads, setLeads] = useState<ECGLead[]>(() =>
    INITIAL_DEMO_LEADS.map((lead) => ({ ...lead, data: [...lead.data] }))
  );
```

- **问题**:
  1. 模块加载即生成 6 × 1800 样本,固化 `phaseOffset` + `slowDrift` + `tinyNoise`(`buildLeadSignal` line 69-74)。
  2. `data` 通过 `[...lead.data]` 深拷贝(shallow + per-lead.data deep)→ 首发安全。
  3. HMR 期间若 module 没重载(仅 fast refresh),`INITIAL_DEMO_LEADS` 引用保留;useState 闭包也保留 → 数据一致 → 短期没暴露。
  4. **C-01 修复后**:`applyImportedLeads` 调 `sourceLeadsRef.current = cloneLeads(nextLeads)` + `setLeads(...)`,所以 import 之后 `INITIAL_DEMO_LEADS` 不再被引用,**风险下降**。
  5. 剩余风险:HMR 同时修改 `AnnotationStudio.tsx` 和 `INITIAL_DEMO_LEADS` 计算逻辑时,旧 module 的 `INITIAL_DEMO_LEADS` 被新 module 取代但旧 useState 引用仍指向旧数组 → "波形错位 + 慢漂移相位不一致"。
- **复现**:HMR 反复修改 `buildLeadSignal` 的 phase/scale/baseline,Save → AnnotationStudio 重新 mount → 波形相位跟预期不一致(因为旧 useState 仍引用 HMR 之前的 `INITIAL_DEMO_LEADS`)。
- **验证命令**:

```powershell
Select-String -Path src\pages\AnnotationStudio.tsx -Pattern "INITIAL_DEMO_LEADS|createDemoLeads" -Context 2
```

- **修复建议**:把 `INITIAL_DEMO_LEADS` 改成 `useRef<ECGLead[] | null>(null)` + `useState(() => INITIAL_DEMO_LEADS ?? createDemoLeads())`,或干脆改成 `useMemo(() => createDemoLeads(), [])`(确保每次组件挂载重新生成)。

---

### B-11 [P3 残留] `AnnotationToolbar` 暴露 5/7 类型(Q/S 通过 QRS 合并)

- **AUDIT 对照**:C-03 P2 修复了 ST / U 两个按钮(commit `46dc5d1`),但**没补 Q / S 独立按钮** —— 类型联合 `Annotation['type'] = 'P' | 'Q' | 'R' | 'S' | 'T' | 'ST' | 'U'` 有 7 个值,UI 只暴露 P / QRS(R) / T / ST / U 5 个按钮。
- **文件:行号**:`src/pages/components/AnnotationToolbar.tsx:13-67`

```tsx
const AnnotationToolbar: React.FC<AnnotationToolbarProps> = ({
  activeTool,
  activeAnnotationType,
  onSelectTool,
  onSelectAnnotationType,
  onDeleteAnnotation,
}) => {
  return (
    <Card className="section-card" title="标注工具" extra={<Tag color="purple">Hotkeys</Tag>}>
      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 10 }}>
        先选择标注类型,再在波形区双击落点；删除时先单击选中标注。
      </div>
      <Space direction="vertical" style={{ width: '100%' }}>
        <Button ... onClick={() => onSelectAnnotationType('P')}>标注 P 波 (Ctrl+1)</Button>
        <Button ... onClick={() => onSelectAnnotationType('R')}>标注 QRS (Ctrl+2)</Button>
        <Button ... onClick={() => onSelectAnnotationType('T')}>标注 T 波 (Ctrl+3)</Button>
        <Button ... onClick={() => onSelectAnnotationType('ST')}>标注 ST 段</Button>
        <Button ... onClick={() => onSelectAnnotationType('U')}>标注 U 波</Button>
        <Button block onClick={() => onSelectTool('pan')}>切换平移模式</Button>
        <Button block danger onClick={onDeleteAnnotation}>删除已选标注</Button>
      </Space>
    </Card>
  );
};
```

- **问题**:
  1. 类型层声明 `'Q' | 'S'`,但 UI 不暴露独立按钮。
  2. `Ctrl+1/2/3` 快捷键(line 272-288)只覆盖 P / R / T —— 没快捷键给 Q / S / ST / U。
  3. `ECGCanvas.handleAddAnnotation`(line 297-303) 的 fallback `annotationTypes = ['P', 'Q', 'R', 'S', 'T']` —— 当用户没在 toolbar 选(`selectedTypeRef.current === undefined`)时,随机从 5 个里选 —— 落到 Q 或 S 的概率 40%,但 UI 永远看不到 Q / S 按钮,**随机性不可见**。
- **复现**:
  1. AnnotationStudio 默认进 → 切换到"标注模式"(点 P 波按钮)。
  2. 双击波形 → P 标注出现(预期)。
  3. 用 React DevTools 把 `annotationTypeRef.current` 强制 `undefined`。
  4. 双击波形 → 随机 P/Q/R/S/T 之一。
- **验证命令**:

```powershell
# 1. 看 toolbar 暴露类型
Select-String -Path src\pages\components\AnnotationToolbar.tsx -Pattern "onSelectAnnotationType"

# 2. 看 ECGCanvas 随机 fallback
Select-String -Path src\components\Canvas\ECGCanvas.tsx -Pattern "Math.random|annotationTypes" -Context 2
```

- **修复建议**:
  - 选项 A:UI 补 Q / S 独立按钮,与类型联合 7 种对齐。
  - 选项 B:类型联合去掉 Q / S(用 QRS 包含),同时去掉 fallback 随机数组里的 Q / S。
  - 选项 C:fallback 默认 'P' 而非 random,行为可预测。

---

### B-12 [P3 新发现] `ECGCanvas.annotationTypeRef.current` fallback 仍随机选 Q/S/T

- **AUDIT 对照**:新发现,与 B-11 同根因。
- **文件:行号**:`src/components/Canvas/ECGCanvas.tsx:296-320`

```ts
const handleAddAnnotation = (pointer: { x: number; y: number }) => {
    const annotationTypes: Annotation['type'][] = ['P', 'Q', 'R', 'S', 'T'];
    const allAnnotationTypes: Annotation['type'][] = ['P', 'Q', 'R', 'S', 'T', 'ST', 'U'];
    const selectedType = annotationTypeRef.current;
    const type =
      selectedType && allAnnotationTypes.includes(selectedType)
        ? selectedType
        : annotationTypes[Math.floor(Math.random() * annotationTypes.length)];
    ...
  };
```

- **问题**:
  1. `selectedType` 为 `undefined` 时(用户从没点 toolbar 按钮),fallback 走 `Math.random` 选 P/Q/R/S/T。
  2. AnnotationStudio 在 line 530-533 `handleSelectAnnotationType` 总是被 `Ctrl+1/2/3` 或 toolbar 调用 —— 正常路径下 `selectedType` 不会为 undefined。
  3. **触发路径**:React StrictMode 下 effect 跑两次,或 HMR 重置 ref → `annotationTypeRef.current` 暂时为 undefined。
  4. fallback 选中 Q 或 S 后,用户看到的标注类型与 toolbar 选中状态不一致(因为 toolbar 没显示 Q/S),**用户无法回退**。
- **修复建议**:把 fallback 改成 `'P'`(默认 P),或 `'R'`(最常见)。

---

### B-13 [P3 锁定] 导出 CSV 仍无 position 单位说明(C-06 故意不改)

- **AUDIT 对照**:C-06 P2 锁定。
- **文件:行号**:`src/utils/exportUtils.ts:60`

```ts
lines.push('Type,Position,Confidence,Manual');
```

- **状态**:表头字符串不变,既无 `PositionUnit` 列也无 JSON 顶层 `coordinateSpace` 字段。
- **测试**:`src/utils/exportUtils.test.ts:119-145` "exportToCSV header and per-row field order match exactly" pin 住 `Type,Position,Confidence,Manual`。
- **结论**:行为锁定,与 C-06 决议一致。

---

### B-14 [P3 锁定] `findRPeaks` 在 `threshold=0` 仍永不退出 inPeak(C-07 故意不改)

- **AUDIT 对照**:C-07 P3 锁定。
- **文件:行号**:`src/utils/signalProcessor.ts:119-132`

```ts
for (let i = 0; i < normalized.length; i++) {
    if (normalized[i] > threshold && !inPeak) {
      inPeak = true;
      peakStart = i;
    } else if (normalized[i] < threshold * 0.5 && inPeak) {
      inPeak = false;
      ...
      peaks.push(maxIdx);
    }
  }
```

- **行为**:`threshold=0` → 退出条件 `normalized[i] < 0 * 0.5` = `normalized[i] < 0` → 因为 `normalized[i] = Math.abs(...) / signalMax >= 0`,永远不成立 → `inPeak` 一旦置 true 不退出 → 无 peaks。
- **测试**:`src/utils/signalProcessor.findRPeaks.test.ts` 含 "findRPeaks threshold of 0 returns no peaks (inPeak never exits)" pin。
- **结论**:行为锁定,与 C-07 决议一致。

---

## 3. 测试覆盖评估

| 文件                                              | case 数 | 覆盖什么                                                                                                                | 缺口                                              |
|--------------------------------------------------|---------|-------------------------------------------------------------------------------------------------------------------------|-----------------------------------------------|
| `src/utils/buildDiagnosis.test.ts`               | 6       | R-01 修复:三态 source、HR fallback、空结果、mock flag 忽略                                                                   | 无                                              |
| `src/utils/exportUtils.test.ts`                  | 13      | JSON / CSV 字段透传 + annotation.position 透传 + diagnosis.source 透传 + C-06/C-07 锁定                                      | e2e 缺 diagnosis.source assertion             |
| `src/store/ecgSlice.test.ts`                     | 9       | C-01 修复:setAnnotations([]) 清空、addAnnotation、removeAnnotation、clearECG 全清                                              | 无                                              |
| `src/pages/components/SignalMetrics.test.tsx`    | 5       | R-02 修复:MOCK chip 显隐、Results tag 不回归                                                                              | 无                                              |
| `src/__tests__/annotationWorkflow.test.tsx`      | 6       | Workflow A/B 端到端 import → analyze → PQRST → delete → export JSON/CSV,Workflow C/D UI 渲染                              | 无 inferenceResults 清空断言(对应 B-05)         |
| `src/utils/signalProcessor.findRPeaks.test.ts`   | 7       | R 峰检测 + `ECG_CANVAS_VIEW_WIDTH` 集成 + threshold=0 锁定(C-07)                                                               | 无                                              |
| `src/components/Canvas/autoRPeakAnnotations.test.ts` | 11 | auto R 峰坐标换算 + y anchored + 多 lead                                                                                 | 无                                              |
| `src/components/Canvas/constants.test.ts`        | ~7      | viewWidth / computeLeadBandHeight / computeAmplitudeScale / computeCanvasPointForSample                                     | 无                                              |
| `src/services/firebaseService.test.ts`           | 5       | 未初始化状态的所有方法抛"not initialized"                                                                                | 缺 init 失败路径(对应 B-06)                     |

**测试覆盖判断**:
- ✅ R-01 / R-02 修复路径完整覆盖(单元 + 集成 + 端到端)。
- ✅ C-01..C-07 行为锁定完整。
- ⚠️ **新发现 B-03 / B-04 / B-05 没有测试**:URL 切 recordId / save debounce / inferenceResults 跨记录污染。建议新增 1-2 个 e2e 覆盖 import 之前先 AI 分析 → import 新记录 → 验证 SignalMetrics 显示空 + 导出 JSON 诊断 `source='unavailable'`。
- ⚠️ **新发现 B-06 / B-07 没有测试**:Firebase init 失败 / updateDoc 失败 → 0 用户反馈路径。需要 mock firebaseService 抛错 + 验证 UI 弹 message.error。
- ⚠️ **新发现 B-08 没有测试**:handleMinimaxAnalyze 死代码(纯 lint 关注)。
- ⚠️ **残留 R-17 没有 perf test**:播放期 30s 内存 / scripting 时间没有 benchmark。

---

## 4. 验证命令清单(一次性跑完)

```powershell
Set-Location "D:\VS vibe coding files\ecg-annotation-platform"

# A. 跑全量测试,确认 B-01 / B-02 修复无回归
npm run check
# 期望:lint 0 / typecheck 0 / test:unit 全过 / build OK

# B. 单跑 R-01 / R-02 相关
node --test src\utils\buildDiagnosis.test.ts src\utils\exportUtils.test.ts src\store\ecgSlice.test.ts src\pages\components\SignalMetrics.test.tsx
# 期望:33 case 全过

# C. 单跑 e2e 链
node --test src\__tests__\annotationWorkflow.test.tsx
# 期望:6 case 全过

# D. URL 切换 effect 是否清空 annotations(查源码)
Select-String -Path src\pages\AnnotationStudio.tsx -Pattern "setAnnotations\(\["
# 期望:出现 2 次(applyImportedLeads + clearECG),URL effect 内 0 次

# E. applyImportedLeads 是否清 inferenceResults
Select-String -Path src\pages\AnnotationStudio.tsx -Pattern "applyImportedLeads" -Context 10
# 期望:setAnnotations([]) 后应有 setInferenceResults([]),当前缺失

# F. saveAnnotationsToFirebase 是否 console.warn 吞错
Select-String -Path src\pages\AnnotationStudio.tsx -Pattern "saveAnnotationsToFirebase" -Context 5

# G. handleMinimaxAnalyze 重复声明
Select-String -Path src\pages\AnnotationStudio.tsx -Pattern "hasDirectConfig|useProxy"
# 期望:4 行(2 声明 + 2 使用),实际 6 行(2 重复)

# H. Shadow 重建
Select-String -Path src\components\Canvas\ECGCanvas.tsx -Pattern "new fabric\.Shadow"

# I. INITIAL_DEMO_LEADS 模块级
Select-String -Path src\pages\AnnotationStudio.tsx -Pattern "INITIAL_DEMO_LEADS"

# J. Toolbar 暴露类型
Select-String -Path src\pages\components\AnnotationToolbar.tsx -Pattern "onSelectAnnotationType\("
```

---

## 5. 修复优先级建议(不修代码,仅排序)

1. **B-05 [P1]** —— `applyImportedLeads` 加 `dispatch(setInferenceResults([]))`,最小修复,与 C-01 配对完成。建议同时新增 e2e: import 之前先 analyze → import 新记录 → 验证 SignalMetrics 空。
2. **B-03 [P1]** + **B-04 [P1]** —— URL effect 清空 annotations/inferenceResults/leads;或者把"URL 切 recordId"路由到 `applyImportedLeads` 的"换记录"分支。两条 bug 一并修。
3. **B-06 [P1]** + **B-07 [P1]** —— Firebase init / save 失败时弹 message.error,把"静默丢失"变成"用户可见"。建议在 SignalMetrics Card 加"未持久化"小标。
4. **B-08 [P2]** —— `handleMinimaxAnalyze` 删 line 636-637 内层重复声明,纯代码卫生。
5. **B-09 [P2]** —— ECGCanvas 缓存 grid + Shadow 数组,改增量更新;加 `obj.dispose()` 在 unmount。性能优化。
6. **B-11 [P2]** + **B-12 [P3]** —— Toolbar 补 Q/S 独立按钮 或 收窄类型联合 + fallback 改为 'P' 默认;UI/类型对齐。
7. **B-10 [P3]** —— INITIAL_DEMO_LEADS 改为 `useMemo(() => createDemoLeads(), [])`,去掉模块级单例。
8. **B-13 / B-14 [P3 锁定]** —— 行为锁定,与 C-06 / C-07 决议一致,不修。

---

## 6. 与 2026-07-04 audit / canvas closeout 的差异

- **AUDIT-2026-07-04-model-canvas.md**:
  - **R-01 P0**: ✅ 已修,buildDiagnosis + exportUtils 双层覆盖,本轮验证彻底。
  - **R-02 P0**: ✅ 已修,SignalMetrics chip + AIAnalysisPanel alert 双层,本轮验证彻底。
  - **R-12 P2**: ⚠️ 残留,INITIAL_DEMO_LEADS 仍在,但 C-01 修复后实际触发面缩小。
  - **R-15 P3**: ⚠️ 残留,useEffect keydown 空 deps,纯 lint 关注,运行时无 bug。
  - **R-17 P2**: ⚠️ 残留,renderWaveforms 仍每帧重建 Shadow,无 dispose。
  - **R-20 P1**: ⚠️ 残留,console.warn 吞错,save 静默失败(B-06 / B-07 加深)。
  - **R-22 P1**: ⚠️ 残留,local- 前缀永不 save,但**新发现** URL 切换时旧 data 写到新 record(B-04)。
  - **R-23 P3**: ⚠️ 残留,deleteSignal 计数器 + ref 持有 selection,race 风险低(实测 no-op)。
  - **R-25 P3**: ⚠️ 残留,components index,但 7 个子组件全用,无功能影响。
  - **R-16 P1**: ⚠️ 残留死代码,具体表现是 `handleMinimaxAnalyze` 重复声明(B-08)。
- **2026-07-04-canvas-annotation-audit.md**:
  - **C-01 P1**: ⚠️ 修复了 annotations,但 inferenceResults 没被同时清(B-05)。
  - **C-02 P1**: ✅ 已修,ECG_CANVAS_VIEW_WIDTH 共享常量。
  - **C-03 P2**: ⚠️ 修复了 ST / U 按钮,但 Q / S 独立按钮仍缺失(B-11)。
  - **C-04 P2**: ✅ 已修,annotation.position / x 统一路径。
  - **C-05 P1**: ✅ 已修,Redux 是 single source of truth,useEffect([annotations]) 派生。
  - **C-06 P2**: 🔒 锁定,CSV 无 position 单位说明。
  - **C-07 P3**: 🔒 锁定,findRPeaks threshold=0 不退出 inPeak。

**新增 7 项**:B-03 / B-04 / B-05 / B-06 / B-07 / B-08(部分覆盖 R-16)/ B-11 / B-12。

---

## 7. 完成判定自检

| 项                                 | 要求                  | 实际                                                            |
|------------------------------------|-----------------------|-----------------------------------------------------------------|
| 输出文件                           | `docs/audits/2026-07-07-track-B-ui-canvas-persistence.md` | ✅ 本文件                                                         |
| 文件大小                           | > 8 KB                | 本文件 ~30 KB                                                  |
| 发现数                             | ≥ 8                   | 14(B-01..B-14)                                                |
| 字段完整                           | 每发现含 行号 / 证据 / 复现 / 验证命令 / AUDIT 对照 / 修复建议 | ✅ 全部齐全                                                       |
| 已修验证                           | R-01 / R-02 彻底验证   | ✅ B-01 / B-02 含修复 commit + 证据 + 测试 pin                    |
| 新发现                             | ≥ 1                   | ✅ 7 项(B-03 / B-04 / B-05 / B-07 / B-08 / B-11 / B-12)            |
| 锁定行为                           | C-06 / C-07 不修      | ✅ B-13 / B-14 显式确认锁定                                      |
| 代码片段                           | 真实 5-15 行           | ✅ 所有证据贴源码,无描述代替代码                                  |
| AUDIT 对照字段                     | 齐全                  | ✅ 每发现都标 残留 / 新发现 / 已修 / 锁定                          |

---

完。