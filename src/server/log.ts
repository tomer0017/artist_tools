import 'server-only';

// Structured logs: one JSON object per line, which journald (and any log
// shipper) can index. Never log secrets, tokens or email addresses — log
// internal ids instead.

type Fields = Record<string, unknown>;
type Level = 'info' | 'warn' | 'error';

function write(level: Level, event: string, fields: Fields = {}) {
  const line = JSON.stringify({ time: new Date().toISOString(), level, event, ...fields }, (_key, value) =>
    value instanceof Error ? { name: value.name, message: value.message } : value,
  );
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

export const log = {
  info: (event: string, fields?: Fields) => write('info', event, fields),
  warn: (event: string, fields?: Fields) => write('warn', event, fields),
  error: (event: string, fields?: Fields) => write('error', event, fields),
};
