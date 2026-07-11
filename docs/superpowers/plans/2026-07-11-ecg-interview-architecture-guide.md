# ECG Interview Architecture Guide Implementation Plan

> **For agentic workers:** This plan produces documentation artifacts from the current repository; it does not change application behavior.

**Goal:** Create an interview-ready system architecture guide for the ECG annotation platform, including architecture diagrams, data flows, test strategy, and a question-and-answer appendix grounded in the current code.

**Architecture:** Use a two-view document: a system view for runtime components and a test view for risk/control points. Keep current implementation, known boundaries, and future evolution explicitly separated.

**Tech Stack:** Markdown, Mermaid, Python `python-docx`, LibreOffice headless renderer, Poppler PNG inspection.

---

### Task 1: Establish the factual baseline

**Files:**
- Create: `.planning/interview-architecture-guide/findings.md`
- Reference: `src/App.tsx`, `src/pages/AnnotationStudio.tsx`, `src/services/*.ts`, `src/store/*.ts`, `proxy-server/main.py`, `mock-api/server.js`, `proxy-server/tests/`

- [x] Record the verified runtime topology, data flow, fallback semantics, security controls, and test inventory in the planning findings.
- [x] Record resume/JD alignment and explicitly flag implementation-vs-resume terminology differences.

### Task 2: Write the validated architecture design

**Files:**
- Create: `docs/superpowers/specs/2026-07-11-ecg-interview-architecture-design.md`
- Create: `docs/interview/ecg-platform-architecture.mmd`

- [ ] Write the current-state system view, core module boundaries, data contracts, sequence flows, test strategy, risks, and interview narrative.
- [ ] Ensure Mermaid diagrams describe only code-backed components; label proposed evolution separately.

### Task 3: Build the printable interview guide

**Files:**
- Create: `output/docs/ecg-platform-interview-architecture-guide.docx`
- Create: `output/docs/ecg-platform-interview-architecture-guide.pdf`

- [ ] Convert the design into a compact reference guide with a cover title, architecture diagram, tables only for actual comparisons, and interview appendix.
- [ ] Use the `compact_reference_guide` preset with explicit page geometry, typography, table widths, and restrained blue-gray palette.

### Task 4: Verify artifacts

**Files:**
- Create: `tmp/docx-qa/ecg-platform-interview-architecture-guide/page-*.png`

- [ ] Render the DOCX with the packaged `render_docx.py` helper and inspect every page.
- [ ] Check Mermaid source for unresolved placeholders, verify Markdown/DOCX section parity, and confirm no personal data beyond the user-provided resume context is copied into the guide.
- [ ] Update `.planning/interview-architecture-guide/progress.md` with commands and outcomes.

### Task 5: Deliver and hand off

- [ ] Provide links to the Markdown design, Mermaid source, and DOCX/PDF guide.
- [ ] Summarize the 1-minute and 3-minute interview framing and the top five likely follow-up questions.
