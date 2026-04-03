const KNOWN_TITLE_SUFFIX_PATTERNS = [
  /\s+\|\s*국회TV$/u,
  /\s+\|\s*국회방송$/u,
  /\s+-\s*국회TV$/u,
  /\s+-\s*국회방송$/u,
] as const;

export function deriveCommitteeNameFromTitle(title: string): string {
  let current = String(title || "").replace(/\s+/g, " ").trim();
  if (!current) {
    return "";
  }

  let changed = true;
  while (changed) {
    changed = false;
    for (const pattern of KNOWN_TITLE_SUFFIX_PATTERNS) {
      const next = current.replace(pattern, "").trim();
      if (next !== current) {
        current = next;
        changed = true;
      }
    }
  }

  return current;
}
