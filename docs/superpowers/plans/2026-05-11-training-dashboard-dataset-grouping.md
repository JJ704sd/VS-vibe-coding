# Training Dashboard Dataset Grouping Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Group training history by dataset, showing each dataset's own round numbering. Supports both `round_N` (MIT-BIH) and `cpsc2018*` subdirectories as separate datasets.

**Architecture:** Modify backend parser to scan all subdirectories in `outputs/` as datasets, each containing their own training records. Frontend adds dataset grouping tabs/selectors.

**Tech Stack:** Python (FastAPI, parsers.py), React + TypeScript (TrainingDashboard.tsx, trainingApi.ts)

---

## File Changes Overview

| File | Change |
|------|--------|
| `proxy-server/parsers.py` | Rewrite `list_history_rounds()` to scan by dataset; add `list_datasets()` and `list_dataset_rounds()` |
| `proxy-server/main.py` | Add `/api/training/datasets` endpoint; update `/api/training/history` to return grouped data |
| `src/services/trainingApi.ts` | Add dataset types; update `getHistoryRounds()` response type |
| `src/pages/TrainingDashboard.tsx` | Add dataset selector/tabs; group history table by dataset |

---

## Task 1: Backend — Dataset Discovery

**Files:**
- Modify: `D:/VS vibe coding files/ecg-annotation-platform/proxy-server/parsers.py:136-147`

- [ ] **Step 1: Write the failing test**

```python
def test_list_datasets():
    """After implementation, outputs/ should have 2 dataset groups:
    - round_N (MIT-BIH) -> dataset "MIT-BIH"
    - cpsc2018* subdirs -> dataset "cpsc2018"
    """
    datasets = list_datasets()
    assert len(datasets) >= 1

def test_list_dataset_rounds():
    """Each dataset returns its own rounds sorted by number."""
    rounds = list_dataset_rounds("cpsc2018")
    assert isinstance(rounds, list)
```

- [ ] **Step 2: Run test to verify it fails**

Run: (skip — no test runner configured for proxy-server)

- [ ] **Step 3: Write implementation**

Replace `list_history_rounds()` with:

```python
def list_datasets() -> list[dict]:
    """
    扫描 outputs/ 下所有有训练数据的子目录，返回数据集列表。
    返回格式: [{"name": "MIT-BIH", "path": "round_N subdirs"}, ...]
    """
    datasets = {}
    for item in ECGFOUNDER_OUTPUTS.iterdir():
        if not item.is_dir():
            continue
        # round_N 目录 -> 归属 MIT-BIH 数据集
        if item.name.startswith("round_"):
            if "MIT-BIH" not in datasets:
                datasets["MIT-BIH"] = {"name": "MIT-BIH", "path": str(item.parent)}
        else:
            # 其他子目录视为独立数据集（cpsc2018, cpsc2018_finetune, etc.）
            datasets[item.name] = {"name": item.name, "path": str(item)}
    return list(datasets.values())


def list_dataset_rounds(dataset_name: str) -> list[dict]:
    """
    扫描指定数据集目录，返回该数据集下所有 round 记录。
    - dataset_name == "MIT-BIH": 扫描 outputs/ 下所有 round_N 子目录
    - dataset_name == "cpsc2018": 扫描 outputs/cpsc2018/
    """
    if dataset_name == "MIT-BIH":
        base = ECGFOUNDER_OUTPUTS
        prefix = "round_"
    else:
        base = ECGFOUNDER_OUTPUTS / dataset_name
        if not base.exists():
            return []
        prefix = "round_"

    rounds = []
    if dataset_name == "MIT-BIH":
        # 扫描 outputs/ 下所有 round_N 目录
        for item in base.iterdir():
            if item.is_dir() and item.name.startswith(prefix):
                try:
                    num = int(item.name.split("_")[1])
                    rounds.append({"name": item.name, "number": num, "path": str(item)})
                except ValueError:
                    pass
    else:
        # 扫描指定数据集子目录
        for item in base.iterdir():
            if item.is_dir() and item.name.startswith(prefix):
                try:
                    num = int(item.name.split("_")[1])
                    rounds.append({"name": item.name, "number": num, "path": str(item)})
                except ValueError:
                    pass

    rounds.sort(key=lambda x: x["number"])
    return rounds


def list_history_rounds() -> list[dict]:
    """保持向后兼容：返回所有 round_N（不论数据集）"""
    return list_dataset_rounds("MIT-BIH")
```

- [ ] **Step 4: Commit**

```bash
cd "D:/VS vibe coding files/ecg-annotation-platform"
git add proxy-server/parsers.py
git commit -m "feat: add multi-dataset round scanning to parsers.py"
```

---

## Task 2: Backend — Add Datasets API Endpoint

**Files:**
- Modify: `D:/VS vibe coding files/ecg-annotation-platform/proxy-server/main.py:206-222`

- [ ] **Step 1: Add new endpoint after existing history endpoints**

