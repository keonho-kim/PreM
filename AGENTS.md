# PreM Development Rules

These rules apply to the entire PreM repository. Keep this file in English only. Communicate with the user in their language; Korean product copy is expected.

This file was adapted from a copy of `/Users/khkim/dev/m.e.ca/AGENTS.md`, as requested by the user. That reference project is a separate asset. Read or copy that one reference file only when requested. Never edit, format, generate files in, run project commands in, or otherwise modify that project. PreM does not inherit its Go, Astryx, Bun, release, or Git workflows.

## 1. Product and scope

- Use **PreM** consistently for the project, product, executable, UI, and documentation. The expanded name belongs only in the root README. Release tags use `vYYYYMMDD`; ship native macOS arm64 and Linux arm64/amd64 bundles with local tools and OCR models.
- PreM is a tool for our team within the same company, not a commercial product, customer-distributed solution or public SaaS. Choose dependencies for internal utility, local/offline operation, integration effort and maintenance. Do not impose hypothetical customer redistribution or proprietary-product licensing requirements on current work.
- Keep [dev-docs/README.md](dev-docs/README.md) aligned with implemented behavior. Exclude change histories, design-generation prompts, and agent instructions from these engineering documents. Distinguish working code, simulations, and operational acceptance gaps.
- Read [blueprint/README.md](blueprint/README.md) for the product and architecture contract. Keep the blueprint collection at **ten files or fewer**. Update the owning document instead of adding overlapping specifications.
- Build an enterprise document analysis and editable presentation platform, rather than an RFP-specific application.
- The production stack is Rust, Axum, Tokio, SQLite, refinery, and React with TypeScript and shadcn/ui. Keep one Rust application and one deployment unit, with the frontend embedded for release.
- The current priority is production implementation in paired backend/frontend feature slices. Use the existing mock as the interaction and design reference; do not mistake mock behavior for production functionality.
- The authorized GitHub repository is `https://github.com/keonho-kim/PreM`, with `main` as the primary branch. Commit and push when requested; do not change repository visibility, rewrite remote history, or add Git/release automation without an explicit request. Keep application data, credentials, installed runtimes, build output and disposable QA artifacts out of Git. Preserve dependency manifests and lockfiles needed to reproduce the source build.

### Paired feature delivery

- PreM has no general user login or project ownership layer. Every visitor sees the same project directory and can use shared project operations. Admin is the explicitly authorized exception: require the random token printed by the server at startup for both its UI and all Admin APIs. Do not extend this gate into accounts, per-user roles or project access rules. Deployment network restrictions remain infrastructure responsibilities.
- Develop one usable vertical feature at a time: define its contract, implement its Rust domain/storage/API, connect its real React UI, then validate the end-to-end behavior before starting the next feature. Do not complete the entire backend first or ship an API-only/mock-only slice as a completed product feature.
- Every feature owns its persistence and API error rules together with loading, empty, error, success, cancellation and retry behavior in the UI where applicable. Shared writes need explicit idempotency or optimistic concurrency rules, not silent last-write-wins.
- Include relevant domain/storage/HTTP tests, frontend behavior tests, and a real-server browser journey. Persistent features must survive restart. Verify independent browser contexts observe shared data; never seed real application storage with QA data.
- Update the owning dev-docs and blueprint documents in the same slice. State exactly which user flow works and which follow-on capabilities remain unimplemented. Keep all production data under the configured application storage root and QA data under tests/.artifacts/.

## 2. Priorities and principles

Resolve tradeoffs in this order: correctness and privacy, simplicity, clear ownership, readability, debuggability, architectural integrity, then consistency.

| Principle           | Required behavior                                                                                     |
| ------------------- | ----------------------------------------------------------------------------------------------------- |
| YAGNI               | Every option, type, state, module, and dependency serves a current requirement and a real consumer.   |
| KISS                | Prefer functions, plain data, and explicit control flow over frameworks and speculative abstractions. |
| SRP                 | Give each file and module a cohesive responsibility and a clear reason to change.                     |
| DRY                 | Give stable domain rules, defaults, and design tokens one owner; share them for actual consumers.     |
| DIP and ISP         | Introduce narrow consumer-owned contracts at actual I/O, tool, or provider boundaries.                |
| Information hiding  | Export only direct collaborators' needs; avoid generic layers and pass-through facades.               |
| Parse at boundaries | Convert untrusted input into unambiguous values; fail early with actionable errors.                   |
| Explicit ownership  | Make mutation, persistence, cancellation, failure, and cleanup visible.                               |
| Code health         | Remove dead code and duplicate rules within the changed responsibility; preserve unrelated work.      |

Prefer standard language features and existing dependencies. For production UI components, use the shadcn/ui-first policy below; native browser semantics remain an accessibility requirement, not a reason to bypass the component system. Use precise domain names and comments about intent or constraints. Write readable failure paths for developers with less than three years of experience.

## 3. Review before editing

Inspect affected source, callers, contracts, related tests, and the intended owner before editing. Briefly state the behavior, file ownership, collaborators, side effects, expected split, and relevant validation in the work update. Use one review for a cohesive change; mechanical moves and documentation need only a scope and reference check.

Start with a function or simple module. Add adapters for concrete I/O boundaries, interfaces for actual substitution needs, and workflow machinery only for implemented requirements. Implement, verify, and simplify.

Never treat a scaffold or mock as proof that planned backend capabilities are implemented. Keep completed behavior distinct from specifications and simulations.

## 4. Source and artifact ownership

All paths below are relative to **this repository root**. `./data/` never means the filesystem root `/data`.

| Location                   | Responsibility                                                                                |
| -------------------------- | --------------------------------------------------------------------------------------------- |
| `AGENTS.md`                | English repository development rules                                                          |
| `design/`                  | Canonical Folio token source                                                                  |
| `dev-docs/`                | Current implementation, development, verification, and operational readiness documentation    |
| `blueprint/`               | Product, architecture, API, data, workflow, UI, and operations requirements                   |
| `backend/src/app/`         | Current application startup, composition, shutdown, and configuration                         |
| `backend/src/adapters/`    | Current HTTP, SQLite and filesystem implementations                                           |
| `backend/src/modules/`     | Implemented feature domains and consumer-owned persistence ports                              |
| `backend/src/domain/`      | Project, document, guide, outline, library, presentation, and slide decisions                 |
| `backend/src/database/`    | SQLite connections, models, and repositories                                                  |
| `backend/src/workflows/`   | Durable execution, scheduling, node state, checkpoints, and recovery                          |
| `backend/src/llm/`         | Provider gateway, routing, configuration versions, and protocol adapters                      |
| `backend/src/tools/`       | Explicit external-process adapters                                                            |
| `backend/src/storage/`     | Blob and artifact ownership, paths, and library storage                                       |
| `backend/migrations/`      | Embedded, append-only refinery migrations once implemented                                    |
| `frontend/src/`            | Production React app, feature UI, state, and API integration                                  |
| `mock/`                    | Standalone HTML, CSS, and JavaScript prototype and local assets                               |
| `mock/helpers/`            | Mock development tools: Swift, Node, Python, capture scripts, test fixtures, and QA helpers   |
| `mock/helpers/.artifacts/` | Disposable browser profiles, compiler caches, temporary files, QA reports, and test downloads |
| `mock/captures/`           | All UI screenshot images, contact sheets, and capture indexes                                 |
| `mock/captures/archive/`   | Clearly labeled historical screenshots, including the retired dark mock                       |
| `data/`                    | Application-owned runtime data only                                                           |
| `runtime/`                 | Packaged runtime tools and models; no development-tool installations                          |
| `scripts/`                 | Product development, build, quality, packaging, and smoke entry points                        |
| `tests/`                   | Product fixtures and suites; disposable product test output belongs in `tests/.artifacts/`    |

### Approved source architecture

[Production source architecture](blueprint/02-system-architecture.md) owns the redesigned module boundaries and the current-to-target migration map. The table above describes current scaffold locations; the target below is not a claim that those modules are already implemented.

