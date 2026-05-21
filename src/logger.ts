type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';

const LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
  silent: 4,
};

function resolveLevel(): LogLevel {
  if (process.env.NODE_ENV === 'test') return 'silent';
  const env = process.env.LOG_LEVEL as LogLevel | undefined;
  return env && env in LEVELS ? env : 'info';
}

const currentLevel = LEVELS[resolveLevel()];

function log(
  level: Exclude<LogLevel, 'silent'>,
  msg: string,
  attrs?: Record<string, unknown>
): void {
  if (LEVELS[level] < currentLevel) return;
  const entry: Record<string, unknown> = {
    timestamp: new Date().toISOString(),
    severity: level.toUpperCase(),
    message: msg,
  };
  if (attrs) entry.attributes = attrs;
  const method = level === 'warn' ? 'warn' : level === 'error' ? 'error' : 'log';
  console[method](JSON.stringify(entry));
}

export const logger = {
  debug: (msg: string, attrs?: Record<string, unknown>) => log('debug', msg, attrs),
  info: (msg: string, attrs?: Record<string, unknown>) => log('info', msg, attrs),
  warn: (msg: string, attrs?: Record<string, unknown>) => log('warn', msg, attrs),
  error: (msg: string, attrs?: Record<string, unknown>) => log('error', msg, attrs),
};
