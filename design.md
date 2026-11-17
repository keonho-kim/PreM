# Design: PreM Folio

This is the shared system for PreM's document-to-presentation workspace.
The user authorized a full designer-led redesign, replacing Refract and the tile/glass direction.

## System

- Genre: modern-minimal; scope: working app screens.
- Theme: Hallmark Furrow, adapted to an editorial document workspace named Folio.
- Character: calm, exact, tactile through real document planes rather than decoration.
- World: source papers, annotation, slide proofs, and revision records.
- Signature: a short ink rule and source-page reference on evidence, consistently connecting material to a slide.
- Light only. Opaque near-white workspace, paper surfaces, charcoal ink, restrained tangerine commands.
- No tiles, glass, blur, decorative backgrounds, noise, colored shadows, or page-entry animation.

## Audience and information hierarchy

The primary audience is general office workers, with no assumed programming or AI-operations knowledge. Task labels explain the material, outcome and next action. Preserve technical contracts in engineering documents; keep developer terms, execution stages, IDs, storage rules and raw diagnostics out of product chrome, dialogs, messages and help.

Keep the existing Folio palette, typography and source-paper signature. Let documents and slide previews carry the detail. Use short action labels, optional writing requests, compact task navigation and disclosed history/settings. Never rewrite user-authored source content to enforce UI language.

## Tokens

`design/refract.tokens.json` remains the canonical token file for compatibility with the existing generator. Its name is historical; its content is the Folio system.
`pnpm tokens` generates both UI token stylesheets. Do not hand-edit generated files.

- Workspace: #f6f5f2; paper: #fffefa; neutral well: #eeede8.
- Primary ink: #262824; secondary: #51564f; muted: #60665d.
- Tangerine command: #f58254 with #262824 ink; hover: #ee7446.
- Link/focus ink: #9c3d1e; selection: #fbe8de.
- Boundary: #7d8177; rule: #dcded6.
- Fonts: local Red Hat Text for interface and Red Hat Display for headings; Korean system fallback.
- Keep document and slide contents opaque and preserve their existing source colors.
- Radius: commands 8px; panels 12px; paper previews 2px; small tags 4px.
- Spacing: 4/8/12/16/24/32/48/64px. Body 16px, UI 14px, page headings 28px.

## Composition

- Sticky global navigation: Home, Studio, Space; Admin appears only for an Admin session preview. Project context belongs inside Studio, with no permanent sidebar.
- Studio owns a six-step review flow: source, guide, outline, evidence, template, generation/editing. Saved-version confirmations and current-step position are distinct. Use connected circular timeline markers with labels beneath, a current-step ring and completion checks; no boxed step cards. Only adjacent completed steps share an emphasized connector.
- Space owns shared template/reference uploads and labeled progress bars, with text states and no stepper.
- One centered app container, at most 1600px; page gutters 32px, 16px on phones.
- Home uses a responsive three-column project gallery with pagination, due-date filtering and independent context actions.
- Overview: slide proof as main content; preparation ledger alongside; original documents and recent work below.
- Documents: horizontal file selector and lazy page gallery. Preview papers have their own shadow, not surrounding glass cards.
- Guide: optional Do/Don’t textareas and a revision disclosure below.
- Outline: horizontal selection and source panes. Evidence search: news-style result rows, thumbnail left and title/excerpt right, literal matches highlighted. Templates retain visual previews.
- Editor: slide on a neutral workbench, vertical thumbnail list on the left, a right inspector with AI conversation and slide-specific Reference tabs.
- Admin: AI connections, task-specific AI selection, work status and service status. Library management lives in Space.

## Controls and accessibility

- One tangerine primary recipe; secondary paper controls with quiet borders; text actions stay unboxed.
- 44px minimum targets, 48px for coarse pointers; shadcn/ui dialogs and visible instantaneous focus.
- Existing routes, handlers, form fields, simulated states, revision rules, and observer cleanup remain intact.
- Text contrast 4.5:1; essential boundaries/focus 3:1; system-color forced-colors overrides.
- Never convey state through color alone. Keep selected underlines, text, icons and aria states.

## Exports

`frontend/src/app/styles/theme.generated.css`.
Screen-specific layout belongs to its existing owner; no new runtime dependencies.

Editor layout: left slide list, central canvas and right task inspector. Keep the timeline compact, visible and sticky below global navigation in every Studio stage, including the editor. Never collapse the progress indicator. Mobile order is slide strip, canvas, inspector. Preserve the Folio palette, fonts and source colors.

- Editor slide-list and AI/Reference panels must collapse independently using always-visible buttons outside the panels. Keep aria-expanded and aria-controls synchronized with native hidden state. Preserve the panel DOM, draft and selected tab; visibility is session-only UI state. The canvas uses released space, including when both panels are collapsed.

## Production component composition

Use official shadcn/ui components first and adapt them through the Folio tokens. Keep one primitive family consistent with the current Radix setup. Production menus, dialogs, calendar pickers and fields use the shared component system; custom native controls require a concrete component gap. Semantic HTML and accessible keyboard/focus behavior still apply.

AI UI follows [shadcn/ui AI Elements](https://ui.shadcn.com/docs/ai-elements). Chat, Message, Prompt Input, Sources and Trace-based patterns provide presentation structure; project scope, revisions, safe evidence, API calls and workflow state belong to their feature owners. The adopted source and dependency boundary are documented in [the dependency design](dev-docs/08-dependencies.md). Home consumes the official shadcn/ui source recorded in frontend/components.sources.json. Production chat consumes official Message, Bubble, Message Scroller and InputGroup source for real text/object/layout and multi-slide proposals with explicit acceptance. Generated-deck review and independently collapsible panels are implemented; direct canvas dragging remains separate work.
