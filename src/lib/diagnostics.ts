export interface DiagnosticEntry {
  readonly id: number;
  readonly timestamp: string;
  readonly stage: string;
  readonly message: string;
  readonly details?: Readonly<Record<string, string | number | boolean | null>>;
}

const ALLOWED_DETAILS = new Set([
  'transport', 'state', 'stage', 'source', 'firmware', 'wifiFirmware', 'status', 'httpStatus',
  'permission', 'fileCount', 'durationSeconds', 'expectedBytes', 'receivedBytes', 'bytes', 'legacy', 'withResponse',
  'attempt', 'retry', 'elapsedMs', 'deviceCount', 'platform', 'version', 'appVersion', 'count', 'verified',
  'reason', 'error', 'connected', 'recordings', 'recordingId', 'recording', 'availableBytes',
]);

export function createDiagnostics() {
  let entries: readonly DiagnosticEntry[] = Object.freeze([]);
  let nextId = 1;
  const secrets = new Map<string, number>();
  const listeners = new Set<() => void>();

  function redact(value: unknown): string {
    let result = typeof value === 'string' ? value : value instanceof Error ? value.message : String(value);
    for (const secret of [...secrets.keys()].sort((a, b) => b.length - a.length)) {
      result = result.split(secret).join('[redacted]');
    }
    return result
      .replace(/\bBearer\s+[^\s,;"'}]+/gi, 'Bearer [redacted]')
      .replace(/\bpk_[A-Za-z0-9_-]+\b/g, '[api-key]')
      .replace(/\beyJ[A-Za-z0-9_.-]+\b/g, '[token]')
      .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[email]')
      .replace(/\b(?:[a-f0-9]{2}[:-]){5}[a-f0-9]{2}\b/gi, '[device]')
      .replace(/\b[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\b/gi, '[device]')
      .replace(/\bPKT01[^\s,;"'}]*/gi, '[Pocket]')
      .replace(/(APP&SK&)[^\s,;"'}]+/gi, '$1[redacted]')
      .replace(/((?:session[_ -]?key|bind[_ -]?key|user[_ -]?id|uid|distinct_id|password|passphrase|access_token|refresh_token|client_secret|client_id|code_verifier|authorization|api[_ -]?key)["']?\s*[=:]\s*["']?)[^\s,;"'}]+/gi, '$1[redacted]')
      .replace(/([?&](?:code|state|nonce|token|id_token_hint|login_hint|ext_agent_host_id|client_id|code_verifier)=)[^&#\s]+/gi, '$1[redacted]')
      .replace(/\b[A-Za-z0-9_-]{16,}\b/g, '[identifier]')
      .slice(0, 1200);
  }

  function notify() { for (const listener of listeners) listener(); }

  function safeDetails(details: Record<string, unknown> | undefined) {
    if (!details) return undefined;
    const output: Record<string, string | number | boolean | null> = {};
    for (const [key, value] of Object.entries(details)) {
      if (!ALLOWED_DETAILS.has(key)) continue;
      if (value === null || typeof value === 'boolean') output[key] = value;
      else if (typeof value === 'number' && Number.isFinite(value)) output[key] = value;
      else if (typeof value === 'string') output[key] = redact(value);
    }
    return Object.freeze(output);
  }

  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    getSnapshot: () => entries,
    redact,
    log(stage: string, message: string, details?: Record<string, unknown>) {
      const entry = Object.freeze({
        id: nextId++, timestamp: new Date().toISOString(), stage: redact(stage),
        message: redact(message), details: safeDetails(details),
      });
      entries = Object.freeze([...entries.slice(-199), entry]);
      // Development builds mirror the already-redacted entry to the Metro console.
      if (typeof __DEV__ !== 'undefined' && __DEV__) {
        console.info(`[pocket] ${entry.stage}: ${entry.message}${entry.details ? ` ${JSON.stringify(entry.details)}` : ''}`);
      }
      notify();
    },
    /** Returns cleanup for short-lived OAuth secrets; no secrets are serialized or logged. */
    registerSecret(value: string) {
      if (!value) return () => {};
      const values = [value];
      if (/^[\x21-\x7e]{16,128}$/.test(value) && !value.includes('.')) {
        values.push(value.slice(0, 16), value.slice(0, 8));
      }
      for (const secret of new Set(values)) secrets.set(secret, (secrets.get(secret) ?? 0) + 1);
      // Redact already collected diagnostics if a secret is identified later.
      entries = Object.freeze(entries.map(entry => Object.freeze({
        ...entry, stage: redact(entry.stage), message: redact(entry.message), details: safeDetails(entry.details),
      })));
      notify();
      let removed = false;
      return () => {
        if (removed) return;
        removed = true;
        for (const secret of new Set(values)) {
          const count = secrets.get(secret) ?? 0;
          if (count <= 1) secrets.delete(secret); else secrets.set(secret, count - 1);
        }
      };
    },
    exportReport(extra: Record<string, unknown> = {}) {
      const info = safeDetails(extra);
      return [
        'Open Pocket diagnostic report',
        'Credentials, account identifiers and device identifiers are redacted.',
        JSON.stringify(info),
        ...entries.map(entry => `${entry.timestamp} [${entry.stage}] ${entry.message}${
          entry.details && Object.keys(entry.details).length ? ` ${JSON.stringify(entry.details)}` : ''}`),
      ].join('\n');
    },
  };
}

export const diagnostics = createDiagnostics();
export const redactDiagnosticText = diagnostics.redact;
export function safeErrorMessage(error: unknown): string {
  return diagnostics.redact(error instanceof Error ? error.message : 'The operation could not be completed.');
}
