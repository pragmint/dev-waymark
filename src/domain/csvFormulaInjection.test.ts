import { describe, test, expect } from 'bun:test';
import { entitiesToCsv } from './entityCsv';
import type { EntityWithMetadata } from '../schemas/entity';

function entity(name: string, metadata: Record<string, string | null> = {}): EntityWithMetadata {
  return {
    id: 1,
    name,
    type: 'github_pr',
    created_at: '',
    metadata: Object.entries(metadata).map(([key, value]) => ({
      entity_id: 1,
      key,
      value,
      value_type: 'string',
      created_at: '',
      updated_at: '',
    })),
  };
}

function cells(csv: string): string[] {
  return csv.split('\r\n')[1].split(',');
}

// Entity names and metadata originate in Jira/GitHub, so a ticket title or
// branch name can start with a spreadsheet formula sigil. Excel and Sheets
// execute those on open, and this CSV exists to be opened in a spreadsheet.
describe('CSV formula injection', () => {
  test('neutralizes a leading = in an entity name', () => {
    const csv = entitiesToCsv([entity('=cmd|/c calc!A1')], []);
    expect(cells(csv)[0]).toBe("'=cmd|/c calc!A1");
  });

  test('neutralizes a leading @ in an entity name', () => {
    expect(cells(entitiesToCsv([entity('@SUM(A1:A9)')], []))[0]).toBe("'@SUM(A1:A9)");
  });

  test('neutralizes a leading = in a metadata value', () => {
    const csv = entitiesToCsv([entity('PR-1', { note: '=1+1' })], ['note']);
    expect(cells(csv)[2]).toBe("'=1+1");
  });

  test('still quotes a neutralized value that also contains a comma', () => {
    const csv = entitiesToCsv([entity('=a,b')], []);
    expect(csv.split('\r\n')[1]).toBe('"\'=a,b",github_pr');
  });

  // Deliberately NOT guarded: `-` and `+` lead legitimate signed numbers in
  // metadata, and quoting those would corrupt real values to fix a lesser risk.
  test('leaves legitimate negative and signed numbers untouched', () => {
    const csv = entitiesToCsv([entity('PR-1', { delta: '-5', signed: '+3' })], ['delta', 'signed']);
    expect(cells(csv)[2]).toBe('-5');
    expect(cells(csv)[3]).toBe('+3');
  });

  test('leaves ordinary values untouched', () => {
    expect(cells(entitiesToCsv([entity('PR-1', { a: 'dev1' })], ['a']))).toEqual([
      'PR-1',
      'github_pr',
      'dev1',
    ]);
  });
});