- Keep one deployment, one Rust product package, and one SQLite database until a real consumer or measured boundary justifies extraction.
- The backend target is `app/`, `modules/<feature>/`, `workflows/{engine,nodes,definitions}/`, `adapters/{http,sqlite,filesystem,llm,processes,search}/`, and minimal shared `contracts/`.
- `app/` is the composition root and owns startup, wiring, cancellation, and shutdown. It may depend on concrete implementations; feature rules may not.
- Each feature owns its domain rules, commands, queries, errors, and consumer-owned I/O ports. Keep domain, SQL rows, HTTP DTOs, Provider messages, and view models distinct.
- Expose a small facade from each feature's `mod.rs`. Keep implementation modules private; use `pub(crate)` or narrower visibility for internal collaborators. Do not expose every module from `lib.rs`.
- HTTP handlers and Workflow Nodes parse or adapt input and call feature use cases. They do not duplicate business rules or perform arbitrary writes to feature tables.
- Adapters implement the consuming feature's ports. Do not inject a raw database connection, a full application state, a service locator, or an entire registry into a feature.
- Enforce an acyclic dependency direction. Cross-feature work uses explicit facades or application/workflow orchestration; never import another feature's private implementation.
- Assets owns Blob registrations and Artifact metadata; documents owns extractions and blocks; guides owns guide revisions; outlines owns outline and mapping revisions; presentations owns Deck and Slide revision commits; model_registry owns Provider/model/routing versions; inference owns generation policy and tool authorization; decisions owns typed decision contracts and validation; model_execution owns shared model-call lifecycle and llm_requests. Follow the complete ownership table in the architecture document.
- Keep one write owner per table. A use case that atomically updates several owners uses a narrowly defined commit port implemented by SQLite. Queries may join canonical data without becoming additional write owners.
- Preserve short database transactions, immutable inputs, project scope, idempotency, and conditional revision commits. Publish events from committed workflow history.
- Workflow engine code owns generic execution and persistence contracts; Nodes call feature facades; versioned definitions connect them. Reject expired leases and stale outputs at commit.
- Distinguish retryable execution from exactly-once side effects. Inspect uncertain external results before replaying them.
- Use an owned thread for a long-lived synchronous SQLite writer. Bound short blocking work, and supervise external processes explicitly; aborting an already running blocking task is not a process cancellation strategy.
- The frontend target is `app -> pages -> features -> shared`; downward imports may skip a layer without forwarding wrappers. Feature `index.ts` files define public entry points. Do not deep-import peer implementations or move business data into generic UI/shared folders.
- Keep remote state in Query, URL state in Router, and drafts and editing transitions in the owning feature. Scope caches and edit sessions by project, resource, revision, and relevant filters.
- The mock target separates core Store/routing/lifetime, feature read models and commands, sample services, and UI adapters. Views must not mutate canonical state, and feature factories must receive narrow capabilities rather than the entire mutable context.
- Keep direct file opening and classic deferred registration in the mock. Do not add a framework or production API coupling to enforce the target layout.
- Create target folders, ports, and abstractions when implementing their first real use case. Migrate one cohesive slice, update its callers and checks, and remove the superseded owner in the same change. Do not multiply empty directories or bulk-rearrange the scaffold to imitate a finished architecture.

### Shared design source

- `design/refract.tokens.json` is the single source for the service's colors, signature, paper surfaces, contrast roles, and accessibility overrides. The historical filename does not imply the retired Refract appearance.
- `scripts/generate-design-tokens.mjs` generates `mock/theme.generated.css` and `frontend/src/app/styles/theme.generated.css`. Run `pnpm tokens` after changing the source; never hand-edit generated output.
- `pnpm tokens:check` belongs to quality and build verification. Runtime startup never invokes the generator, downloads packages, or reads development tooling.
- Runtime font loading, layout, component bindings, and interaction state remain with their actual UI owner. Shared production build tooling belongs in `scripts/`; mock-only tooling belongs in `mock/helpers/`.

### Application data

- The development default is `<repository-root>/data/`, resolved to an absolute path when starting the backend. Optional development instances use named subdirectories under this root.
- Only application-owned databases, uploaded documents, blobs, artifacts, project workspaces, configuration and keys, libraries, work files, logs, backups, and runtime temporary files belong in `data/`.
- Do not store screenshots, contact sheets, helper source, mock fixtures, browser profiles, QA reports, test downloads, compiler caches, design notes, or copied reference documents there.
- Write mock helper source to `mock/helpers/` and screenshot output to `mock/captures/`. Keep disposable helper runtime files under `mock/helpers/.artifacts/` and clean them after verification.
- Preserve actual application data during cleanup. Move only positively identified development artifacts and update callers and documentation. Do not silently redirect an invalid application storage path.

## 5. Mandatory UI reference: Modern Web Guidance

Begin every UI task with the installed [Modern Web Guidance skill](/Users/khkim/.codex/skills/modern-web-guidance/SKILL.md), before design planning or implementation, including small refinements.

1. Read its current runner and skill-version instructions. Search relevant capabilities with focused generic two-to-five-word queries, then retrieve matching guides. Rephrase weak searches as instructed.
2. Apply relevant guidance through the design system. Check browser support and required fallbacks. The user's explicit constraints take precedence over generic recommendations.
3. Revisit the retrieved guides after implementation. Verify rendered behavior, accessibility, contrast, keyboard use, responsiveness, and fallbacks. Report guides applied, actual checks, and unresolved gaps.

Do not run a broad legacy scan unless the user asks for a broad modernization or legacy-pattern audit. If the skill or runner is unavailable, state the concrete limitation and continue with available primary documentation without claiming compliance.

### Design contract

- Use the **light-only Folio** system documented in [design.md](design.md), adapted from Hallmark **Furrow** for a document editing workspace. The user authorized a complete designer-led reset; this supersedes Refract, Bellwater Lido, bathhouse tiles, glass, pink rose, violet, and Dusk directions.
- Use `color-scheme: light` and a matching meta tag. Do not add a dark variant, a theme switch, or automatic OS dark mode. Respect forced colors and reduced motion.
- Keep the workspace near-neutral paper (`#F6F5F2`), content surfaces opaque (`#FFFEFA`), and ink charcoal (`#262824`). Tangerine (`#F58254`) with dark ink marks primary commands; darker annotation ink (`#9C3D1E`) marks links, focus and selected evidence.
- Keep one primary command recipe. Secondary buttons use paper and quiet boundaries; text actions stay unboxed. Do not spread the accent across backgrounds or every status.
- Use whitespace, ruled rows and neutral work wells to separate tasks. Reserve soft neutral shadows for document/slide papers and dialogs. Avoid floating cards around every section, nested cards and decorative icon tiles.
- Do not restore tiles, water effects, glass, backdrop blur, colored shadows, glows, grain or decorative page backgrounds.
- Use local Red Hat Display and Red Hat Text fonts with their licenses and Korean system fallbacks. Interface labels remain the body face; headings use a restrained size and weight hierarchy.
- Preserve original document and slide colors inside opaque content planes. Keep slide-specific tokens independent of app chrome so theme changes do not recolor source content.
- Measure text against each actual paper and work-well surface. Keep text at least 4.5:1 and essential boundaries, icons and focus at least 3:1. Restore system-color borders in forced-colors mode.
- Keep one sticky global navigation: **Home**, **Studio**, **Space**, and **Admin** when its production feature is implemented; production navigation has no user-role gate. Home owns project discovery; Studio owns presentation creation; Space owns shared template/reference assets; Admin owns model and system settings. Keep one semantic link tree across screen sizes, with visible current-page/focus indicators. Do not add a global left sidebar; Admin has its own collapsible local side navigation.
- Place the project switcher and review stepper inside Studio, below global navigation. Keep the stepper visible while scrolling in every Studio stage, with all six compact markers visible on phones. Render the stepper as connected circular timeline markers with labels beneath, never boxed step cards. Mark the current step with a ring/underline and completed steps with checks; emphasize a connecting segment only when both adjacent steps are complete. Steps are source registration, guide, outline/content, evidence, template, and generation/editing. Visiting a step does not complete it; explicit confirmations refer to saved input versions and become stale after changes. Do not advance past unsaved guide edits.
- Project creation or source upload opens Studio's source step. Space uploads remain separate from project originals and must not silently register material in a project.
- Production Space uses shadcn/ui Progress with accessible labels and text for processing, pause, cancellation and completion; the framework-free mock may use native progress bars; it does not use Studio's review stepper. Keep simulation timers owned and cancellable on reset/page exit. Unknown real progress must not receive a fabricated percentage.
- Account previews in the mock are in-memory UI roles, not authentication or a security boundary. Hide Admin and reject its mock route for member previews. These mock role previews do not carry into production. The product has no general user login or per-user role layer. The explicitly requested CLI-token Admin gate is separate from these mock previews; further access-control changes require an explicit requirement.
- Guide authoring uses optional Do/Don't fields. Preserve legacy revisions; saving must not regenerate prior results. Space search uses news-style rows with a thumbnail, title, excerpt and literal query highlights. Studio evidence uses a compact candidate list beside a dedicated source/comparison reader; do not expand full source bodies inside every result row. The editor Reference tab uses visual cards scoped to the current slide. Keep preview and selection separate; pin selected image/chart/whole-slide source versions into generation plans. Real extraction and native PPTX insertion remain unimplemented in the mock.
- Let each route own its task layout: document-page gallery, wide guide form with revision disclosure below, horizontal outline selection above content/evidence panes, canvas with a left vertical slide thumbnail list and a right task inspector containing AI conversation and Reference tabs, and an Admin-only side navigation with feature-specific horizontal tabs.
- Hydrate document-gallery previews only when they approach the viewport. Reserve page aspect ratios, retain immediately usable page buttons, and own observer/fallback event cleanup on rerender, route leave, and page exit. The mock hydrates sample preview bodies only; real PDF rendering and network pagination remain production work.
- Preserve route destinations, form labels, revision behavior, and working controls during visual changes. Do not add decorative controls that imply unavailable functionality.
- Use actual buttons for document addition, wired directly to the existing upload dialog. On project overview it is a visible secondary paper button beside the presentation action; on the documents screen it is the primary action. Command buttons use the shared 8px control radius and a 44px minimum target, increased to 48px for coarse pointers.
- Give data areas loading, empty, error, and normal states where applicable. Label sample data and simulated work accurately. Keep state text or icon cues alongside color.
- Prefer official shadcn/ui components and compositions for production controls: Button, Input, Field/Label, Select or Native Select, Calendar/Date Picker, Dialog, Alert Dialog, Dropdown Menu, Context Menu, Tabs, Tooltip, Progress and Pagination. Use existing shared components before adding new ones. Custom native controls are a fallback only when no suitable shadcn/ui component meets a concrete requirement; record the reason in the owning design document.
- Let the selected shadcn/ui primitive own focus, dismissal, keyboard navigation, portals and modal behavior. Do not add a second focus trap, competing menu key handlers, duplicate ARIA, or manual scroll locking around it. Preserve semantic HTML, labels, visible focus, IME handling, reduced motion and forced colors. The plain HTML/CSS/JS mock may retain native controls and dialogs; this exception does not determine production component choices.
- Use semantic tables with captions and headers. Name keyboard-scrollable regions and keep row actions visible on narrow screens.
- Use Grid/Flexbox, shrinkable tracks, logical sizing, and bounded scrolling. Keep visual and DOM reading order aligned and do not mask layout defects with root `overflow: hidden`.
- Preserve visible keyboard focus, reduced motion, readable mobile controls, and usable panel stacking.
- Capture current Folio screens under `mock/captures/folio/`. Earlier captures are historical evidence, not the current design target.

