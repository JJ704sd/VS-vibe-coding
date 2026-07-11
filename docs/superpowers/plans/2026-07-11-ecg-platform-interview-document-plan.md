# ECG Platform Interview Architecture Guide Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce a polished Chinese DOCX interview guide that embeds the verified ECG platform architecture, core data flows, testing strategy, resume corrections, and interview answers.

**Architecture:** Keep the committed Markdown spec as the technical source of truth. A task-local Python builder will generate five standalone diagrams and assemble a `compact_reference_guide` DOCX with an `editorial_cover`, real Word headings/lists, explicit table geometry, headers/footers, and embedded PNG diagrams. Render every page through the bundled document renderer and iterate until all pages pass visual QA.

**Tech Stack:** Bundled Python 3, `python-docx`, Pillow, OOXML helpers, LibreOffice headless renderer, Poppler, Markdown source in `docs/superpowers/specs/`.

---

## File Map

- Source of truth: `docs/superpowers/specs/2026-07-11-ecg-platform-interview-architecture-design.md`
- Create builder: `tmp/docx/interview-architecture/build_interview_guide.py`
- Create validation script: `tmp/docx/interview-architecture/validate_interview_guide.py`
- Create diagrams: `tmp/docx/interview-architecture/assets/*.png`
- Create render output: `tmp/docx/interview-architecture/rendered/page-*.png`
- Final deliverable: `output/documents/ecg-platform-interview-architecture-guide.docx`

### Task 1: Establish artifact contract and source-fact checks

**Files:**
- Create: `tmp/docx/interview-architecture/validate_interview_guide.py`
- Read: `docs/superpowers/specs/2026-07-11-ecg-platform-interview-architecture-design.md`

- [ ] **Step 1: Write the pre-build validator**

Create a validator that asserts the Markdown contains the required facts and that the planned output is absent before the first build:

```python
from pathlib import Path

ROOT = Path(r"D:\VS vibe coding files\ecg-annotation-platform")
SPEC = ROOT / "docs/superpowers/specs/2026-07-11-ecg-platform-interview-architecture-design.md"
OUTPUT = ROOT / "output/documents/ecg-platform-interview-architecture-guide.docx"

text = SPEC.read_text(encoding="utf-8")
for required in [
    "Webpack 5",
    "diagnosis.source = real | mock | unavailable",
    "FastAPI Sidecar",
    "风险驱动回归闭环",
    "前端训练控制请求没有附带 admin token",
]:
    assert required in text, required
assert not OUTPUT.exists(), "remove stale output before first build"
```

- [ ] **Step 2: Run the validator and record the baseline**

Run:

```powershell
& $BUNDLED_PYTHON tmp/docx/interview-architecture/validate_interview_guide.py
```

Expected: exit `0`; no stale final DOCX exists.

### Task 2: Build five architecture diagrams

**Files:**
- Create: `tmp/docx/interview-architecture/build_interview_guide.py`
- Create: `tmp/docx/interview-architecture/assets/system-context.png`
- Create: `tmp/docx/interview-architecture/assets/annotation-flow.png`
- Create: `tmp/docx/interview-architecture/assets/training-flow.png`
- Create: `tmp/docx/interview-architecture/assets/test-pyramid.png`
- Create: `tmp/docx/interview-architecture/assets/deployment-view.png`

- [ ] **Step 1: Implement reusable diagram primitives**

In the builder, define `rounded_box`, `arrow`, `label`, `save_diagram`, and a Microsoft YaHei font loader. Use a 2200x1250 canvas, white background, navy ink, green accent, blue integration nodes, amber risk nodes, and 2x supersampling before final resize.

```python
FONT_PATHS = [
    Path(r"C:\Windows\Fonts\msyh.ttc"),
    Path(r"C:\Windows\Fonts\msyhbd.ttc"),
]
CANVAS = (2200, 1250)
COLORS = {
    "navy": "#123B56", "green": "#20A464", "blue": "#EAF3FA",
    "mint": "#EAF7F1", "amber": "#FFF4D8", "line": "#6C7A86",
    "ink": "#1F2D36", "muted": "#5D6B75", "white": "#FFFFFF",
}
```

- [ ] **Step 2: Draw the system context and annotation sequence**

The system context must show Browser, Node Mock API, FastAPI Sidecar, Firebase, ECGFounder workspace, Minimax, and PTB-XL fallback. The annotation flow must show Import -> Parse -> Normalize -> Annotate -> Explicit real/mock inference -> diagnosis source -> Export, with the cross-record reset invariant highlighted.

- [ ] **Step 3: Draw training, testing, and deployment views**

The training diagram must distinguish REST queries, SSE streams, file-state polling, and protected destructive commands. The testing diagram must show static checks, unit/service tests, component/workflow tests, API/security contracts, backend pytest, build/assets, and CI deployment. The deployment diagram must separate GitHub Pages static hosting from the local full demo.

- [ ] **Step 4: Validate diagram files**

