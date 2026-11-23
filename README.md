# Bentrix SDK for JavaScript

The JavaScript client of [Bentrix](https://bentrix.net) — charts, a replay laboratory and trading through your own MetaTrader — for a program or an agent.

It finds the Bentrix running on this computer through the agents folder Bentrix writes at every start, pairs with it under the name you give — the name you see in ☰ › Settings › **Agents**, where the pairing's permissions are set — and calls every tool of Bentrix's capability catalogue over MCP. Nothing is typed: no address, no key.

The client is generated from the catalogue of the Bentrix release it came with, and checks when it connects that the running Bentrix serves the same major version.

## What you need

Node.js 16 or later, and Bentrix open on the same computer. The client depends on nothing.

## Install

```bash
npm install bentrix
```

Or from a clone of this repository, by its path: `require('./bentrix-node/mcp')` in place of `require('bentrix/mcp')` below.

## Connect

```javascript
const { connect, ToolError } = require('bentrix/mcp');

(async () => {
  const b = await connect({ name: 'my-agent' });
  const state = await b.workspace.getState({});
  const bench = state.laboratories[0].benches[0].uri;
  const [home, owner, , name] = bench.replace('bentrix://', '').split('/');
  const book = await b.trade.book({ home, owner, bench: name });
  console.log(book.positions.length, 'positions open');
})();
```

TypeScript declarations are beside the code (`mcp/generated.d.ts`, `index.d.ts`).

## The engine in your own process

`require('bentrix')` — `Local` and the Gym's `TradingEnv` — runs Bentrix's engine inside your program, with no window, through the FFI package `koffi`:

```bash
npm install bentrix koffi
```

```javascript
const { Local, TradingEnv } = require('bentrix');
```

The engine is Bentrix's own library, `libbentrix`, which Bentrix's installer puts in its folder (`%LOCALAPPDATA%\Programs\BENTRIX\libbentrix.dll` on Windows) and the binding finds there; `BENTRIX_FFI` (the file) or `BENTRIX_FFI_DIR` (its folder) names another. It runs for a computer signed in to Bentrix with Plus or Pro; with Free, connect to the running application as above.

## Documentation

Every method, its arguments, the permission it needs and what it answers: **https://bentrix.net/en/docs/sdk/javascript/**

## Licence

MIT — see [LICENSE](https://github.com/bentrixhq/bentrix-node/blob/main/LICENSE). It covers this source code only: Bentrix's engine library (`libbentrix`) and the Bentrix application are Bentrix's own, under their own terms.
