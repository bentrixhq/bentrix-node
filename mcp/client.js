'use strict';
/*
 * The hand-written half of BENTRIX's JavaScript client: the connection and everything that does not
 * change when a capability is added (generated.js is the rest, from the catalogue). It speaks MCP
 * revision 2026-07-28 over Streamable HTTP with Node's own fetch (Node 18 and later): every request is
 * its own POST carrying the protocol version, the client's identity and its (empty) capabilities in
 * _meta - the same wire as the Python client's _runtime.py, field for field.
 *
 * connect() finds the running application through endpoint.json in BENTRIX's agents folder, pairs with
 * it through local.secret under a name of this process, and connects with the token it gets.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const PROTOCOL_VERSION = '2026-07-28';
const CLIENT_NAME = 'bentrix-node-sdk';
const CLIENT_VERSION = '0.1.0';
const ENDPOINT_FILE = 'endpoint.json';
const SECRET_FILE = 'local.secret';
// **Busy, try again**: the JSON-RPC code Bentrix answers when it refused a request BEFORE doing
// anything with it — one program's 20 calls a second spent, too many connections or streams, a task
// it could not read in time. Nothing ran, so the same request is sent again after the wait the
// answer names (retryAfterMs, a second when none), at most BUSY_RETRIES times and each wait at most
// BUSY_WAIT_MAX_MS; then the refusal is thrown. An order is never sent twice by this.
const BUSY = -40001;
const BUSY_RETRIES = 10;
const BUSY_WAIT_MAX_MS = 5000;

function busyWaitMs(data) {
  const ms = data && typeof data.retryAfterMs === 'number' && data.retryAfterMs > 0 ? data.retryAfterMs : 1000;
  return Math.min(ms, BUSY_WAIT_MAX_MS);
}

class BentrixError extends Error {}
/** A JSON-RPC error: the request itself was refused. */
class RpcError extends BentrixError {
  constructor(code, message, data) {
    super(`[${code}] ${message}`);
    this.code = code;
    this.data = data;
  }
}
/**
 * A tool ran and answered isError: the product's own sentence, verbatim. `machine` is the server's
 * word for the kind (busy, expired, insufficient_scope...) when it gave one.
 */
class ToolError extends BentrixError {
  constructor(tool, message, machine) {
    super(`${tool}: ${message}`);
    this.tool = tool;
    this.machine = machine;
  }
}
/**
 * A stream's clock went back behind the cursor (a laboratory's rewind): what came after it will come
 * again. `watch` ends with this rather than handing those items twice as if new; `cursor` is where to
 * read on from (`after`).
 */
class Rewound extends BentrixError {
  constructor(uri, cursor) {
    super(`${uri}: the workbench's clock went back; read on from ${cursor}`);
    this.uri = uri;
    this.cursor = cursor;
  }
}
/** A stream's call answered with one of these is asked again, after a pause. */
const PASSING = ['busy', 'expired'];
const PASSING_TRIES = 5;
const PASSING_PAUSE_MS = 500;
class NotRunning extends BentrixError {}
class PairingRefused extends BentrixError {}
class IncompatibleCatalogue extends BentrixError {}
class JobFailed extends BentrixError {}

/**
 * A call that asks the server to wait is given that long and 15 s more (found 2026-11-02: wait_for
 * beyond the client's own timeout ended in the client before the server could answer).
 */
const LONG_POLL_MARGIN_MS = 15000;
function requestTimeoutMs(base, args) {
  const wait = args && args.timeout_ms;
  return typeof wait === 'number' ? Math.max(base, wait + LONG_POLL_MARGIN_MS) : base;
}

/** Leave out what is null or undefined, so the server's own default applies. */
function plain(args) {
  const out = {};
  for (const [k, v] of Object.entries(args || {})) if (v !== null && v !== undefined) out[k] = v;
  return out;
}

