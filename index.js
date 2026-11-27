'use strict';
/*
 * Bentrix in your own Node.js process: the engine's tools answered in-process by the same names and shapes as over
 * MCP - read, laboratory and paper, never a real account. Its Gym is a client of Bentrix's own environment (env_make,
 * env_reset, env_step), the one every language reaches.
 *
 * The engine is Bentrix's own library, libbentrix (shipped compiled with the application; it runs for Plus and
 * Pro), reached through its C functions (bentrix.h) with the FFI package koffi (`npm install koffi`) - the one thing
 * this half needs that Node does not carry. Where the library is looked for: the file BENTRIX_FFI names, libbentrix
 * in the folder BENTRIX_FFI_DIR names, on Windows Bentrix's own folder (%LOCALAPPDATA%\Programs\BENTRIX), the
 * system's library path. Nothing is loaded until a Local, makeTape, intervalMs or build is first used, so the MCP
 * client beside this file never needs either.
 */
const fs = require('fs');
const path = require('path');

const NAME = process.platform === 'win32' ? 'libbentrix.dll' : process.platform === 'darwin' ? 'libbentrix.dylib' : 'libbentrix.so';

function candidates() {
  const out = [];
  if (process.env.BENTRIX_FFI) out.push(process.env.BENTRIX_FFI);
  if (process.env.BENTRIX_FFI_DIR) out.push(path.join(process.env.BENTRIX_FFI_DIR, NAME));
  if (process.platform === 'win32' && process.env.LOCALAPPDATA) out.push(path.join(process.env.LOCALAPPDATA, 'Programs', 'BENTRIX', NAME));
  out.push(NAME);
  return out;
}

let engine = null;

/** The library's functions, loaded once on first use. */
function lib() {
  if (engine) return engine;
  let koffi;
  try {
    koffi = require('koffi');
  } catch (_) {
    throw new Error("Bentrix's engine in this process is reached through the koffi package: npm install koffi");
  }
  const tried = [];
  let handle = null;
  for (const file of candidates()) {
    if (file.includes(path.sep) && !fs.existsSync(file)) {
      tried.push(file);
      continue;
    }
    try {
      handle = koffi.load(file);
      break;
    } catch (e) {
      tried.push(`${file} (${e.message})`);
    }
  }
  if (!handle) {
    throw new Error(`Bentrix's engine library (${NAME}) was not found. It is installed with Bentrix; or set BENTRIX_FFI to the file, or BENTRIX_FFI_DIR to its folder. Looked at: ${tried.join('; ')}`);
  }
  const f = (sig) => handle.func(sig);
  // **The engine's interface this package speaks** (bx_abi): a library of
  // another one is refused here, before bx_open, in a sentence naming both; one from before bx_abi (0.1.382) is 1.
  let have = 1;
  try {
    have = f('uint32_t bx_abi()')();
  } catch (e) {
    have = 1;
  }
  if (have !== ABI) {
    const built = f('const char *bx_version()')();
    throw new Error(`Bentrix's engine library speaks interface ${have} (Bentrix ${built}) and this package speaks ${ABI}: ${have < ABI ? 'update Bentrix' : 'update this package'}.`);
  }
  engine = {
    koffi,
    version: f('const char *bx_version()'),
    lastError: f('const char *bx_last_error()'),
    free: f('void bx_free(void *p)'),
    open: f('void *bx_open(const char *workspace, const char *store, const char *client)'),
    close: f('void bx_close(void *s)'),
    call: f('void *bx_call(void *s, const char *tool, const char *args)'),
    read: f('void *bx_read(void *s, const char *resource, const char *vars)'),
    arm: f('int bx_arm(void *s, const char *bench, size_t max_frames)'),
    advance: f('int bx_advance(void *s, const char *bench, int64_t to_ms, _Out_ int64_t *reached)'),
    settle: f('int bx_settle(void *s, size_t max_frames)'),
    intervalMs: f('int64_t bx_interval_ms(const char *label)'),
    makeTape: f('int bx_make_tape(const char *directory, _Out_ void **workspace, _Out_ void **store)'),
  };
  return engine;
}

/** The engine's interface this package speaks (`bx_abi`, `bentrix.h`'s `BX_ABI`). */
const ABI = 2;

/** Bentrix's own words for the last failure on this thread, thrown. */
function fail() {
  throw new Error(lib().lastError() || 'Bentrix answered with no words');
}

/** An owned answer read and handed back to the library; NULL thrown in Bentrix's words. */
function text(p) {
  const e = lib();
  if (!p) fail();
  try {
    return e.koffi.decode(p, 'char', -1);
  } finally {
    e.free(p);
  }
}

function ok(code) {
  if (code !== 0) fail();
}

/** A session over the library, in the shape the Local below calls. */
class Session {
  constructor(workspace, store) {
    this.s = lib().open(workspace, store, 'Node.js');
    if (!this.s) fail();
  }
  call(tool, args) {
    return text(lib().call(this.s, tool, args));
  }
  read(resource, vars) {
    return text(lib().read(this.s, resource, vars));
  }
  arm(bench, maxFrames) {
    ok(lib().arm(this.s, bench, maxFrames ?? 20000));
  }
  advance(bench, toMs) {
    const reached = [0];
    ok(lib().advance(this.s, bench, toMs, reached));
    return Number(reached[0]);
  }
  settle(maxFrames) {
    ok(lib().settle(this.s, maxFrames ?? 1000));
  }
  close() {
    if (this.s) lib().close(this.s);
    this.s = null;
  }
}

const native = {
  Session,
  makeTape(directory) {
    const ws = [null];
    const store = [null];
    ok(lib().makeTape(directory, ws, store));
    return [text(ws[0]), text(store[0])];
  },
  intervalMs(label) {
    const n = Number(lib().intervalMs(label));
    return n || null;
  },
  build() {
    return lib().version();
  },
};

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

  /** Close the session: the workspace persisted and let go, so it opens again. Closing twice is nothing. */
  close() {
    this._s.close();
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
