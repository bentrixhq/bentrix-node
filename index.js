'use strict';
/*
 * BENTRIX in your own Node.js process (crates/bentrix-node, built as bentrix.node beside this file or
 * at BENTRIX_NODE_ADDON): the engine's tools answered in-process by the same names and shapes as over
 * MCP - read, laboratory and paper, never a real account. Its Gym is a client of BENTRIX's own
 * environment (env_make, env_reset, env_step), the one every language reaches.
 */
const path = require('path');

/**
 * The native module, loaded by process.dlopen rather than require: require reads a file not named .node
 * as JavaScript, and a build's own output is libbentrix_node.so, bentrix_node.dll or
 * libbentrix_node.dylib.
 */
function load(file) {
  const module = { exports: {} };
  process.dlopen(module, file);
  return module.exports;
}

const native = load(process.env.BENTRIX_NODE_ADDON || path.join(__dirname, 'bentrix.node'));

/** Leave out what is null or undefined, so the tool's own default applies. */
function plain(args) {
  if (args === undefined || args === null) return undefined;
  return JSON.stringify(args, (k, v) => (v === null || v === undefined ? undefined : v));
}

class Local {
  /** Open `workspace` (yours when omitted) and its recordings (yours when omitted). */
  constructor(workspace, store) {
    this._s = new native.Session(workspace ?? null, store ?? null);
  }

  /** One tool by name; its answer, or its refusal thrown in its own words. */
  call(tool, args) {
    return JSON.parse(this._s.call(tool, plain(args) ?? null));
  }

  /** One resource by its catalogue name (trade_book, trade_deals), its template's variables. */
  read(resource, vars) {
    return JSON.parse(this._s.read(resource, vars ? JSON.stringify(vars) : null));
  }

  /** Arm a workbench's engine, waiting up to maxFrames. */
  arm(bench, maxFrames) {
    this._s.arm(bench, maxFrames ?? null);
  }

  /** Advance a workbench to toMs on its clock, as Play would; where it stands. */
  advance(bench, toMs) {
    return this._s.advance(bench, toMs);
  }

  /** Frames until nothing waits, or maxFrames. */
  settle(maxFrames) {
    this._s.settle(maxFrames ?? null);
  }

  /** A workbench's open positions and pending orders. */
  book(bench) {
    const [home, owner, , name] = bench.replace('bentrix://', '').split('/');
    return this.read('trade_book', { home, owner, bench: name });
  }
}

/** The Gym (Gymnasium's contract): reset(seed) -> [obs, info]; step(a) -> [obs, reward, terminated, truncated, info]. */
class TradingEnv {
  constructor(local, bench, opts = {}) {
    this.local = local;
    const made = local.call('env_make', {
      bench,
      symbol: opts.symbol,
      interval: opts.interval ?? 'H1',
      window: opts.window ?? 32,
      action: opts.action ?? 'discrete',
      reward: opts.reward ?? 'dsr_dd_penalty@1',
      lots: opts.lots ?? 0.01,
      episode: opts.episode ?? 'window',
      episode_bars: opts.episodeBars ?? 200,
      participation: opts.participation,
      impact: opts.impact,
    });
    this.id = made.env;
    this.symbol = made.symbol;
  }

  reset(seed) {
    const got = this.local.call('env_reset', { env: this.id, seed });
    return [got.obs, got.info];
  }

  step(action) {
    const got = this.local.call('env_step', { env: this.id, action });
    return [got.obs, got.reward, got.terminated, got.truncated, got.info];
  }

  close() {
    try {
      this.local.call('env_close', { env: this.id });
    } catch (_) {
      /* already gone */
    }
  }
}

module.exports = {
  Local,
  TradingEnv,
  makeTape: (directory) => native.makeTape(directory),
  intervalMs: (label) => native.intervalMs(label),
  build: () => native.build(),
};
