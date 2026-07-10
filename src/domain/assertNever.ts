// Exhaustiveness helper: pass the value of a `switch`'s `default` branch here so
// an unhandled case is a compile error, not a silent runtime fallthrough.
export function assertNever(x: never): never {
  throw new Error(`Unexpected value: ${JSON.stringify(x)}`);
}