/** A header value, or the standard Base64 sentinel when plain ASCII cannot carry it. */
function headerValue(v) {
  const safe = /^[\x20-\x7e]*$/.test(v) && v === v.trim() && !(v.startsWith('=?base64?') && v.endsWith('?='));
  return safe ? v : `=?base64?${Buffer.from(v, 'utf8').toString('base64')}?=`;
}

/** The RFC 6570 subset the catalogue uses: {name} and {?a,b}. A null optional is left out. */
function expandTemplate(template, vars) {
  const values = plain(vars);
  const scalar = (v) => (typeof v === 'boolean' ? (v ? 'true' : 'false') : String(v));
  return template.replace(/\{([?&]?)([^}]+)\}/g, (_, op, names) => {
    if (op) {
      const pairs = names.split(',').filter((n) => n in values).map((n) => `${n}=${encodeURIComponent(scalar(values[n]))}`);
      return pairs.length ? op + pairs.join('&') : '';
    }
    if (!(names in values)) throw new Error(`the URI template ${template} needs ${names}`);
    return encodeURIComponent(scalar(values[names]));
  });
}

/** A long operation: wait() answers its result once it completes (the person may act first). */
class Job {
  constructor(client, handle, result) {
    this._c = client;
    this.handle = handle;
    this._result = result;
  }

  async status() {
    return this.handle === null ? { status: 'completed' } : this._c.call('job_get', { job: this.handle });
  }

  async cancel() {
    if (this.handle !== null) await this._c.call('job_cancel', { job: this.handle });
  }

  async wait({ timeoutMs, pollMs = 500 } = {}) {
    if (this.handle === null) return this._result;
    const deadline = timeoutMs === undefined ? null : Date.now() + timeoutMs;
    for (;;) {
      const st = await this.status();
      if (st.status === 'completed') return st.result ?? {};
      if (st.status === 'failed' || st.status === 'cancelled') throw new JobFailed(`job ${this.handle} ${st.status}: ${st.message ?? ''}`);
      if (deadline !== null && Date.now() >= deadline) throw new Error(`job ${this.handle} is still ${st.status}`);
      await new Promise((r) => setTimeout(r, pollMs));
    }
  }
}

function parseVersion(text) {
  const p = String(text).split('.');
  if (p.length !== 3 || !p.every((x) => /^\d+$/.test(x))) throw new IncompatibleCatalogue(`${text} is not a version major.minor.patch`);
  return p.map(Number);
}

/** One BENTRIX endpoint. Subclassed by the generated Bentrix. */
class Client {
  constructor(url, token, { catalogueVersion, timeoutMs = 60000 } = {}) {
    this.url = url;
    this._token = token;
    this._timeoutMs = timeoutMs;
    this.catalogueVersion = catalogueVersion;
    this._id = 0;
  }

