import {
  type RichContentBlock,
  type RichContentDocument,
  richContentDocumentSchema,
} from "@theteacher/shared";

const fallbackKeys = ["preview", "summary", "description", "body", "text"] as const;

const toTextBlock = (text: string, index: number): RichContentBlock => ({
  type: "text",
  text,
  variant: index === 0 ? "heading" : "paragraph",
});

export const normalizeRichContentDocument = (
  value: unknown,
): RichContentDocument | null => {
  const parsed = richContentDocumentSchema.safeParse(value);
  if (parsed.success) {
    return parsed.data;
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const candidateTexts = [
    typeof record.title === "string" ? record.title : undefined,
    ...fallbackKeys
      .map((key) => record[key])
      .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0),
  ].filter((entry): entry is string => typeof entry === "string");

  if (candidateTexts.length === 0) {
    const inlineContent =
      typeof record.content === "string"
        ? record.content
        : typeof record.preview === "string"
          ? record.preview
          : undefined;
    if (!inlineContent) {
      return null;
    }
    candidateTexts.push(inlineContent);
  }

  const blocks = candidateTexts.map(toTextBlock);

  return {
    title: typeof record.title === "string" ? record.title : undefined,
    preview:
      typeof record.preview === "string" ? record.preview : candidateTexts[0],
    description:
      typeof record.description === "string" ? record.description : undefined,
    sections: [],
    blocks,
    metadata: undefined,
  };
};

export const getRichContentPreview = (value: Record<string, unknown>) => {
  const doc = normalizeRichContentDocument(value);
  if (!doc) {
    return JSON.stringify(value).slice(0, 80);
  }
  if (doc.preview) return doc.preview;
  if (doc.title) return doc.title;
  const firstText = doc.blocks.find((block) => block.type === "text");
  return firstText?.text ?? JSON.stringify(value).slice(0, 80);
};
