import { FilterTreeSchema, isGroup, isLeaf, nextNodeId } from '../schemas/filterTree';
import type {
  FilterGroup,
  FilterGroupOp,
  FilterLeaf,
  FilterNode,
  FilterTree,
} from '../schemas/filterTree';
import type { MetaFilterOp } from '../schemas/entity';

// Binary codec for filter trees. Encodes the tree as a compact byte stream and
// hex-encodes the result so the value rides cleanly in URLs without percent
// escapes. Node ids are stripped on encode (they're DOM-anchor only) and
// regenerated on decode so equivalent trees encode to identical hex strings.

const VERSION = 0x01;

const KIND_LEAF = 0x00;
const KIND_GROUP = 0x01;

const VALUE_STRING = 0x00;
const VALUE_ARRAY = 0x01;

// Append-only: existing indices are load-bearing for encoded URLs.
const LEAF_OPS: MetaFilterOp[] = ['eq', 'contains', 'gte', 'lte', 'exact'];
const GROUP_OPS: FilterGroupOp[] = ['AND', 'OR', 'NOT'];

class Writer {
  private chunks: number[] = [];

  byte(v: number): void {
    this.chunks.push(v & 0xff);
  }

  varint(v: number): void {
    let n = v >>> 0;
    while (n >= 0x80) {
      this.chunks.push((n & 0x7f) | 0x80);
      n >>>= 7;
    }
    this.chunks.push(n & 0x7f);
  }

  string(s: string): void {
    const bytes = new TextEncoder().encode(s);
    this.varint(bytes.length);
    for (const b of bytes) this.chunks.push(b);
  }

  toUint8Array(): Uint8Array {
    return new Uint8Array(this.chunks);
  }
}

class Reader {
  private pos = 0;
  constructor(private readonly buf: Uint8Array) {}

  byte(): number {
    if (this.pos >= this.buf.length) throw new Error('truncated');
    return this.buf[this.pos++];
  }

  varint(): number {
    let result = 0;
    let shift = 0;
    for (;;) {
      const b = this.byte();
      result |= (b & 0x7f) << shift;
      if ((b & 0x80) === 0) return result >>> 0;
      shift += 7;
      if (shift > 28) throw new Error('varint overflow');
    }
  }

  string(): string {
    const len = this.varint();
    if (this.pos + len > this.buf.length) throw new Error('truncated');
    const slice = this.buf.subarray(this.pos, this.pos + len);
    this.pos += len;
    return new TextDecoder().decode(slice);
  }

  done(): boolean {
    return this.pos === this.buf.length;
  }
}

function bytesToHex(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i].toString(16).padStart(2, '0');
  }
  return out;
}

function hexToBytes(hex: string): Uint8Array | null {
  if (hex.length === 0 || hex.length % 2 !== 0) return null;
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    const code = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
    if (Number.isNaN(code)) return null;
    out[i] = code;
  }
  return out;
}

function writeNode(w: Writer, node: FilterNode): void {
  if (isLeaf(node)) {
    const opIdx = LEAF_OPS.indexOf(node.op);
    if (opIdx < 0) throw new Error(`unknown leaf op: ${node.op}`);
    w.byte(KIND_LEAF);
    w.byte(opIdx);
    w.string(node.key);
    if (Array.isArray(node.value)) {
      w.byte(VALUE_ARRAY);
      w.varint(node.value.length);
      for (const v of node.value) w.string(v);
    } else {
      w.byte(VALUE_STRING);
      w.string(node.value);
    }
    return;
  }
  if (isGroup(node)) {
    const opIdx = GROUP_OPS.indexOf(node.op);
    if (opIdx < 0) throw new Error(`unknown group op: ${node.op}`);
    w.byte(KIND_GROUP);
    w.byte(opIdx);
    w.varint(node.children.length);
    for (const child of node.children) writeNode(w, child);
  }
}

function readNode(r: Reader, isRoot: boolean): FilterNode {
  const kind = r.byte();
  if (kind === KIND_LEAF) {
    const opIdx = r.byte();
    if (opIdx < 0 || opIdx >= LEAF_OPS.length) throw new Error('bad leaf op');
    const op = LEAF_OPS[opIdx];
    const key = r.string();
    const vkind = r.byte();
    let value: string | string[];
    if (vkind === VALUE_STRING) {
      value = r.string();
    } else if (vkind === VALUE_ARRAY) {
      const n = r.varint();
      const arr: string[] = [];
      for (let i = 0; i < n; i++) arr.push(r.string());
      value = arr;
    } else {
      throw new Error('bad value kind');
    }
    const leaf: FilterLeaf = { type: 'filter', id: nextNodeId('l'), key, op, value };
    return leaf;
  }
  if (kind === KIND_GROUP) {
    const opIdx = r.byte();
    if (opIdx < 0 || opIdx >= GROUP_OPS.length) throw new Error('bad group op');
    const op = GROUP_OPS[opIdx];
    const n = r.varint();
    const children: FilterNode[] = [];
    for (let i = 0; i < n; i++) children.push(readNode(r, false));
    const group: FilterGroup = {
      type: 'group',
      id: isRoot ? 'root' : nextNodeId('g'),
      op,
      children,
    };
    return group;
  }
  throw new Error('bad node kind');
}

export function encodeTreeHex(tree: FilterTree): string {
  const w = new Writer();
  w.byte(VERSION);
  writeNode(w, tree);
  return bytesToHex(w.toUint8Array());
}

export function decodeTreeHex(hex: string): FilterTree | null {
  const bytes = hexToBytes(hex);
  if (!bytes) return null;
  try {
    const r = new Reader(bytes);
    const version = r.byte();
    if (version !== VERSION) return null;
    const node = readNode(r, true);
    if (!r.done()) return null;
    if (!isGroup(node)) return null;
    const result = FilterTreeSchema.safeParse(node);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}
