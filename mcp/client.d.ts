// The hand-written half of Bentrix's JavaScript client (client.js).

export declare const PROTOCOL_VERSION: '2026-07-28';
/** The JSON-RPC code of a request Bentrix refused before doing anything with it; the client sends it again after the wait it names. */
export declare const BUSY: -40001;
export declare const BUSY_RETRIES: 10;
export declare const BUSY_WAIT_MAX_MS: 5000;

export declare class BentrixError extends Error {}
export declare class RpcError extends BentrixError {
  readonly code: number;
  readonly data: unknown;
}
export declare class ToolError extends BentrixError {
  readonly tool: string;
  /** The server's word for the kind (busy, expired, insufficient_scope...), when it gave one. */
  readonly machine?: string;
}
/** A stream's clock went back behind its cursor; `watch` ends with this. Read on from `cursor`. */
export declare class Rewound extends BentrixError {
  readonly uri: string;
  readonly cursor: string | null;
}
export declare class NotRunning extends BentrixError {}
export declare class PairingRefused extends BentrixError {}
export declare class IncompatibleCatalogue extends BentrixError {}
export declare class JobFailed extends BentrixError {}

export declare class Job<T> {
  readonly handle: string | null;
  status(): Promise<Record<string, any>>;
  cancel(): Promise<void>;
  wait(opts?: { timeoutMs?: number; pollMs?: number }): Promise<T>;
}

export declare class Client {
  readonly url: string;
  readonly catalogueVersion: string;
  call(name: string, args?: Record<string, unknown>): Promise<any>;
  callJob(name: string, args?: Record<string, unknown>): Promise<Job<any>>;
  readResource(template: string, vars?: Record<string, unknown>): Promise<any>;
  readPages(template: string, vars?: Record<string, unknown>): AsyncGenerator<any>;
  watch(template: string, vars?: Record<string, unknown>, opts?: { after?: string; timeoutMs?: number }): AsyncGenerator<any>;
  verifyCatalogue(): Promise<string>;
  close(): void;
}

export declare function agentsDir(): string;
export declare function discover(opts?: { agentsFolder?: string; name?: string }): Promise<{ url: string; token: string }>;
export declare function pair(url: string, secret: string, name: string): Promise<string>;
