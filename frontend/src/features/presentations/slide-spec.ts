// Purpose: Validate native slide text, objects and placement at the API boundary.
// Pattern: One schema shared by deck previews and conversational proposal comparison.
// Usage: V1 specs omit objects/layout; V2 adds editable native elements.
// Related: backend/modules/presentations/objects.rs, edit-api.ts.
import { z } from 'zod';
export const frameSchema = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
  rotation: z.number().default(0),
});
const objectSchema = z.object({
  id: z.string(),
  name: z.string(),
  frame: frameSchema,
  content: z.discriminatedUnion('kind', [
    z.object({
      kind: z.literal('text'),
      text: z.string(),
      font_size: z.number(),
      color: z.string(),
    }),
    z.object({ kind: z.literal('shape'), shape: z.string(), fill: z.string() }),
    z.object({ kind: z.literal('image'), media_id: z.uuid() }),
    z.object({ kind: z.literal('reference'), reference_id: z.uuid() }),
    z.object({
      kind: z.literal('chart'),
      chart_type: z.string(),
      title: z.string(),
      categories: z.array(z.string()),
      series: z.array(z.object({ name: z.string(), values: z.array(z.number()) })),
    }),
  ]),
});
export const slideSpecSchema = z.object({
  schema_version: z.number(),
  design: z.object({ layout_key: z.string(), authored: z.boolean() }).optional(),
  title: z.string(),
  bullets: z.array(z.string()),
  notes: z.string(),
  block_ids: z.array(z.uuid()),
  objects: z.array(objectSchema).optional(),
  layout: z.object({ title: frameSchema, body: frameSchema }).optional(),
});
export type SlideObject = z.infer<typeof objectSchema>;

export type ObjectFrame = z.infer<typeof frameSchema>;
