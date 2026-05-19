import type { Database } from 'bun:sqlite';

/**
 * Execute a block of SQL that may contain multiple statements separated by
 * semicolons — the recommended replacement for the deprecated `db.exec()`.
 */
export function runSql(db: Database, sql: string): void {
  for (const statement of sql.split(';')) {
    const trimmed = statement.trim();
    if (trimmed) db.query(trimmed).run();
  }
}