```python
@app.get("/api/training/datasets")
async def get_training_datasets():
    """返回所有数据集列表，每个数据集包含其 round 记录摘要"""
    from parsers import list_datasets, list_dataset_rounds, parse_evaluation

    datasets = []
    for ds in list_datasets():
        ds_name = ds["name"]
        rounds = list_dataset_rounds(ds_name)
        rounds_with_eval = []
        for r in rounds:
            eval_data = parse_evaluation(r["name"])
            rounds_with_eval.append({
                "round": r["name"],
                "number": r["number"],
                "best_f1": eval_data.get("test_macro_f1", 0) if eval_data else 0,
                "test_accuracy": eval_data.get("test_accuracy", 0) if eval_data else 0,
                "path": r["path"],
            })
        datasets.append({
            "name": ds_name,
            "path": ds["path"],
            "rounds": rounds_with_eval,
        })
    return datasets
```

- [ ] **Step 2: Update `/api/training/history` to also return dataset info**

```python
@app.get("/api/training/history")
async def get_training_history():
    from parsers import list_datasets, list_dataset_rounds, parse_evaluation

    all_rounds = []
    for ds in list_datasets():
        ds_name = ds["name"]
        rounds = list_dataset_rounds(ds_name)
        for r in rounds:
            eval_data = parse_evaluation(r["name"])
            all_rounds.append({
                "round": r["name"],
                "number": r["number"],
                "dataset": ds_name,
                "best_f1": eval_data.get("test_macro_f1", 0) if eval_data else 0,
                "test_accuracy": eval_data.get("test_accuracy", 0) if eval_data else 0,
                "path": r["path"],
            })
    # Sort by dataset, then by number
    all_rounds.sort(key=lambda x: (x["dataset"], x["number"]))
    return all_rounds
```

- [ ] **Step 3: Test the new endpoint**

```bash
curl -s http://localhost:6090/api/training/datasets | python -m json.tool
```

Expected: JSON array with dataset names and their rounds count

- [ ] **Step 4: Commit**

```bash
git add proxy-server/main.py
git commit -m "feat: add /api/training/datasets endpoint for multi-dataset grouping"
```

---

## Task 3: Frontend — Add Dataset Types to trainingApi.ts

**Files:**
- Modify: `D:/VS vibe coding files/ecg-annotation-platform/src/services/trainingApi.ts:51-57`

- [ ] **Step 1: Update HistoryRound interface**

```typescript
export interface HistoryRound {
  round: string;
  number: number;
  dataset: string;  // 新增：数据集名称
  best_f1?: number;
  test_accuracy?: number;
  path: string;
}

export interface DatasetInfo {  // 新增
  name: string;
  path: string;
  rounds: HistoryRound[];
}
```

- [ ] **Step 2: Add datasets API function**

```typescript
export async function getTrainingDatasets(): Promise<DatasetInfo[]> {
  const res = await fetch(`${API_BASE}/api/training/datasets`);
  if (!res.ok) throw new Error('Failed to fetch datasets');
  return res.json();
}
```

---

## Task 4: Frontend — Update TrainingDashboard with Dataset Grouping

**Files:**
- Modify: `D:/VS vibe coding files/ecg-annotation-platform/src/pages/TrainingDashboard.tsx:46-84`

- [ ] **Step 1: Add dataset selector state**

In `TrainingDashboard` component, add:

```typescript
const [selectedDataset, setSelectedDataset] = useState<string | null>(null);
const [datasets, setDatasets] = useState<DatasetInfo[]>([]);

useEffect(() => {
  trainingApi.getTrainingDatasets().then(setDatasets).catch(console.error);
}, []);
```

- [ ] **Step 2: Update HistoryTable to show dataset column**

In `HistoryTable` columns, add dataset column:

```typescript
{
  title: 'Dataset',
  dataIndex: 'dataset',
  key: 'dataset',
  render: (text: string) => <Tag color="green">{text}</Tag>,
},
```

- [ ] **Step 3: Add dataset filter dropdown above table**

```typescript
<Space style={{ marginBottom: 16 }}>
  <span>数据集:</span>
  <Select
    placeholder="选择数据集"
    allowClear
    style={{ width: 200 }}
    onChange={(val) => setSelectedDataset(val)}
    options={datasets.map(ds => ({ label: ds.name, value: ds.name }))}
  />
</Space>

<HistoryTable
  rounds={selectedDataset ? rounds.filter(r => r.dataset === selectedDataset) : rounds}
  ...
/>
```

- [ ] **Step 4: Commit**

```bash
git add src/services/trainingApi.ts src/pages/TrainingDashboard.tsx
git commit -m "feat: group training history by dataset in dashboard"
```

---

## Verification

After all tasks:

1. **Backend verification:**
   ```bash
   curl -s http://localhost:6090/api/training/datasets | python -m json.tool
   # Should show: MIT-BIH (with round_1-round_24), cpsc2018, etc.

   curl -s http://localhost:6090/api/training/history | python -m json.tool
   # Should show each round with "dataset" field
   ```

2. **Frontend verification:**
   - Training dashboard should show dataset dropdown
   - Selecting a dataset filters the table to that dataset's rounds
   - Each row shows the dataset name in a green tag