#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from './server.js';

const here = dirname(fileURLToPath(import.meta.url));
const defaultStatic = resolve(here, '../../../apps/simulator/dist');
const staticDir = process.env.STATIC_DIR ?? (existsSync(defaultStatic) ? defaultStatic : undefined);

const server = await startServer({
  port: Number(process.env.PORT ?? 8080),
  host: process.env.HOST ?? '0.0.0.0',
  staticDir,
});
console.log(
  `roommix server listening on port ${server.port}` + (staticDir ? `, serving ${staticDir}` : ''),
);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    server.close().then(() => process.exit(0));
  });
}
