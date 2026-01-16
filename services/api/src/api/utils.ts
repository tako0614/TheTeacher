export const summarizeText = (text: string, limit = 280) =>
  text.replace(/\s+/g, " ").trim().slice(0, limit);

export const countTokens = (text: string) => text.split(/\s+/).filter(Boolean).length;

export const joinChatContent = (content: unknown): string => {
  if (!content) return "";
  if (typeof content === "string") return content.trim();
  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (typeof item === "string") return item;
        if (item && typeof item === "object" && "text" in item && typeof item.text === "string") {
          return item.text;
        }
        return "";
      })
      .join(" ")
      .trim();
  }
  return "";
};

export const encodeBase64 = (bytes: Uint8Array) => {
  if (typeof btoa === "function") {
    let binary = "";
    bytes.forEach((byte) => {
      binary += String.fromCharCode(byte);
    });
    return btoa(binary);
  }
  const buffer = (globalThis as {
    Buffer?: { from(input: Uint8Array): { toString(encoding: string): string } };
  }).Buffer;
  if (buffer) {
    return buffer.from(bytes).toString("base64");
  }
  throw new Error("base64 encoding is not supported in this environment");
};

export const encodeDataUrlFromBytes = (bytes: Uint8Array, mimeType: string) =>
  `data:${mimeType || "application/octet-stream"};base64,${encodeBase64(bytes)}`;

export const readResponseTextWithLimit = async (
  response: Response,
  options?: { maxBytes?: number },
): Promise<string> => {
  const maxBytes = options?.maxBytes ?? 5 * 1024 * 1024;
  if (!response.body) {
    const text = await response.text();
    return text.slice(0, maxBytes);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let out = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > maxBytes) {
      const allowed = value.byteLength - (total - maxBytes);
      if (allowed > 0) out += decoder.decode(value.slice(0, allowed), { stream: true });
      break;
    }
    out += decoder.decode(value, { stream: true });
  }
  out += decoder.decode();
  return out;
};

export const readResponseBytesWithLimit = async (
  response: Response,
  options?: { maxBytes?: number },
): Promise<Uint8Array> => {
  const maxBytes = options?.maxBytes ?? 25 * 1024 * 1024;
  if (!response.body) {
    const buffer = await response.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    if (bytes.byteLength > maxBytes) {
      throw new Error(`payload too large (${bytes.byteLength} bytes)`);
    }
    return bytes;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > maxBytes) {
      throw new Error(`payload too large (${total} bytes)`);
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
};
