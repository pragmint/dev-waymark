// Reads the server's JSON embeds (see the JsonEmbed component) and checks the
// values inside them. The parsed JSON is `unknown` on purpose: each script
// passes it through its own parser, built from the guards below, before use.

export function readJsonEmbed(id: string): unknown {
  const el = document.getElementById(id);
  if (!el?.textContent) return null;
  try {
    return JSON.parse(el.textContent);
  } catch {
    return null;
  }
}

export function asRecord(raw: unknown): Record<string, unknown> {
  return typeof raw === 'object' && raw !== null && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : {};
}

export function asInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) ? value : null;
}

export function asPositiveInteger(value: unknown): number | null {
  const n = asInteger(value);
  return n != null && n > 0 ? n : null;
}
