// Bentrix for Node.js: the engine in your own process, and its Gym.

export interface Observation {
  /** The last `window` closed candles: [open, high, low, close] as log ratios to the last close. */
  market: number[][];
  /** Side, log equity ratio to the episode's start, open profit over the opening equity. */
  account: number[];
}

export declare class Local {
  constructor(workspace?: string, store?: string);
  call(tool: string, args?: Record<string, unknown>): any;
  read(resource: string, vars?: Record<string, string>): any;
  arm(bench: string, maxFrames?: number): void;
  advance(bench: string, toMs: number): number;
  settle(maxFrames?: number): void;
  book(bench: string): any;
  /** Close the session: the workspace persisted and let go, so it opens again. Closing twice is nothing. */
  close(): void;
}

export interface EnvOptions {
  symbol?: string;
  interval?: string;
  window?: number;
  action?: 'discrete' | 'continuous' | 'order';
  reward?: string;
  lots?: number;
  episode?: 'tape' | 'window' | 'session';
  episodeBars?: number;
  participation?: number;
  impact?: number;
}

export declare class TradingEnv {
  constructor(local: Local, bench: string, opts?: EnvOptions);
  readonly id: string;
  readonly symbol: string;
  reset(seed?: number): [Observation, Record<string, any>];
  step(action: number | number[] | Record<string, unknown>): [Observation, number, boolean, boolean, Record<string, any>];
  close(): void;
}

export declare function makeTape(directory: string): [string, string];
export declare function intervalMs(label: string): number;
export declare function build(): string;
