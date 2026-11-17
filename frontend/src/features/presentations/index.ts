// Purpose: Expose Studio's presentation preparation and generation entry points.
// Pattern: Feature-owned API/state; peer features use this narrow facade.
// Usage: Studio composes these steps after outline confirmation.
// Related: api.ts, generation.tsx, template-choice.tsx.
export { getPreparation, presentationKeys } from './api';
export { EvidenceConfirmation } from './evidence-confirmation';
export { TemplateChoice } from './template-choice';
export { Generation as PresentationGeneration } from './generation';
import './presentations.css';

export { BlankForm } from './blank-form';
