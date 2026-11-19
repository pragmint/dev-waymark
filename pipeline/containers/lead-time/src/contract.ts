// What a container job gets from the runner and owes back to it (pipeline/CONTRACT.md,
// "Container jobs"). Kept free of I/O so a job's logic can be tested on plain values.
import { createHash } from 'node:crypto';

export type SourceRef = { table: string; row_id: string };

/** Each output column's input references, as in a SQL job's `_fields`. */
export type Fields = Record<string, string[]>;

/** The client's settings, as `WAYMARK_PARAMS` gives them. */
export type Params = {
  client: string;
  jira_base_url: string;
  ticket_key_pattern: string;
  statuses: Record<string, string>;
  jira_fields: { key: string; path: string; value_type: string }[];
};

export type JobEnv = {
  /** Input table → Parquet URI. Raw tables are named `raw.<table>`. */
  inputs: Record<string, string>;
  /** Input table → its change file (`_row_id`, `change`), for inputs this snapshot rebuilt. */
  changes: Record<string, string>;
  params: Params;
  /** Where to write the output table, as one Parquet file. */
  output: string;
};

const MAX_SAFE = (1n << 53n) - 1n;

/** The runner's `stable_id(kind, key)`: a 53-bit md5 hash of `<client>:<kind>:<key>`. */
export function stableId(client: string, kind: string, key: string): bigint {
  const hex = createHash('md5').update(`${client}:${kind}:${key}`).digest('hex').slice(0, 14);
  return BigInt(`0x${hex}`) & MAX_SAFE;
}

export function sourceRef(table: string, rowId: bigint | string): SourceRef {
  return { table, row_id: String(rowId) };
}

function jsonVariable(env: Record<string, string | undefined>, name: string): unknown {
  const text = env[name];
  if (text === undefined) {
    throw new Error(`${name} is not set`);
  }
  return JSON.parse(text);
}

function stringRecord(value: unknown, name: string): Record<string, string> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${name} must be a JSON object`);
  }
  for (const [key, item] of Object.entries(value)) {
    if (typeof item !== 'string') {
      throw new Error(`${name}.${key} must be a string`);
    }
  }
  return value as Record<string, string>;
}

/** The job's inputs, parameters and output location, from the `WAYMARK_*` variables. */
export function readJobEnv(env: Record<string, string | undefined>): JobEnv {
  const output = env.WAYMARK_OUTPUT;
  if (!output) {
    throw new Error('WAYMARK_OUTPUT is not set');
  }
  return {
    inputs: stringRecord(jsonVariable(env, 'WAYMARK_INPUTS'), 'WAYMARK_INPUTS'),
    changes: stringRecord(jsonVariable(env, 'WAYMARK_CHANGES'), 'WAYMARK_CHANGES'),
    params: jsonVariable(env, 'WAYMARK_PARAMS') as Params,
    output,
  };
}
