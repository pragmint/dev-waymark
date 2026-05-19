import { PostgresSourceAdapter } from './postgres';

/**
 * RedshiftSourceAdapter — thin wrapper over PostgresSourceAdapter.
 *
 * Amazon Redshift speaks the PostgreSQL wire protocol, so the pg driver works
 * without modification. This class exists as a named seam so callers can
 * express intent clearly (e.g., STEP_ENGINE_SOURCE_DB_ADAPTER=redshift) and
 * so Redshift-specific behaviour can be added here without touching the
 * Postgres adapter.
 */
export class RedshiftSourceAdapter extends PostgresSourceAdapter {
  constructor(connectionString: string) {
    super(connectionString);
  }
}