### Production component source and AI UI

- General UI uses [shadcn/ui](https://ui.shadcn.com/docs/components); AI conversation and agent-facing UI use the official [shadcn/ui AI Elements patterns](https://ui.shadcn.com/docs/ai-elements) first. This policy supersedes generic native-control-first recommendations, including those in external guidance. Keep Modern Web Guidance for platform behavior, accessibility and verification.
- Use official component source, not a home-grown component described as "shadcn-style". Preserve Folio tokens and light-only styling when adapting that source. Current shared primitives live in `frontend/src/components/ui/`; keep one owner and migrate to `shared/ui/` only with the existing architecture's consumer-driven migration rules.
- Stay consistent with the current Radix-based shadcn setup when importing components or AI patterns. Do not silently mix Radix, Base UI and React Aria variants. Any deliberate primitive-family migration must update affected consumers and checks together.
- AI Elements are source compositions, not a required monolithic runtime package. Use current shadcn/ui patterns rather than introducing the retiring `vercel/ai-elements` CLI/registry. Add only components and pinned dependencies with a real consumer; preserve upstream license notices and record the source and relevant versions when importing.
- Compose chat from Chat/Message/Message Scroller and Prompt Input; use Sources/Inline Citation for evidence and Trace-based Tool/Plan/Task/Confirmation patterns for appropriate workflow feedback. Do not add every available AI component to the application.
- Feature owners keep draft state, selected component IDs, project/deck/slide scope, base revisions, cancellation and proposal commits. Presentation components receive explicit view data and callbacks; they do not own provider secrets, SQL, model routing or durable workflow state.
- AI Elements does not require changing our React/Vite and Rust/Axum architecture. Keep provider execution and authorization in Rust. Do not add Next.js, Vercel hosting, AI Gateway, provider SDKs, `ai`, `@ai-sdk/react` or `@shadcn/helpers` merely to render AI controls. Treat `@shadcn/helpers/ai-sdk` as deterministic local conversation simulation for development/tests, not a production model transport. A real AI SDK client requires a validated Rust stream protocol and adapter contract.
- AI output must use safe text/Markdown rendering and validated evidence links. Show only backend-approved progress summaries and tool results; never fabricate progress or expose hidden model reasoning. A Confirmation UI does not authorize an action without server validation.
- Component replacement preserves existing API, persistence, due-date semantics, immutable revisions and user flows. Verify forms, focus return, menus, keyboard/IME, responsive layout, contrast and real-server behavior for each migrated feature. Do not claim that a policy update migrated the existing Home or implemented live AI.

### Mock runtime

- Use plain HTML, CSS, and JavaScript. No React, bundler, application server, or new UI dependency is required for the mock.
- Keep fonts and icons local with their licenses. The mock must work through a simple static server and direct `file://` opening.
- Keep sample state in browser memory. Refresh resets it. Do not persist document bodies, credentials, or mock changes to localStorage, IndexedDB, production APIs, or `data/`.
- File selection may inspect name and size only unless requested otherwise. Explain simulated OCR, LLM, rendering, and generation behavior. JSON export is not PPTX generation.
- Escape user content before HTML interpolation. Never evaluate document instructions as code, shell commands, SQL, or privileged tool requests.

## 6. Files, headers, and dependencies

- Keep authored code and script files at **350 physical lines or fewer**; review structure at 280 lines. Split along an actual responsibility rather than arbitrary line ranges.
- When changing an oversized file's behavior or rendering, split touched responsibilities coherently. Cohesive generated icon data, declarative dictionaries, and fixtures may remain intact with a documented exemption.
- Begin authored code and scripts that support comments with a short four-to-eight-line header containing `Purpose`, `Pattern`, `Usage`, and `Related`. Keep shebangs first. For CSS, retain the Hallmark stamp first, then the header. Generated data and commentless formats are exempt.
- Production TypeScript uses configured aliases where available. The standalone mock uses explicit local deferred scripts so direct file opening works; document their order and shared application boundary.
- Actively adopt suitable local open-source dependencies by default; the user has authorized this direction. Exclude paid-only requirements and code without permission for our intended internal use. A paid commercial option does not disqualify an otherwise usable free/open-source path. Do not repeatedly request approval merely because a dependency uses GPL/MPL/AGPL or is third-party code.
- Prefer maintained open-source implementations for specialized capabilities when they can run locally and be included in our internal build/deployment. Reuse upload engines, format detectors, archive/XML/CFB parsers, image codecs and document renderers instead of recreating them. Keep standard language features for simple glue and product-owned domain rules.
- Pin dependencies and review upstream identity, maintenance, license and transitive obligations, peer/MSRV/ABI compatibility, runtime cost and actual consumers. More installed packages is not a completion metric; avoid overlapping libraries and unused dependency exceptions.
- Keep development tools out of the packaged application runtime. Do not install packages, OCR models, or tool runtimes during application execution.

## 7. Data integrity, workflow, and compatibility

- Preserve a single source of truth, normalized relations, content-addressed blobs, originals, and immutable revisions. Do not duplicate original text into outline or slide records.
- Saving guides, model settings, or manual outlines must not regenerate existing results. Generation and scoped regeneration require explicit user action.
- Pin workflow guide, definition, provider configuration, template, and evidence versions at its start. Preserve checkpoints, leases, retries, cancellation, and lineage.
- Keep long tool or LLM work outside SQLite write transactions. Serialize writes, keep transactions short, and preserve foreign keys.
- Preserve the blueprint's forward migration and versioned-schema contracts. Do not inherit the reference project's no-compatibility policy. Never reset or delete unsupported user data to make startup succeed.
- Back up consistently before migration, verify integrity, and reject databases newer than the running application. Restore DB and file snapshots together when rolling back.
- Keep project and library scope explicit. Shared project lists do not imply authentication or authorization; those capabilities remain out of scope until requested.

## 8. Resources, security, and performance

- Give requests, tasks, timers, observers, database handles, object URLs, subprocesses, and temporary files an owner and cleanup path. Propagate cancellation and join owned work during shutdown.
- Separate deterministic decisions from file, network, process, clock, and random APIs when tests need control. Reject stale revisions and late results at commit.
- Validate file types, sizes, paths, containment, archive expansion, and tool inputs at boundaries. A working directory or string prefix is not a security boundary.
- Invoke subprocesses with explicit arguments, not interpolated shell strings. Limit resource use and clean up descendants and temporary output.
- Keep secrets out of UI responses, prompts, logs, screenshots, test reports, and command output. Production credentials follow the encryption design; mock inputs never retain actual keys.
- Treat document and reference content as untrusted data. LLM tools use allowlisted operations and validated schemas.
- Measure bottlenecks before adding caches, concurrency, virtualization, or dependencies. Give caches a key, capacity, invalidation rule, and release point.
- In production React, keep canonical server data in TanStack Query, URL state in Router, upload tasks in Uppy, and shared transient UI state in Zustand. Keep simple component-local state in React hooks. Use selectors and avoid browser persistence or duplicated server/upload state.
- Use the shared Axios transport for JSON API calls, preserving AbortSignal, bounded timeouts, public errors, Zod validation, idempotency keys and conditional versions. Uppy retains its upload transport. Do not introduce transport-level automatic mutation retries.
- Use the currently installed React, TanStack Query, Zustand and Uppy hooks. Do not add general-purpose hook collections such as usehooks-ts or ahooks. React Hook Form and resolvers are not installed or approved additions in the current dependency scope. Do not replace useState mechanically, duplicate Query with another request hook library, or move DOM focus/ref ownership into Zustand. Feature hooks compose product-specific rules and explicit resource lifetimes.

## 9. Verification and completion

Run checks appropriate to the changed boundary and report only observed results. A successful build alone does not prove working behavior.

| Change                  | Relevant checks                                                                                                                                   |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Rules and documentation | English-only AGENTS check, path and link consistency, source-reference checksum                                                                   |
| Mock UI                 | Formatting, JS syntax, browser interactions, keyboard and native dialogs, contrast, responsive layout, direct file opening, and fresh screenshots |
| Rust                    | Formatting, relevant tests, and Clippy with the project's configured options                                                                      |
| Production frontend     | Existing lint, type checks, relevant tests, and frontend build                                                                                    |
| Shared design           | `pnpm tokens:check`, both UI builds, composite contrast and fallback checks                                                                       |
| Shared build or runtime | `pnpm check`, `pnpm build`, and the relevant smoke path                                                                                           |

- Reuse project commands rather than inventing parallel quality workflows. Keep meaningful mock QA and capture helpers in `mock/helpers/`.
- Test observable behavior and important failure paths. Avoid tests that mirror implementation or unrelated expansion for mechanical changes.
- Compare identical inputs and environments for performance claims. Distinguish build success, browser coverage, simulations, and unverified platforms.
- After relevant checks pass, repeat them only for new edits, failures, or unresolved concerns.
- Update the owning blueprint or README when behavior, design, or artifact locations change. Preserve the ten-file blueprint limit.
- Preserve unrelated work and external assets. Do not publish, deploy, message others, initialize Git, or create release automation as a side effect of a design task.
- Finish with concrete changes, actual verification, current preview or artifact links, and material limitations. Keep completed work distinct from proposals.

- The editor right inspector is a task panel, not global navigation. Preserve chat drafts when switching tabs. Scope Reference candidates and selections by project, deck and slide; selections create new slide revisions. Never invent sample semantic relevance percentages.

- In the editor, use a left slide list, central canvas and right AI/Reference inspector. The slide list is local content navigation, not a global sidebar. Use DOM order matching this arrangement. Keep the list scrollable and reveal the selected slide vertically. On phones it becomes a horizontal strip above the canvas; the inspector stacks below. Keep Studio progress visible in every stage, including generation/editing. Use a compact sticky timeline below global navigation; never put it in a collapsed disclosure. Measure its reserved height so source readers and focused controls remain unobscured.

- Editor slide-list and AI/Reference panels must collapse independently using always-visible buttons outside the panels. Keep aria-expanded and aria-controls synchronized with native hidden state. Preserve the panel DOM, draft and selected tab; visibility is session-only UI state. The canvas uses released space, including when both panels are collapsed.

- Prefer local Lucide icon buttons for repeated secondary editor commands; preserve visible labels for primary workflows and selection choices. Every icon-only control needs an accessible name, title and visible keyboard focus.
- Slide insertion belongs in the left list header. Slide context menus provide duplicate/delete and accessible movement alternatives. Gaps and empty list space expose insertion markers; pointer dragging commits once on drop and Escape cancels.
- The mock now supports plain-text canvas edits, text boxes, local images, a rectangle, geometry changes, basic object-level text formatting, layer order, zoom and bounded undo/redo. Do not claim complete PowerPoint/Keynote parity or native PPTX compatibility.
- Explicit image insertion may read PNG/JPEG/WebP contents into browser memory only, at most 2 MiB and 16 million pixels per image. Other document/Space uploads remain metadata-only. Reject stale image completion after navigation or revision changes; do not fetch external image URLs. Mock JSON export includes inserted image data and geometry.
- Undo/redo restores content as new immutable revisions; never decrement version counters or remove historical revisions. Keep draft text when another canvas command commits. Generated local icon dictionaries in icons.js and editor-icons.js share the existing Lucide license and are exempt from authored-code line limits.

- Keep the AI tab as a conversation with inline proposals and a bottom composer; properties belong to the canvas toolbar and source evidence to Reference. Ctrl/Command-click toggles multiple editable components. Chat requests pin selection keys, slide identity and the deck revision; selection changes never retarget existing proposals. Reject stale proposals and preserve unselected components.
- Keep chat messages and drafts isolated per deck and slide in memory. Enter sends and Shift+Enter inserts a line; guard IME composition, including the Safari keyCode 229 fallback. Clearly label deterministic sample responses. Multi-selection currently scopes chat edits; do not claim group transforms or multi-object toolbar operations.

- Keep dependency versions and enabled features owned by manifests and lockfiles. Use dev-docs/08-dependencies.md for installed foundations and deferred candidates. Verify refinery/rusqlite share a native SQLite driver; keep JSON Schema remote/file retrieval disabled. Package availability is not feature completion.

- Use Biome for JS/TS/JSX/TSX/JSON/CSS formatting and production React/Node linting; TypeScript owns type checking and Knip owns dependency usage checks. Prettier is scoped to Markdown/HTML/YAML only. Keep these formatter scopes disjoint and preserve browser QA for behavior and accessibility.
- Use official React Developer Tools browser extensions for Components/Profiler inspection of the React app. Do not add standalone DevTools or debug script injection as implicit dependencies. The vanilla mock is not a React profiling target.

- React Compiler is explicitly enabled for the production frontend through the official Vite reactCompilerPreset targeting React 19. Keep compiler packages as development dependencies and use React's built-in compiler runtime. Preserve source-level tests and verify compiled behavior separately; do not infer measured performance gains from successful compilation.

- Pin development CLI versions in scripts/dev-tools.json. pnpm tools:install is the explicit setup boundary; application startup never installs tools. Keep cargo-machete free of speculative ignore entries and connect dependencies only when a product or test consumer exists.
- pnpm check includes nextest, Cargo doctests, cargo-deny and npm advisory checks. Keep duplicate dependency warnings visible; do not silence advisories to obtain a passing result. Coverage is a separate report command with outputs under tests/.artifacts/coverage, not application data. Use the pinned rustup compiler and matching LLVM tools for Rust coverage.

- Mock Home uses a three-column project card gallery on desktop, two columns at intermediate widths and one on phones, with six projects per page. Cards show status, document/deck counts, guide revision, end date, D-Day and last update; primary navigation links and overflow actions remain separate controls.
- Project registration in the mock requires a native calendar end-date input. Store it as a date-only YYYY-MM-DD value, calculate D-Day by calendar days and keep card dates read-only. Date-range filters use end dates inclusively and reset pagination. These mock fields do not imply production API/schema support.
- Project right-click and overflow menus share stable-ID commands, keyboard access and lifecycle cleanup. Confirm deletion, cancel only the removed project's sample work and preserve the empty-gallery creation path.

- Mock Home exposes project creation as a labeled header command and in background/card context menus. Reuse the existing required end-date registration form and preserve native context menus on inputs and unrelated controls.

- Production Home uses the approved three/two/one-column gallery with six records per server page, a labeled header creation command, and card/background context menus. Keep committed filters and pagination in the URL; keep unsaved form values local to their dialog.
- Require a calendar end date when creating a production project. Preserve legacy null dates and display them as unspecified. Store date-only values without timezone conversion. Use version-checked lifecycle commands and preserve logical deletion tombstones and creation receipts.
- Production project-information copying currently creates an empty project from a reviewed name and deadline. Do not imply document, guide or presentation duplication, or show fabricated resource counts and thumbnails before those features are implemented.

- A production project has one date-only `due_date`, labeled with the Korean term for due date. Do not model it as project start/end dates. Home uses one calendar date filter. Preserve previous values with append-only migrations; keep legacy aliases at the HTTP compatibility boundary only.
- Reserve the bottom-right viewport area for persistent work progress and brief notifications. Project creation belongs in the Home header; do not restore a floating creation button that competes with the work panel.

- Production Home now consumes the official shadcn/ui new-york registry source. Preserve `frontend/components.sources.json` and `frontend/THIRD_PARTY_NOTICES.md` when updating imported components. Keep Folio adaptations and remove unused exports rather than adding Knip exclusions.
- Home uses Radix Dialog/Alert Dialog and Context Menu/Dropdown Menu. Do not restore the removed native popover/focusgroup/coordinate menu implementation or jsdom dialog-method stubs. Keep the feature-owned command target and explicit return-focus path; let Radix own focus scopes and menu navigation.
- The project date picker composes shadcn Input, Popover and Calendar. Keep the API date-only string canonical, use an explicit UTC DayPicker boundary, and derive the initial today from the user's local calendar date. Preserve 1900–9999 validation, calendar selection and text editing.

- Space dependency selection is owned by `dev-docs/08-dependencies.md`. Use Uppy Core/React hooks/XHR as the selected local upload-engine candidate behind shadcn controls. Do not introduce Transloadit services, Companion, remote sources, browser file persistence or a second upload queue by default. Byte-resumable uploads require a real server protocol; XHR retries are not resumability.
- Keep OSS mechanisms behind consumer-owned adapters. PreM still owns format/size acceptance, project scope, immutable versions, idempotency, short transactions, resource limits and recovery. Dependency-provided parsing or progress does not prove safety, durable completion or correct authorization.
- Separate Rust-compiled libraries, Vite-bundled browser modules, packaged local tool runtimes and development-only generators. Acquisition happens during controlled builds; application startup never runs package managers or downloads models. Record exact versions/commits, checksums, platform/ABI, entry points and license notices in the release manifest.
- Treat upstream project licenses, transitive libraries, model weights and fonts separately. Kordoc and PPT Master have pinned local consumers; H2Orestart remains a candidate. Retain the complete PPT Master source required by its attribution guard and execute only the selected import scripts; its optional PyMuPDF path is eligible for internal use when needed and must not be excluded merely because it is AGPL. Unneeded network-dependent features stay outside the local bundle. Verify every selected Kordoc model is present rather than assuming the offline packing flag includes all optional models.
- Distinguish researched candidates from installed dependencies and tested release assets. Install a candidate with its first real feature consumer and verify it on the target Linux platform; do not claim a manifest/README review proves an offline build or production readiness.

- Do not restrict internal-use dependencies to permissive licenses or require paid commercial licenses solely because this is company work. GPL/MPL/AGPL candidates remain eligible. Preserve license notices and assess the actual integration/use conditions; internal use is not a blanket license exemption. Revisit the assumptions if external distribution, outside users or public service becomes an explicit requirement.

- Use the pinned async-sqlite Client for SQLite worker ownership and bounded asynchronous calls. Retain serialized short transactions and refinery migrations; do not maintain a parallel hand-written thread/channel executor.
- The implemented Space slice uses `modules/assets` for Blob values and storage ports, and `modules/libraries` for the shared Reference/Template registration lifecycle. Keep their tables separate. `LibraryStore.register` is the single atomic commit boundary for Blob metadata, file registration, library version and upload receipt. Documents owns reference extraction, blocks and classification jobs; templates owns template analysis and passive slide previews.
- Uppy owns the production upload queue; TanStack Query owns committed assets. Preserve per-file idempotency keys, server-confirmed cancellation and conditional replacement versions. Never label transfer completion as extraction completion or implement a second upload engine.
- async-sqlite owns asynchronous database access; workflows/engine owns document/template execution supervision. Keep document_jobs canonical, reuse extraction and completed decision batches, and use the existing SQLite checkpoint adapter. Do not restore the retired Apalis runner or install a competing SQLite driver or migration stack.

- Work progress belongs to the initiating browser tab, not a user account. Use the existing Uppy queue in a global bottom-right shadcn Collapsible panel; do not duplicate or broadcast task state. Collapse/close never cancel work; a compact launcher reopens hidden tasks. New uploads reveal the panel without stealing focus. Registered assets remain shared, and refresh clears the in-memory queue.

- Brief notifications use one light-only shadcn Sonner host at bottom-right, above the measured work panel. Defer new toasts during modal input, keep authoritative outcomes in the task panel or inline UI, and avoid enter/exit motion that covers task controls. The standalone mock uses a local native-popover/fixed fallback toast owner with equivalent placement and explicit simulation labels.

- Production Admin uses model_registry for immutable provider settings and model_execution for pinned requests and sanitized history, with separate inference and decisions consumers. Provider adapters use native OpenAI Responses, Claude Messages, Gemini generateContent, LM Studio Chat, llama.cpp completion and SGLang generate; vLLM/LiteLLM use their official OpenAI-compatible interfaces. Routing, streaming, Vision and Tool Calling remain separate work; documents consumes the independent decisions facade. Never silently fall back from a native protocol to a compatible one. Preserve legacy lm_studio config revisions and explicitly create a new revision for native transitions. Do not claim model discovery proves those capabilities.
- Keep API Key plaintext out of provider DTOs and logs. Preserve the original encryption key during migrations and backups; missing or invalid keys must fail startup instead of regenerating credentials. Endpoint changes require explicit key replacement or clearing when an existing key is present.

- Admin owns a local collapsible side menu for implemented model connections and system status. Use semantic links for these destinations and shadcn Tabs for connection settings, tests and request history. Keep section/provider/tab in the URL; do not expose unimplemented routing, workflow or backup screens as working controls. Preserve running test state across detail-tab changes and enable history polling only while that tab is active. Keep one main landmark and one Admin navigation tree across screen sizes.

- Keep shared model-call lifecycle in modules/model_execution, generation/schema handling in inference/execution.rs, decision contracts in modules/decisions and connection-test prompts/assertions in inference/diagnostics.rs. Diagnostic scenarios must call the common execution path; new processing consumers must not bypass concurrency, pinned configuration, cancellation, schema validation or request history.
- ProviderKind and its server descriptor own supported identities, setup defaults and implemented capabilities. Admin consumes the provider-types API instead of maintaining a second catalog. Keep protocol authentication/API-version rules outside the generic HTTP transport, and never pass persistence ciphertext into model adapters.
- Application startup orchestrates incomplete-work recovery through the owning SQLite feature adapters. Generic database initialization must not mutate upload or inference status tables directly. Keep migrations append-only and preserve completed records.

- Admin selects LLM or System One from the server-owned connection catalog. Native decision adapters live in adapters/decisions and never masquerade as generation clients or silently fall back to LLM prompting. Preserve existing connection revisions; category is derived from the saved protocol kind.
- Native decision statistics are provider-reported; LLM choice results have unavailable probabilities, never fabricated confidence. Validate complete question/choice identity and probability distributions before recording success. Document jobs persist their own decision checkpoints and select a connection independently of Admin sample evaluation. Routing remains separate work.
- Keep `vllm_sr_decision` distinct from plain `vllm_decision`. Discover the Router's System One inventory first; only a 404/405 permits the standalone runtime inventory. Preserve authentication/server failures, exclude explicit chat-only capabilities, and serialize state at this provider boundary. Do not install models, register a hosted account, or equate an API fixture with live model validation.

### Space asset previews

- User-facing Space opens visual template previews, not extraction diagnostics. Hide manifests, native structure inventories, model decisions, checkpoints, raw status/error codes and analysis bundle downloads from the shared asset UI. Keep operational details in their owning backend/Admin boundary.
- Template uploads use PPT Master only: preserve editable structure and originals, render passive PNG slide previews, and display selectable thumbnails with a large preview. Do not run reference content classification for templates. Reference uploads identify PPTX template eligibility before content extraction; never silently register them as templates.
- Previews are derived, version-bound Blob assets. Store dimensions and foreign-key references, validate access through the owning extraction, and preserve prior results. Missing old previews require an explicit user request; settings changes do not regenerate them.

### Office-worker audience and user-facing language

- Limit the primary product audience to general office workers preparing and reviewing reports, meeting materials, proposals, training documents and presentations. Do not assume programming, AI operations or data-model knowledge.
- Design task screens around the user's material, expected outcome and next action. Keep the Folio system and existing Home/Studio/Space/Admin destinations; simplify task labels, form inputs and information hierarchy before adding decoration.
- Never expose internal developer terminology, execution graphs, prompts, decision schemas, checkpoints, storage identifiers, raw model responses or implementation diagnostics in normal screens, notifications, dialogs or help. Keep internal architecture and API contracts precise in engineering documentation; map them to consumer-owned presentation models.
- Preserve user-authored/source document contents verbatim where required. The language policy applies to application chrome and authored sample content, not a blanket runtime replacement of uploaded text.
- Show sources, pages, filenames, dates and necessary previous versions when they help people review the result. Put optional history and connection fields behind clearly named disclosures. Admin is a team-settings surface, not a developer console; only genuinely necessary external connection inputs belong there.
- Explain failures with the blocked task, whether work is preserved, and a concrete recovery action. Preserve cancellation, retry, confirmations, immutable history and accessible keyboard behavior when simplifying the interface.
- Keep sample experiences honest with a short, consistent sample notice and action-specific limitations. Do not rename a sample-data export as a PowerPoint download or imply that metadata-only mock uploads were analyzed. Keep QA state controls outside the normal user journey.

### Connection request capacity

- Admin request capacity applies to PreM outbound requests for each LLM/System One connection. Never interpret these controls as authorization to change LM Studio load settings, external inference-engine queues, document worker counts or the SQLite writer queue.
- Model execution owns active/queued admission, cancellation and wait deadlines. Store operational limits independently from immutable model configurations, preserve queued request credentials, and use explicit version conditions for shared edits.
- Shrinking a limit never cancels accepted work. Release reservations on completion, timeout, cancellation and abandoned futures, including cancellation immediately after a queued request is granted. Keep the in-memory request wait queue distinct from durable document jobs.

### Per-model connection editing

- Always expose LLM and Decision tabs, including when either family has no registered model. Select a Provider inside each tab and edit its connection inline; do not restore a standalone add-model button or registration dialog.
- Obtain model choices through native Provider discovery using the entered endpoint and key before saving. Do not require a manually typed model ID or seed an unqueried model as selected. Preserve legacy saved configurations and multiple connections per Provider.
- Do not prefill or display stored endpoints or API keys in connection forms. Empty replacement fields retain saved values; removing a key requires an explicit action. Confirm the target and changed field names before changing an existing configuration.
- Credential-bearing discovery uses POST and no-store responses, with no configuration/history persistence. Bound concurrency, timeout, pagination and response size. Reuse stored credentials only with version and destination validation. Never load/download a model or start inference as a discovery side effect.
- Keep discovery results local to the exact input draft, invalidate them when credentials change, cancel on exit and reject late responses. Do not place keys in URLs, logs, query caches or persistent browser storage. LM Studio discovery filters native model types and prefers loaded instance identifiers.

### Reusable reference materials

- Preserve source slide order, native shape/media locators and immutable file/extraction versions for future presentation reuse. Whole slides, grouped diagrams, charts and images must not be reduced to preview PNGs as their only source.
- Documents owns reference material indexing and native-package references; template uploads retain their separate feature path. Reuse PPT Master process mechanics without automatically registering references as templates.
- Reference text through canonical content_block_id. Bind ordered multi-selection to a specific extraction and reject missing, foreign or deleted material references. UI selection review does not imply generation or insertion is implemented.
- Keep native payloads and development fields out of normal user copy. Distinguish item thumbnails from page-context fallbacks, preserve source dimensions where supported, and require an explicit request to prepare materials for legacy extractions.

- Use Kordoc's existing image-filtering capabilities before inventing image heuristics. Enable dropBlankImages for reference parsing and apply the same pinned implementation to independent native-image candidates. Keep useful tiny icons, preserve original/media bytes, and distinguish uniform-image filtering from dimension-based or semantic filtering. Revalidate the build-time adapter when upgrading Kordoc; never silently bypass an unavailable filter.

### Shared PPT packages and retention

- `modules/ppt_imports` owns immutable source/profile import identities shared by templates and references. Keep role-specific registrations and job histories separate; never repeat a native import merely because the library role differs.
- Store package members as individually hashed Blobs and a sorted versioned manifest. Structure JSON has one canonical package member; new template links must not duplicate it into legacy JSON columns. Preserve old ZIP/JSON readers and never rewrite historical results automatically.
- Bundle IDs identify the stored package manifest for new results, not the bytes of a downloaded ZIP. Authorize the job/package relation before assembling a bounded transient ZIP with fixed ordering, timestamps and permissions. Preserve cancellation and response-lifetime cleanup.
- Run orphan collection only during exclusive startup, before HTTP/workers. Protect every FK reference, retained import, package member and local SQLite backup; require a seven-day first-observation grace period and recheck before removal. Unknown backup layouts, corrupt snapshots and unsafe paths must skip collection. Never purge confirmed revisions as if they were orphan files.

### Studio source delivery

- Keep project originals in project-scoped source registrations and immutable versions, separate from public Space listings. Reuse the registration/upload engine and document pipeline through narrow public facades; do not create public references as a shortcut.
- Source confirmation must bind the current file-version/extraction set. Visiting a step never confirms it, and additions, replacements, removals or changed extraction identities invalidate current completion without deleting historical reviews.
- Studio owns source review state; guides owns optional Do/Don't revisions. Preserve draft input after conflicts, pin the base version, and never regenerate analyses when saving guidance.
- Home creation and project links enter Studio. Keep uploads in the existing tab-local Uppy work panel across route changes. Source-page previews use real passive artifacts with lazy loading and truthful unsupported-preview states.

- On mobile viewports up to 640px, use an edge-attached full-width work dock with safe-area padding, not the desktop floating card. Reserve its measured height in document padding and scroll-padding so final actions remain reachable. Release that reservation when the dock disappears, keep toasts above it, and capture fixed mobile surfaces using viewport screenshots.

### Related business documents

- Treat project originals as general business documents, never as an RFP-only intake. Search other projects without automatically promoting originals into Space.
- Relations owns durable searches, scoped candidate/origin links, immutable assessments and source-selection history. Reuse canonical extractions/blocks and derive project membership from database relationships, never from model guesses.
- Keep native Decision inputs isolated per candidate and evaluate them with bounded concurrency. Batch multiple candidates only on the structured LLM path, within the byte/question limits. Both use the existing pinned execution/admission service and respect connection capacity.
- Pin source versions, guide revision, definition and model configuration. Cache only validated successful decisions; failures are not unrelated results. Resume incomplete work without replaying committed candidates, and reject late writes with leases.
- Source selection is an explicit human action independent from model approval. Preserve selected source versions, CAS and history; model outcomes must not silently remove selections or claim PPT insertion.
- Bound retrieval and disclose partial-context/candidate coverage. Keep one FTS index over canonical content, normalized metadata, paged provenance and lazy previews. Measure query plans/latency and storage growth before adding vectors, graph servers or more caches.
- Change the relation definition identifier when changing predicate semantics or context construction after release. Retained runs must use supported handlers or fail with a compatibility state instead of silently changing their meaning.
- Distinguish model context limits from native-engine micro-batch limits. Do not turn upstream runtime failures into successful decisions or silently change external model load settings.

### Parsing quality scope

- Prioritize representative document extraction quality: missing content, reading order, tables, images and source locations. Compare against independently authored expectations, not parser output relabeled as ground truth.
- Defer live vLLM-SR engine validation for the current parsing-hardening work. Keep its implemented adapter and contract tests; do not install, load or configure an engine as part of this work.
- Delegate PDF vector interpretation to Kordoc; do not add a bespoke vector reconstruction engine. Markdown upload uses the pinned Comrak adapter because Kordoc's `parse()` does not accept Markdown input. Keep CommonMark/GFM parsing in that library, not product-written syntax rules.
- Markdown is passive UTF-8 input: preserve original bytes, canonical block text, source positions and link/image metadata without rendering raw HTML or fetching referenced files. Keep its extraction profile independent of Kordoc. Resolve HTML/Markdown interpretation per immutable registration while sharing identical Blob bytes; do not let the first uploaded extension decide later registrations' semantics.
- Keep synthetic/public regression inputs under tests/fixtures and disposable extraction reports under tests/.artifacts. Inspect user-designated business originals read-only; do not copy them into a distributable fixture set or send them to an external model without explicit authorization.

### Unified Space search

- Global search includes Space references and templates only. Project originals remain excluded, including through direct API queries. Keep Studio's explicit model-assisted relation workflow separate.
- Route global search to the Space home at `/home/space`; keep upload and asset lifecycle operations at `/home/space/library`. Preserve old search/document URLs as internal redirects. Use news-style thumbnail/title/source/excerpt rows with literal match highlighting, URL-owned filters and pagination. Space management retains lifecycle filters rather than another competing text-search form.
- Search result titles open normal `/home/space/documents/:kind/:id` pages pinned to the returned job/page, with a return link preserving query state. Reuse the document-content owner across page and quick-preview frames; do not duplicate provider, upload or revision logic.
- Reuse the existing canonical block FTS index. Search is read-only and must not start model calls or regenerate extraction. Template discovery currently matches filename/title/tags; do not claim full template-body indexing. Keep source markup inert and fetch previews lazily through authorized artifact routes.

### Outline and content authoring

- `modules/outlines` owns immutable presentation outlines, canonical source assignments, confirmation and durable generation. Reuse document/source review, guide and model owners through pinned IDs; never copy original text into outline records.
- Generate or map only on explicit requests. Pin source review, guide revision, model configuration, definition and base outline version. Commit a new head only after all outputs validate and the input/CAS conditions still hold. Failed/cancelled/stale work must not overwrite manual edits.
- Outline generation and content mapping use the common engine with separate compose/publish and map/publish definitions. Keep outline_runs and outline_run_batches canonical; retry only missing batches. Commit the final batch with work-node success and the new outline head with publish-node success atomically. Preserve version checks and never rerun a model for publication-only retry.
- Preserve the two-level ordered hierarchy and stable node identities. Reuse unchanged node versions, allow one source block in multiple sections, and reject foreign or unreviewed source links. Confirmation belongs to a saved revision and becomes stale when source/guide inputs change.
- Keep draft edits when shared data changes and while moving between Studio authoring steps. Guide drafts must be saved before advancing. Show source/model limitations in normal office language; keep provider IDs and diagnostic codes out of authoring UI.
- Adapt Kordoc's separate image array and table spans rather than creating format parsers. Keep originals and old extractions immutable, include helper code in the runtime profile, and require explicit reprocessing for prior results.

### Adaptive relation workspaces

- Preserve Space-only global search. Adaptive exploration requires an explicit Studio search and retains its project, version, format and lifecycle filters.
- Pin Decision and optional planner LLM configurations separately. Native Decision adapters never receive generative planning requests. Keep configured planner failures visible instead of silently substituting another path.
- Store canonical block IDs and exact UTF-8 prefix lengths, not source-text copies. Pin cross-document inputs before evaluating a stage and retain prior immutable assessments.
- Bound candidates, windows, expansion stages and elapsed time. Resume committed work without replay; unknown or conflicting evidence is not a negative relevance result.
- Expose actual source passages and version-bound previews. Dynamic candidate counts do not provide an overall completion percentage. Preserve legacy single-pass runs without automatic regeneration.

### Evidence-stage navigation

- Studio's evidence step owns selected references and additional relationship search. Do not restore a separate past-document search button in the project header. Preserve legacy related-search URLs and run IDs through route normalization.
- Default to selected evidence; opening additional search never starts a model call. Preserve the query draft across these task tabs and use manual tab activation. Evidence/design completion must come from current server-confirmed input versions, never from route visits or output availability alone.
- Keep Space discovery visually distinct: a search-first library home with news-style results and normal document pages. Studio uses a bounded candidate/reader workbench for selection and comparison. Both reuse their existing persistence and version rules.
- Size desktop evidence panes against the dynamic viewport, measured navigation and work-panel reservation. On viewports up to 900px, replace the candidate list with a normal-flow detail view instead of nested scrolling. Preserve search drafts and selections; the return command restores list position and trigger focus. Own and clean up measurement observers and media-query listeners.

### Presentation generation

- Keep manual reference insertion out of the ordinary generation form. Confirmed textual evidence still flows into generation; explicit legacy API material choices remain compatible. The editor Reference tab may insert materials into a current slide. Do not imply that removing this control implements automatic asset discovery or contextual source-slide rewriting.
- The PPT generation UI does not ask office users to choose a model. Resolve the current enabled LLM on the server inside admission and pin its immutable configuration. New decks use initial connection registration order with the connection ID as a tie-breaker, excluding Decision connections; new versions retain their deck connection and fail clearly if it is unavailable. This default is not a claim that configurable task routing exists. Preserve paired explicit model/version fields for legacy API clients and replay accepted receipts before resolving current settings.
- Presentations owns reviewed evidence snapshots, immutable design choices, generation jobs, slide specs/citations and validated output revisions. Reuse canonical outline/source/relation/model identities; never copy source bodies into preparation tables or mutate another feature's tables.
- Use explicit idempotent generation and version-checked commands. Pin model configuration, runtime profile, outline, guide, evidence and template job. Resume completed slide checkpoints, fence late writes with leases, and advance a presentation head only after validation and a current-input check.
- Keep the first generation contract honest: one slide per leaf outline, up to 24; at most 12 primary source excerpts per slide and 40 selected additional references. Show draft content separately from final rendered previews. Preserve earlier results when creating a new version.
- Use PPT Master's native DrawingML exporter for the built-in design, and the pinned python-pptx adapter for existing template masters and title/body layouts. Kordoc independently checks generated text. Do not describe passive previews as editable output or claim arbitrary template fidelity, visual-model validation or arbitrary canvas editing.
- Runtime Python packages live under runtime/python-packages and come from the hash-locked build input. Never install dependencies during startup or generation. Process helpers, temporary output and published Blobs retain their existing ownership and cleanup rules.

### Admin access

- Generate a fresh 256-bit token with the OS CSPRNG for each server instance. Admin General settings may replace the in-memory token using a version-checked, explicitly confirmed command. The change immediately invalidates the old token for Admin only. Never persist the override: every restart resets the sequence to a new CLI random token. Print it once to the startup CLI outside structured logging. Do not put it in the database, source, URLs, screenshots or routine request logs. Operator redirection of startup output must be treated as credential-bearing output.
- Protect the entire `/api/v1/admin` API namespace at the server boundary, including reads, discovery, tests and settings. Use constant-time verifier comparison and bounded invalid-attempt throttling. No query parameter, default token, development bypass or user-agent exception may grant access.
- Keep the verified browser credential in memory for the current Admin visit only. Clear it and sensitive Query/mutation cache entries on lock, route departure, page exit or rejected authorization. Cancel owned verification requests and reject late success after exit. Do not persist it in localStorage, sessionStorage or cookies.
- Keep ordinary Studio authoring available without Admin access through `/api/v1/models/authoring`, which exposes only enabled writing model IDs, names, model identifiers and configuration version numbers. Never reuse protected provider DTOs or caches for public choices.
- Tests authenticate protected feature setup with the actual per-instance token. Dedicated access tests use unmodified routers/fetch and verify unauthorized requests, independent browser contexts, public flows and restart rotation. Never disable the production gate for testing.

- The production presentation workbench follows the mock's left slide list, central paper and right task inspector. Collapse each side independently with always-visible shadcn disclosure triggers, preserve selection/tab state, and let the canvas use released width. The right-panel tabs show real AI conversation, content/notes and references. Keep creation inline in the Studio generation body without a separate settings trigger or disclosure. Put the current workbench before additional creation when output exists; keep generation inputs in one body without AI/manual tabs, and focus the inline form for an explicit new-version command. Put quiet gray Lucide pencil/plus commands beside outline headings; edit names/order or add a child through the version-pinned outline editor. A child starts with its existing branch source IDs; never copy source text or claim that inherited context is a new model assessment.

### Scoped presentation conversation

- Keep before/after comparison and undo beside the central canvas zoom controls, not as chat navigation buttons. Hold comparison shows the previous rendered slide only while pointer/Space/Enter is down; release, cancel, blur, visibility change and scope changes restore the current view. Preload both images and preserve keyboard/touch access.
- Undo has at most three entries per editor visit. Its server-side references are disposable cache, not durable revision history or authentication sessions. Close the cache on editor exit, project/deck changes and pagehide; heartbeat active visits, expire abandoned visits after 30 idle minutes, and clear caches at process startup/shutdown. An in-flight publication must not recreate a closed cache. Never delete confirmed PPTX/slide revisions when clearing undo cache.
- Render and validate proposals before exposing them for canvas review; reuse those artifacts on explicit acceptance. Undo restores a prior immutable deck as a new revision without model calls or duplicate file bytes. Shared-head/version conflicts must not undo another visitor's intervening changes. Keep apply/reject/retry/cancel in the conversation; do not restore chat comparison/result-navigation buttons.

- Keep the editor conversation free of AI and edit-scope selectors. Derive scope from selection: selected objects only, otherwise the current slide, or the explicitly selected batch. Drafts contain only the message, never a hidden stale model/scope choice. Resolve the current enabled LLM configuration through the base presentation's connection at server admission, pin it for execution, and reject unavailable/Decision connections without silently switching providers. Null proposal fields preserve original content and placement.

- Real chat edits text, native image/chart/shape/textbox objects and title/body placement through typed `propose_slide_patch` proposals. Freeze one or up to 24 selected slide versions, object IDs, model configuration and available project media. Preserve non-selected fields, objects, slides and canonical citation IDs server-side; do not equate this with provider-native multi-tool agents or arbitrary imported-PPTX object editing.
- Pin the base deck/slide, provider config and runtime profile. Require explicit proposal review and version-checked idempotent apply. Checkpoint each targeted slide separately, reuse completed proposals after failure/restart, and apply the entire reviewed batch in one new rendering run. Publish a new deck head only after rendering and validation; reuse unchanged slide versions and preserve earlier outputs. Render only missing or changed slide parts, reuse validated previews, then assemble the deck with native relationships intact.
- Keep durable shared messages in SQLite/Query and bounded unsent drafts in feature-owned memory. Use official shadcn AI compositions, IME-safe Enter and safe text rendering. Panel collapse and tab changes must preserve drafts. Live model tests use synthetic documents in isolated QA storage, never business data.

- SlideSpec v1 remains readable and immutable; explicit object/layout edits create v2 specs. Validate stable IDs, bounded geometry, chart values and registered image identities. Image uploads preserve original bytes and normalize bounded PNG/JPEG/WebP with bundled Sharp; never execute SVG or fetch model-supplied URLs. Native charts use python-pptx and retain their embedded workbook.
- Keep current-slide navigation separate from batch selection. Support explicit accessible selection controls as well as Ctrl/Command shortcuts, and clear incompatible object scope when selecting several slides. Review every changed slide and its chart data before applying; media upload alone never changes slides.

### Common execution engine

- Document/template preparation, outline generation/content mapping, relation discovery, presentation generation and chat proposals consume workflows/engine. Keep DAG traversal, bounded admission, heartbeat supervision and cancellation generic; versioned topology belongs in workflows/definitions and feature handlers in their drivers. App owns separate document/template (two slots), outline/mapping (one slot), relation discovery (one slot), and shared PPT generation/editing (one slot) admission policies.
- presentation_runs remains canonical for job status, pinned inputs and command receipts. Generic node/event/artifact checkpoints have one SQLite owner; the presentation bridge validates its lease inside the same transaction. Do not introduce duplicate mutable job state.
- Commit rendered artifact references and render-node success atomically. Commit publication/head advancement and publish-node success atomically. Reuse completed nodes and files after publication-only failure. Reject unsupported definitions and stale leases.
- document_jobs remains canonical for document status, extraction/configuration pins and commands. Register its graph atomically with admission; preserve completed extraction and classification checkpoints on waiting, cancellation and restart. Template extraction uses its own graph and skips content classification. Do not present extraction as independently resumable page-level OCR.
- Distinguish these integrations from migrating every worker or implementing parallel nodes, dynamic branching, general human gates, SSE and unified monitoring. Show committed stage states in office language without fabricated progress percentages.

### Native reference reuse and chat execution

- Keep relation_runs, relation_workspaces and assessments canonical. Admission-time retrieval and bounded review/exploration feed common engine publication. Preserve partial budget outcomes, candidate parallelism, pinned configuration and completed assessments; do not turn general Space search into model execution.
- Chat proposals use the versioned propose/render graph through a narrow EditDriver. Commit the final target proposal with propose-node completion and validated preview bytes with render-node completion. Approval remains an explicit version-checked command and queues normal PPT publication; never treat engine completion as user consent.
- presentations owns reference registrations and slide/import lineage; documents owns source jobs, material catalogs, blocks and native locators. Store canonical IDs/FKs, not copied original bytes/text. Pin generation selections at admission; preserve the base model draft and apply reference enrichment once before publication. Reuse unchanged slide versions and stable slide_key identities across imported slides, chat history and comparison.
- Reuse the installed python-pptx/PPT Master tool boundary for native slide/object parts. Preserve native chart workbooks and layout/master/theme dependencies, remap relationships/shape IDs, isolate private parts and fit source aspect ratios. Stage each distinct source Blob once, bound native source input to 150 MiB and clean owned temporary files. Reject unsupported external relationships; never fetch source URLs or run source code.
- Renderer inputs and model proposals may reference only registered, project-scoped immutable import IDs. Bound conversational discovery to eight current shared-source matches and at most twelve extra choices per target in addition to existing references. Keep component selection and user approval authoritative. Native imported groups remain selectable/positionable units in the web editor; do not claim arbitrary internal SmartArt/chart-data editing or complete PowerPoint parity.
- Keep source preview separate from selection. Generation selections add whole pages at the deck end and objects to its first slide; editor insertion adds pages after the selected slide or objects to that slide. Show the exact original version in the Reference tab. Deleting an original logically must not delete confirmed decks or invalidate their pinned source bytes.

### Per-slide quality and rendering

- Validate individual slide output before assembly. Persist fixed-code quality summaries and validated single-slide PPTX/PNG Blobs through a lease-fenced presentation-owned port. Keep canonical source, evidence, chart values and originals unchanged; a failed check must not advance a presentation head.
- Limit automatic typography fitting to the first uncommitted generation (base version zero), with two reductions at most and explicit minimum sizes. Never shorten text or regenerate confirmed results to pass a check. Preserve the previously checked typography recipe for unchanged text/layout during conversational edits; new edits do not receive silent additional fitting.
- Treat geometry/text-fit rules as conservative estimates, not visual-model or font-engine certification. Block missing evidence, missing text/content, text-frame overlap, out-of-slide managed objects and distorted generated images. Explain potential artwork/content overlap as review warnings because backgrounds and imported diagrams can intentionally overlap.
- Cache only validated immutable slide parts. Scope keys by project, runtime, Spec, position, template and actually used media/source versions; unrelated registrations must not invalidate every slide. Verify cached bytes before reuse. Bound derived cache retention to 512 entries and 512 MiB per project with LRU eviction; keep durable quality/typography records and confirmed revisions. Orphan cleanup retains its existing backup/grace protections.
- Reuse successful slide checkpoints after failure/restart and assemble only after all slides pass. Kordoc verifies generated text on its own page. Native assembly checks text/chart/workbook preservation without regenerating unchanged artwork. Keep approval and optimistic head commits explicit; cache completion is never consent.

### Canvas authoring and template-aware writing

- Generation scope accepts whole outline branches or individual sections from the reviewed immutable design. Expand branches to unique leaf nodes in outline order, preserve legacy omitted-scope requests as all sections, and reject empty, duplicate, foreign or stale scope. Checkbox edits never run models. Pin the resolved IDs in existing slide records; preserve previous files and explicitly distinguish a newly scoped deck/version from replacing selected slides inside an existing deck.

- Keep generation output budgets with immutable model configurations. Admin may override structured-authoring limits per LLM connection; absent values retain task defaults and diagnostics/Decision limits remain separate. Pin the selected budget for running workflows. Model-server context loading is a different setting and must not be changed by ordinary app requests. Opt-in live tests may explicitly set larger local context/output budgets without increasing source excerpts or claiming large-document acceptance.

- Studio supports both reviewed AI generation and manual entry. Templates are optional: without one, offer built-in blank/title-body layouts for manual entry and PPT Master defaults for AI generation. Manual entry requires a real project, valid layout and explicit command; pin an immutable template version only when selected. Never invent source, outline, guide, evidence or provider rows. Keep the six review markers visible; unused analysis steps remain incomplete. Manual entry must not bypass AI generation's existing preparation checks.
- Use SlideSpec v4 design metadata for pinned layout identity and authored content. Older v1/v2/v3 Specs and confirmed files remain readable. Manual text may have no evidence; model-generated content still requires its real canonical source links. Never let a model claim authored/manual mode to bypass generation validation.
- Read template slots through the packaged native adapter against the PPT Master-prepared immutable template version. Send bounded eligible layout/slot identities, geometry, text capacities and selected references to the writing model. The model chooses layout/slot content; Rust assigns exact native slot frames. Do not silently fall back to a generic title/body layout when a selected template cannot fit the request.
- Direct geometry/text/object/slide commands never invoke inference. Validate project/base head, version, scope, media membership and optional editor session in a short atomic commit, then queue normal durable rendering. Reuse untouched slide versions, checked rendering and the existing three-entry disposable undo cache. Persist replay receipts and reject shared-write conflicts.
- react-rnd owns gesture listeners and resize mechanics. Keep drag and keyboard frames clamped through one pure geometry helper, support Ctrl/Command multi-selection and group movement, Escape/blur/route cancellation, and non-drag numeric controls. Commit only once on release; no writes during pointer motion. Use shadcn controls for commands, numeric/text entry and slide menus.
- Keep the original full preview as a fallback. Native shape metadata may produce passive background/object PNG layers for live movement; never execute source SVG in the browser. Bound layer count/bytes, associate them with validated cache keys, and authorize every layer through project/run/slide membership. Cache eviction or an unavailable legacy layer must not damage confirmed outputs.
- Slide addition, duplicate/delete and accessible movement commands belong in the left slide navigation. Preserve templates, source graphics, masters/themes, chart workbooks and stable slide identities. Do not equate these controls with arbitrary internal SmartArt/imported-chart editing, unrestricted PowerPoint parity or slide-list pointer DnD.