  // One request, sent again while Bentrix answers busy (BUSY): it ran nothing.
  async _rpc(method, params, name, timeoutMs) {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this._rpcOnce(method, params, name, timeoutMs);
      } catch (e) {
        if (!(e instanceof RpcError) || e.code !== BUSY || attempt >= BUSY_RETRIES) throw e;
        await new Promise((r) => setTimeout(r, busyWaitMs(e.data)));
      }
    }
  }

  async _rpcOnce(method, params, name, timeoutMs) {
    const body = {
      jsonrpc: '2.0',
      id: ++this._id,
      method,
      params: {
        ...params,
        _meta: {
          'io.modelcontextprotocol/protocolVersion': PROTOCOL_VERSION,
          'io.modelcontextprotocol/clientInfo': { name: CLIENT_NAME, version: CLIENT_VERSION },
          'io.modelcontextprotocol/clientCapabilities': {},
        },
      },
    };
    const headers = {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      'MCP-Protocol-Version': PROTOCOL_VERSION,
      'Mcp-Method': method,
      Authorization: `Bearer ${this._token}`,
    };
    if (name !== undefined) headers['Mcp-Name'] = headerValue(name);
    const resp = await fetch(this.url, { method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs || this._timeoutMs) });
    const text = await resp.text();
    let message;
    if ((resp.headers.get('content-type') || '').startsWith('text/event-stream')) {
      message = readSse(text, body.id);
    } else {
      try {
        message = JSON.parse(text);
      } catch (_) {
        throw new RpcError(resp.status, `HTTP ${resp.status} with no JSON-RPC body`);
      }
    }
    if (message.error) throw new RpcError(message.error.code ?? resp.status, message.error.message ?? '', message.error.data);
    return message.result;
  }

  /** A tool by its wire name; null and undefined arguments are left out. */
  async call(name, args) {
    const a = plain(args);
    const res = await this._rpc('tools/call', { name, arguments: a }, name, requestTimeoutMs(this._timeoutMs, a));
    if (res.resultType === 'input_required') throw new BentrixError(`${name} needs input this client cannot give; answer it in BENTRIX's window`);
    const text = (res.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('');
    if (res.isError) throw new ToolError(name, text || 'the tool failed', (res._meta || {})['bentrix/machine']);
    if (res.structuredContent !== undefined && res.structuredContent !== null) return res.structuredContent;
    try {
      return text ? JSON.parse(text) : {};
    } catch (_) {
      return {};
    }
  }

  /** A long operation: a Job whether the server answered at once or with a handle. */
  async callJob(name, args) {
    const raw = await this.call(name, args);
    const keys = Object.keys(raw || {});
    return keys.length === 1 && keys[0] === 'job' && typeof raw.job === 'string' ? new Job(this, raw.job) : new Job(this, null, raw);
  }

  async _readUri(uri) {
    const res = await this._rpc('resources/read', { uri }, uri);
    const contents = res.contents || [];
    if (!contents.length || typeof contents[0].text !== 'string') throw new BentrixError(`${uri} answered no text content`);
    return JSON.parse(contents[0].text);
  }

  readResource(template, vars) {
    return this._readUri(expandTemplate(template, vars));
  }

  /** Every page of a cursor-paged resource: next is the URI of the following page. */
  async *readPages(template, vars) {
    let uri = expandTemplate(template, vars);
    while (uri) {
      const page = await this._readUri(uri);
      yield page;
      uri = page.next;
    }
  }

  /**
   * Items of a stream, forever: wait_for long-polls, a page is { items, next }. A call answered busy
   * or expired is asked again (five times, half a second apart); a page saying rewound ends the stream
   * with Rewound, carrying the cursor to read on from (the strict audit of 2026-11-04, S3/S4).
   */
  async *watch(template, vars, { after, timeoutMs = 30000 } = {}) {
    const uri = expandTemplate(template, vars);
    let cursor = after;
    for (;;) {
      let page;
      for (let attempt = 0; ; attempt++) {
        try {
          page = await this.call('wait_for', { uri, timeout_ms: timeoutMs, after: cursor });
          break;
        } catch (e) {
          if (!(e instanceof ToolError) || !PASSING.includes(e.machine) || attempt >= PASSING_TRIES - 1) throw e;
          await new Promise((r) => setTimeout(r, PASSING_PAUSE_MS));
        }
      }
      for (const item of page.items || []) yield item;
      if (page.next !== undefined && page.next !== null) cursor = page.next;
      if (page.rewound) throw new Rewound(uri, cursor);
    }
  }

  /** Refuse a server on another major line of the catalogue. */
  async verifyCatalogue() {
    const me = await this.call('agent_whoami', {});
    const server = me.catalogue_version;
    if (parseVersion(server)[0] !== parseVersion(this.catalogueVersion)[0]) {
      throw new IncompatibleCatalogue(`this SDK was generated from catalogue ${this.catalogueVersion}; the server's is ${server}`);
    }
    return server;
  }

  close() {}
}

