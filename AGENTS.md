# Project Guidelines

## Code Style
- TypeScript strict mode
- ESLint with some relaxations (exhaustive-deps off)
- Prettier for formatting: `npm run format`

Reference: [tsconfig.json](tsconfig.json), [.eslintrc.json](.eslintrc.json)

## Architecture
- React 18 + TypeScript -> Redux Toolkit -> TensorFlow.js + Fabric.js + Ant Design -> Firebase/IndexedDB
- Pages lazy-loaded with code splitting
- State: ecgSlice (annotations, canvas, model) + caseSlice (patients, records)
- Services: singleton pattern with fallbacks
- Data: Patient -> ECGRecord[] -> ECGLead[] + Annotation[] + ModelPrediction[]

See [SPEC.md](SPEC.md) for detailed architecture and use cases.

## Build and Test
- `npm start`: dev server + mock API
- `npm run build`: production build
- `npm test`: Jest tests
- `npm run lint`: ESLint

## Conventions
- Lazy routes: All pages use React.lazy() with Suspense
- Service singletons: Fallback to mock if load fails
- State slices: Add to existing slices unless orthogonal
- Redux: inferenceResults excluded from serialization (TF tensors)
- Canvas: Fabric.js wrapper with ref-based init
- Path aliases: @, @components, etc.
- Planning: Use .planning/ for multi-step work notes
- Visual system: Prefer shadcn-style neutral surfaces, compact card hierarchies, and low-noise page chrome for core workbench screens.

Keep page-level routes lazy-loaded for bundle optimization.
Treat webpack output cleaning conservatively on Windows.
Avoid new lint errors.

See [README.md](README.md) for quick start and project structure.
