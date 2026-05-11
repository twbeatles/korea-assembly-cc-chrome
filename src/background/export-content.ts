export function splitContentForBlobParts(content: string, chunkSize: number): string[] {
  const safeChunkSize = Math.max(1, Math.floor(chunkSize));
  if (!content) {
    return [""];
  }
  if (content.length <= safeChunkSize) {
    return [content];
  }

  const parts: string[] = [];
  let current = "";

  for (const character of content) {
    if (current && current.length + character.length > safeChunkSize) {
      parts.push(current);
      current = "";
    }
    current += character;
  }

  if (current) {
    parts.push(current);
  }

  return parts;
}
