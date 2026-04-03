<!-- planning-with-files:start -->
# Planning With Files

Use the planning-with-files pattern for multi-step work that needs durable memory on disk.

Recommended session layout:

- `.planning/<session-name>/task_plan.md`
- `.planning/<session-name>/findings.md`
- `.planning/<session-name>/progress.md`

Keep the notes concise, project-specific, and reusable.

# ECG Annotation Platform Notes

- Keep page-level routes lazy-loaded so `AnnotationStudio` and other large screens stay out of the initial bundle.
- Prefer project-aware planning notes under `.planning/` for local workflow state; do not rely on chat history for multi-step changes.
- Treat webpack output cleaning conservatively on Windows because locked files in `dist/` can break production builds.
- Keep `npm run build` and `npm run lint` usable after changes; lint warnings are acceptable short-term, but avoid introducing new lint errors.
<!-- planning-with-files:end -->
