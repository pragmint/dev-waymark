import type { FC } from 'hono/jsx';

// JSON.stringify leaves `<` alone, so a string value containing `</script>`
// would close the embed and run as HTML. Escaping `<`, `>` and `&` as JSON
// unicode escapes keeps the text inert in HTML and still parses to the same
// value; U+2028/U+2029 are escaped for the same reason in older JS parsers.
export const serializeJsonForScript = (value: unknown): string =>
  (JSON.stringify(value) ?? 'null')
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');

// A server value handed to a client script, read back with `readJsonEmbed`.
export const JsonEmbed: FC<{ id: string; value: unknown }> = ({ id, value }) => (
  <script
    type="application/json"
    id={id}
    dangerouslySetInnerHTML={{ __html: serializeJsonForScript(value) }}
  />
);
