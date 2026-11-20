// Reads the server's JSON embeds (see the JsonEmbed component). The parsed JSON
// is `unknown` on purpose: each script passes it through its own parser before
// use.

export function readJsonEmbed(id: string): unknown {
  const el = document.getElementById(id);
  if (!el?.textContent) return null;
  try {
    return JSON.parse(el.textContent);
  } catch {
    return null;
  }
}
