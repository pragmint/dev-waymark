import { describe, expect, it } from 'bun:test';
import { loadConfig, parseSqliteUrl } from './config';

function withEnv(vars: Record<string, string | undefined>, fn: () => void) {
  const originals: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(vars)) {
    originals[k] = process.env[k];
    if (v === undefined) {
      delete process.env[k];
    } else {
      process.env[k] = v;
    }
  }
  try {
    fn();
  } finally {
    for (const [k, v] of Object.entries(originals)) {
      if (v === undefined) {
        delete process.env[k];
      } else {
        process.env[k] = v;
      }
    }
  }
}

describe('parseSqliteUrl', () => {
  it('strips sqlite:/// prefix', () => {
    expect(parseSqliteUrl('sqlite:///./data/file.sqlite')).toBe('./data/file.sqlite');
  });

  it('supports :memory: URL', () => {
    expect(parseSqliteUrl('sqlite:///:memory:')).toBe(':memory:');
  });

  it('passes plain paths through unchanged', () => {
    expect(parseSqliteUrl('dev-waymark.sqlite')).toBe('dev-waymark.sqlite');
    expect(parseSqliteUrl(':memory:')).toBe(':memory:');
  });
});

describe('loadConfig', () => {
  const cleanEnv = {
    PORT: undefined,
    DATABASE_PATH: undefined,
    DEV_WAYMARK_SOURCE_DB_ADAPTER: undefined,
    DEV_WAYMARK_SOURCE_DB_URL: undefined,
    DEV_WAYMARK_SOURCE_DB_NAME: undefined,
    DEV_WAYMARK_APP_DB_ADAPTER: undefined,
    DEV_WAYMARK_APP_DB_URL: undefined,
  };

  it('returns defaults when no env vars are set', () => {
    withEnv(cleanEnv, () => {
      const config = loadConfig();
      expect(config.port).toBe(3000);
      expect(config.sourceDb.adapter).toBe('sqlite');
      expect(config.sourceDb.url).toBe('sqlite:///:memory:');
      expect(config.sourceDb.name).toBe('default');
      expect(config.appDb.adapter).toBe('sqlite');
      expect(config.appDb.url).toBe('sqlite:///dev-waymark-app.sqlite');
    });
  });

  it('reads PORT', () => {
    withEnv({ ...cleanEnv, PORT: '4000' }, () => {
      expect(loadConfig().port).toBe(4000);
    });
  });

  it('uses DATABASE_PATH as legacy fallback source URL', () => {
    withEnv({ ...cleanEnv, DATABASE_PATH: 'custom.sqlite' }, () => {
      expect(loadConfig().sourceDb.url).toBe('sqlite:///custom.sqlite');
    });
  });

  it('reads explicit source DB config', () => {
    withEnv(
      {
        ...cleanEnv,
        DEV_WAYMARK_SOURCE_DB_ADAPTER: 'postgres',
        DEV_WAYMARK_SOURCE_DB_URL: 'postgresql://user:pass@localhost:5432/mydb',
        DEV_WAYMARK_SOURCE_DB_NAME: 'analytics',
      },
      () => {
        const config = loadConfig();
        expect(config.sourceDb.adapter).toBe('postgres');
        expect(config.sourceDb.url).toBe('postgresql://user:pass@localhost:5432/mydb');
        expect(config.sourceDb.name).toBe('analytics');
      }
    );
  });

  it('reads explicit app DB config', () => {
    withEnv(
      {
        ...cleanEnv,
        DEV_WAYMARK_APP_DB_ADAPTER: 'postgres',
        DEV_WAYMARK_APP_DB_URL: 'postgresql://user:pass@localhost:5432/app',
      },
      () => {
        const config = loadConfig();
        expect(config.appDb.adapter).toBe('postgres');
        expect(config.appDb.url).toBe('postgresql://user:pass@localhost:5432/app');
      }
    );
  });

  it('source and app DB can be different adapters', () => {
    withEnv(
      {
        ...cleanEnv,
        DEV_WAYMARK_SOURCE_DB_ADAPTER: 'redshift',
        DEV_WAYMARK_SOURCE_DB_URL: 'redshift://user:pass@host:5439/warehouse',
        DEV_WAYMARK_APP_DB_ADAPTER: 'sqlite',
        DEV_WAYMARK_APP_DB_URL: 'sqlite:///dev-waymark-app.sqlite',
      },
      () => {
        const config = loadConfig();
        expect(config.sourceDb.adapter).toBe('redshift');
        expect(config.appDb.adapter).toBe('sqlite');
      }
    );
  });

  it('rejects unknown source adapter', () => {
    withEnv({ ...cleanEnv, DEV_WAYMARK_SOURCE_DB_ADAPTER: 'oracle' }, () => {
      expect(() => loadConfig()).toThrow();
    });
  });

  it('rejects unknown app adapter', () => {
    withEnv({ ...cleanEnv, DEV_WAYMARK_APP_DB_ADAPTER: 'mysql' }, () => {
      expect(() => loadConfig()).toThrow();
    });
  });
});

describe('source and app DB independence', () => {
  it('source URL and app URL are separate config values', () => {
    withEnv(
      {
        DEV_WAYMARK_SOURCE_DB_URL: 'sqlite:///source.sqlite',
        DEV_WAYMARK_APP_DB_URL: 'sqlite:///app.sqlite',
        DEV_WAYMARK_SOURCE_DB_ADAPTER: 'sqlite',
        DEV_WAYMARK_APP_DB_ADAPTER: 'sqlite',
        PORT: undefined,
        DATABASE_PATH: undefined,
        DEV_WAYMARK_SOURCE_DB_NAME: undefined,
      },
      () => {
        const config = loadConfig();
        expect(config.sourceDb.url).toBe('sqlite:///source.sqlite');
        expect(config.appDb.url).toBe('sqlite:///app.sqlite');
        expect(config.sourceDb.url).not.toBe(config.appDb.url);
      }
    );
  });
});
