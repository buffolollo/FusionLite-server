/**
 * Stato persistente minimo: appClientId stabile e ultima data inviata.
 * Scrittura atomica (tmp + rename) con permessi 0600.
 */

import fs from 'node:fs';
import path from 'node:path';

const EMPTY = {
  appClientId: null,
  lastSentDate: null,
  lastAttemptAt: null,
  lastResult: null,
  lastTransport: null,
};

function statePath(dir) {
  return path.join(dir, 'state.json');
}

export function ensureStateDir(dir) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
}

export function readState(dir) {
  ensureStateDir(dir);
  try {
    const raw = fs.readFileSync(statePath(dir), 'utf8');
    const parsed = JSON.parse(raw);
    return { ...EMPTY, ...parsed };
  } catch {
    return { ...EMPTY };
  }
}

export function writeState(dir, state) {
  ensureStateDir(dir);
  const target = statePath(dir);
  const temporary = `${target}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, target);
  try {
    fs.chmodSync(target, 0o600);
  } catch {
    // Permessi già corretti o filesystem senza supporto: non è fatale.
  }
}