/** The final response on a request-scoped event stream; notifications before it are ignored. */
function readSse(text, id) {
  let data = [];
  for (const line of text.split(/\r?\n/)) {
    if (line === '') {
      if (data.length) {
        try {
          const msg = JSON.parse(data.join('\n'));
          if (msg.id === id && ('result' in msg || 'error' in msg)) return msg;
        } catch (_) {
          /* not ours */
        }
      }
      data = [];
    } else if (line.startsWith('data:')) {
      data.push(line.slice(5).trimStart());
    }
  }
  throw new BentrixError('the stream ended without a response');
}

/** The folder BENTRIX writes its endpoint and secret into - user_dir(Data, "agents"), as the application has it. */
function agentsDir() {
  if (process.env.LOCALAPPDATA) return path.join(process.env.LOCALAPPDATA, 'BENTRIX', 'agents');
  if (process.env.HOME) return path.join(process.env.HOME, '.local', 'share', 'bentrix', 'agents');
  return 'bentrix-agents';
}

function readEndpoint(folder) {
  const file = path.join(folder, ENDPOINT_FILE);
  let doc;
  try {
    doc = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (_) {
    throw new NotRunning(`BENTRIX is not running: there is no readable ${ENDPOINT_FILE} in ${folder}`);
  }
  if (typeof doc.url !== 'string' || !doc.url.startsWith('http://127.0.0.1:') || !Number.isInteger(doc.pid)) throw new NotRunning(`BENTRIX is not running: ${file} is not an endpoint file`);
  try {
    process.kill(doc.pid, 0);
  } catch (e) {
    if (e.code === 'ESRCH') throw new NotRunning(`BENTRIX is not running: ${file} is stale (process ${doc.pid} has ended)`);
  }
  return doc;
}

function readSecret(folder) {
  let secret;
  try {
    secret = fs.readFileSync(path.join(folder, SECRET_FILE), 'utf8').trim();
  } catch (_) {
    throw new PairingRefused(`there is no readable ${SECRET_FILE} in ${folder}: BENTRIX writes it at every start`);
  }
  if (!secret) throw new PairingRefused(`${SECRET_FILE} is empty`);
  return secret;
}

/** The name this process pairs under: BENTRIX_AGENT_NAME, else the script's name. */
function defaultName() {
  if ((process.env.BENTRIX_AGENT_NAME || '').trim()) return process.env.BENTRIX_AGENT_NAME.trim();
  const script = process.argv[1] ? path.basename(process.argv[1]) : '';
  return script ? `${CLIENT_NAME} (${script})` : CLIENT_NAME;
}

/** Present the secret to <url>/pair and answer the token. The secret travels in this one body. */
async function pair(url, secret, name) {
  const resp = await fetch(url.replace(/\/$/, '') + '/pair', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ secret, client: { name } }) });
  let doc = {};
  try {
    doc = await resp.json();
  } catch (_) {
    /* no body */
  }
  if (!resp.ok) {
    const code = doc.error?.code ?? '';
    if (code === 'wrong_secret') throw new PairingRefused('BENTRIX refused the secret in the secret file: it writes a new secret at every start');
    throw new PairingRefused(`BENTRIX answered the pairing request with HTTP ${resp.status} ${code}: ${doc.error?.message ?? ''}`);
  }
  if (typeof doc.token !== 'string' || !doc.token) throw new PairingRefused('BENTRIX answered the pairing request with no token');
  return doc.token;
}

/** Find the running application and get a token: { url, token }. */
async function discover({ agentsFolder, name } = {}) {
  const folder = agentsFolder || agentsDir();
  const { url } = readEndpoint(folder);
  return { url, token: await pair(url, readSecret(folder), name || defaultName()) };
}

module.exports = {
  Client, Job, plain, expandTemplate, agentsDir, readEndpoint, readSecret, pair, discover, defaultName,
  BentrixError, RpcError, ToolError, Rewound, NotRunning, PairingRefused, IncompatibleCatalogue, JobFailed,
  PROTOCOL_VERSION, ENDPOINT_FILE, SECRET_FILE, BUSY, BUSY_RETRIES, BUSY_WAIT_MAX_MS,
};