Run a Pillow check that every PNG is 2200x1250 RGB/RGBA, non-empty, and has at least 20 distinct colors.

Expected: five valid PNG files; no label is clipped in manual image inspection.

### Task 3: Generate the Word document

**Files:**
- Modify: `tmp/docx/interview-architecture/build_interview_guide.py`
- Create: `output/documents/ecg-platform-interview-architecture-guide.docx`

- [ ] **Step 1: Configure the compact reference preset**

Use US Letter portrait, 1-inch margins, 0.492-inch header/footer distance, Microsoft YaHei 10.5pt body, 1.25 line spacing, 6pt after body paragraphs, and the `compact_reference_guide` spacing ladder. Use `editorial_cover` as the only first-page pattern. Use green as a named brand override for headings and navy for title/ink.

- [ ] **Step 2: Implement Word-native styles and numbering**

Create explicit `Normal`, `Title`, `Subtitle`, `Heading 1`, `Heading 2`, `Heading 3`, `Caption`, `Callout`, and `Code` styles. Define real bullet and decimal numbering with 0.187-inch marker alignment, 0.375-inch text indent, 0.188-inch hanging indent, 4pt after, and 1.25 line spacing.

- [ ] **Step 3: Implement fixed table geometry and page furniture**

All full-width tables must use 9360 DXA width, 120 DXA indent, fixed grids, 120 DXA horizontal cell margins, repeating header rows, and no fixed row heights. Use a quiet green header fill with white text and alternating white/light-gray body rows only where comparison benefits.

- [ ] **Step 4: Assemble the guide content**

Create these sections in order:

1. Editorial cover and “先记住这三句话” lead callout.
2. System positioning and fact boundary.
3. System context, layered architecture, and module matrix.
4. Annotation/inference/export data flow and invariants.
5. Case fallback, training/SSE, assistant/Minimax flows.
6. State/data contracts, error degradation, and security boundaries.
7. Testing architecture, priority matrix, and regression loop.
8. Deployment constraints and implemented-vs-evolution boundary.
9. Resume wording corrections.
10. One-minute and three-minute interview narratives.
11. High-frequency questions with concise answer frameworks.
12. Final interview checklist.

- [ ] **Step 5: Save and structurally validate the DOCX**

Update the validator to open the DOCX and assert:

```python
from docx import Document

doc = Document(OUTPUT)
all_text = "\n".join(p.text for p in doc.paragraphs)
assert len(doc.inline_shapes) == 5
assert len(doc.tables) >= 5
assert "测试架构" in all_text
assert "简历与面试口径纠偏" in all_text
assert "不把 mock 当真实结果" in all_text
assert "待补内容" not in all_text
```

Expected: validator exits `0` and final DOCX is non-empty.

### Task 4: Render and inspect every page

**Files:**
- Read: `output/documents/ecg-platform-interview-architecture-guide.docx`
- Create: `tmp/docx/interview-architecture/rendered/page-*.png`

- [ ] **Step 1: Render with the packaged renderer**

Run:

```powershell
& $BUNDLED_PYTHON $DOCUMENT_SKILL/render_docx.py `
  output/documents/ecg-platform-interview-architecture-guide.docx `
  --output_dir tmp/docx/interview-architecture/rendered `
  --emit_pdf
```

Expected: one PNG per Word page and a non-empty PDF QA intermediate.

- [ ] **Step 2: Inspect every PNG at original resolution**

Check cover balance, Chinese glyphs, diagram sharpness, table wrapping, page breaks, repeated headers, footer page numbers, and whitespace. Record each defect in `.planning/interview-architecture-guide/progress.md` before changing the builder.

- [ ] **Step 3: Iterate until the render is clean**

Adjust only the builder, regenerate the DOCX, rerun structural validation, rerender all pages, and reinspect every page. Stop only when there is no clipping, overlap, unreadable text, broken table, orphan heading, or excessive blank page.

### Task 5: Final verification and handoff

**Files:**
- Verify: `output/documents/ecg-platform-interview-architecture-guide.docx`
- Update: `.planning/interview-architecture-guide/task_plan.md`
- Update: `.planning/interview-architecture-guide/progress.md`

- [ ] **Step 1: Run document audits**

Run the document skill's heading, section, image, table-geometry, and accessibility audits. Accept only findings that preserve the selected preset and the embedded diagram layout.

- [ ] **Step 2: Verify repository facts one last time**

Confirm Webpack scripts, model resource boundary, Clinic fallback behavior, sidecar ports/endpoints, auth contract, CI quality steps, and the 30/9 test-file counts against current files.

- [ ] **Step 3: Record completion**

Mark the persistent plan complete, append commands and results to `progress.md`, and confirm `git status --short` contains no accidental source edits. Do not stage or commit `tmp/`, render PNGs, or the visual-companion session.

- [ ] **Step 4: Deliver the DOCX**

Provide one standalone link to `output/documents/ecg-platform-interview-architecture-guide.docx`, plus a concise summary of included architecture, testing, and interview material.
