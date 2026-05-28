import { describe, expect, it, beforeEach } from 'bun:test';
import { SqliteSourceAdapter } from './sqlite';

describe('SqliteSourceAdapter', () => {
  let adapter: SqliteSourceAdapter;

  beforeEach(() => {
    adapter = new SqliteSourceAdapter(':memory:', true);
  });

  it('validateConnection resolves without error', async () => {
    await expect(adapter.validateConnection()).resolves.toBeUndefined();
  });

  it('applySchema=true creates entity tables', async () => {
    const rows = await adapter.query<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('entities','entity_metadata') ORDER BY name"
    );
    const names = rows.map(r => r.name);
    expect(names).toContain('entities');
    expect(names).toContain('entity_metadata');
  });

  it('applySchema=false leaves database empty', async () => {
    const bare = new SqliteSourceAdapter(':memory:', false);
    const rows = await bare.query<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type='table'"
    );
    await bare.close();
    expect(rows).toHaveLength(0);
  });

  it('query returns rows from the database', async () => {
    await adapter.execute('INSERT INTO entities (id, name, type) VALUES (?, ?, ?)', [
      1,
      'TEST-1',
      'Test',
    ]);
    const rows = await adapter.query<{ id: number; name: string }>(
      'SELECT * FROM entities WHERE id = ?',
      [1]
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe('TEST-1');
  });

  it('query with no params returns all rows', async () => {
    await adapter.execute('INSERT INTO entities (id, name, type) VALUES (?, ?, ?)', [
      1,
      'A',
      'Type1',
    ]);
    await adapter.execute('INSERT INTO entities (id, name, type) VALUES (?, ?, ?)', [
      2,
      'B',
      'Type2',
    ]);
    const rows = await adapter.query('SELECT * FROM entities');
    expect(rows).toHaveLength(2);
  });

  it('execute performs insert and update', async () => {
    await adapter.execute('INSERT INTO entities (id, name, type) VALUES (?, ?, ?)', [
      10,
      'original',
      'Test',
    ]);
    await adapter.execute(
      'INSERT INTO entities (id, name, type) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET name = excluded.name',
      [10, 'updated', 'Test']
    );
    const rows = await adapter.query<{ name: string }>(
      'SELECT name FROM entities WHERE id = ?',
      [10]
    );
    expect(rows[0].name).toBe('updated');
  });

  it('close does not throw', async () => {
    await expect(adapter.close()).resolves.toBeUndefined();
  });
});
