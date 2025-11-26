import { z } from "zod";

const structuredPrimitiveSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
]);

export type StructuredPrimitive = z.infer<typeof structuredPrimitiveSchema>;

export type StructuredValue =
  | StructuredPrimitive
  | StructuredValue[]
  | { [key: string]: StructuredValue };

export const structuredValueSchema: z.ZodType<StructuredValue> = z.lazy(() =>
  z.union([
    structuredPrimitiveSchema,
    z.array(structuredValueSchema),
    z.record(structuredValueSchema),
  ]),
);

const richTextVariants = ["paragraph", "heading", "subheading", "quote", "code"] as const;

export const richTextBlockSchema = z.object({
  type: z.literal("text"),
  text: z.string().min(1),
  variant: z.enum(richTextVariants).default("paragraph"),
  level: z.number().min(1).max(4).optional(),
  badge: z.string().optional(),
});

export const richMathBlockSchema = z.object({
  type: z.literal("math"),
  latex: z.string().min(1),
  displayMode: z.boolean().optional(),
  label: z.string().optional(),
});

export const richTableBlockSchema = z.object({
  type: z.literal("table"),
  caption: z.string().optional(),
  headers: z.array(z.string()).optional(),
  rows: z.array(
    z.array(z.union([z.string(), z.number(), z.boolean(), z.null()])),
  ),
});

export const richListBlockSchema = z.object({
  type: z.literal("list"),
  title: z.string().optional(),
  ordered: z.boolean().optional(),
  items: z.array(
    z.union([
      z.string(),
      z.object({
        title: z.string().optional(),
        body: z.string().optional(),
        math: z.string().optional(),
        audioUrl: z.string().optional(),
      }),
    ]),
  ),
});

export const richTimelineBlockSchema = z.object({
  type: z.literal("timeline"),
  title: z.string().optional(),
  layout: z.enum(["vertical", "horizontal"]).default("vertical"),
  events: z.array(
    z.object({
      label: z.string(),
      description: z.string().optional(),
      date: z.string().optional(),
      icon: z.string().optional(),
    }),
  ),
});

export const richDiagramBlockSchema = z.object({
  type: z.literal("diagram"),
  title: z.string().optional(),
  description: z.string().optional(),
  layout: z.enum(["horizontal", "vertical"]).default("horizontal"),
  format: z.enum(["simple", "mermaid", "svg"]).default("simple"),
  content: z.string().optional(),
  nodes: z
    .array(
      z.object({
        id: z.string(),
        label: z.string(),
        description: z.string().optional(),
      }),
    )
    .optional(),
  edges: z
    .array(
      z.object({
        from: z.string(),
        to: z.string(),
        label: z.string().optional(),
      }),
    )
    .optional(),
});

export const richStructuredDataBlockSchema = z.object({
  type: z.literal("structured_data"),
  title: z.string().optional(),
  format: z.enum(["key_value", "json", "metrics"]).default("key_value"),
  data: structuredValueSchema,
});

export const richContentBlockSchema = z.discriminatedUnion("type", [
  richTextBlockSchema,
  richMathBlockSchema,
  richTableBlockSchema,
  richListBlockSchema,
  richTimelineBlockSchema,
  richDiagramBlockSchema,
  richStructuredDataBlockSchema,
]);

export const richContentSectionSchema = z.object({
  id: z.string().optional(),
  title: z.string().optional(),
  description: z.string().optional(),
  blocks: z.array(richContentBlockSchema).default([]),
});

export const richContentDocumentSchema = z.object({
  title: z.string().optional(),
  preview: z.string().optional(),
  description: z.string().optional(),
  sections: z.array(richContentSectionSchema).default([]),
  blocks: z.array(richContentBlockSchema).default([]),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export type RichTextBlock = z.infer<typeof richTextBlockSchema>;
export type RichMathBlock = z.infer<typeof richMathBlockSchema>;
export type RichTableBlock = z.infer<typeof richTableBlockSchema>;
export type RichListBlock = z.infer<typeof richListBlockSchema>;
export type RichTimelineBlock = z.infer<typeof richTimelineBlockSchema>;
export type RichDiagramBlock = z.infer<typeof richDiagramBlockSchema>;
export type RichStructuredDataBlock = z.infer<typeof richStructuredDataBlockSchema>;
export type RichContentBlock = z.infer<typeof richContentBlockSchema>;
export type RichContentSection = z.infer<typeof richContentSectionSchema>;
export type RichContentDocument = z.infer<typeof richContentDocumentSchema>;

export const isRichContentDocument = (
  value: unknown,
): value is RichContentDocument => richContentDocumentSchema.safeParse(value).success;
