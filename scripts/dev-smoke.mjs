#!/usr/bin/env node
/**
 * Zero-config smoke test against a Firefox-family BiDi endpoint.
 *
 * It uses the real discovery module from `dist/`, so run `pnpm build` first.
 * The script only calls `session.status`. It never takes over the session.
 */

import { WebSocket } from 'ws';
import { loadConfig } from '../dist/config.js';
import { discoverBrowsers } from '../dist/connection/browser-discovery.js';

const config = loadConfig();
const candidates = await discoverBrowsers(config);

if (candidates.length === 0) {
  console.error('no BiDi candidates found');
  console.error('start Firefox or Zen with --remote-debugging-port');
  process.exit(1);
}

console.log(`probing ${candidates.length} candidate(s)`);

let lastError = null;

for (const candidate of candidates) {
  try {
    console.log(`checking ${candidate.endpoint} (${candidate.source})`);
    const message = await probe(candidate.endpoint);

    if (message.type === 'success') {
      console.log('session.status ok');
      console.log(JSON.stringify(message.result, null, 2));
      process.exit(0);
    }

    lastError = new Error(`unexpected response: ${JSON.stringify(message)}`);
  } catch (error) {
    lastError = error;
  }
}

console.error(`no reachable BiDi endpoint: ${lastError?.message ?? 'unknown error'}`);
console.error('start Firefox or Zen with --remote-debugging-port');
process.exit(1);

function probe(url, timeoutMs = 3000) {
  return new Promise((resolvePromise, rejectPromise) => {
    const socket = new WebSocket(url);
    let settled = false;

    const finish = (error, result) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      try {
        socket.close();
      } catch {
        // Ignore close errors.
      }
      if (error) {
        rejectPromise(error);
      } else {
        resolvePromise(result);
      }
    };

    const timer = setTimeout(() => {
      finish(new Error('timeout waiting for session.status'));
    }, timeoutMs);

    socket.on('error', (error) => {
      finish(error);
    });

    socket.on('open', () => {
      socket.send(JSON.stringify({ id: 1, method: 'session.status', params: {} }));
    });

    socket.on('message', (data) => {
      try {
        finish(null, JSON.parse(data.toString()));
      } catch (error) {
        finish(error);
      }
    });
  });
}
