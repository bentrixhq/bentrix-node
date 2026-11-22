# Bentrix SDK for JavaScript

The JavaScript client of [Bentrix](https://bentrix.net) — charts, a replay laboratory and trading through your own MetaTrader — for a program or an agent.

It finds the Bentrix running on this computer through the agents folder Bentrix writes at every start, pairs with it under the name you give — the name you see in ☰ › Settings › **Agents**, where the pairing's permissions are set — and calls every tool of Bentrix's capability catalogue over MCP. Nothing is typed: no address, no key.

The client is generated from the catalogue of the Bentrix release it came with, and checks when it connects that the running Bentrix serves the same major version.

## What you need

Node.js 16 or later, and Bentrix open on the same computer. Nothing from npm.

## Install

Clone this repository and require the client by its path:

```javascript
const { connect } = require('./bentrix-node/mcp');
```

## Connect

```javascript
const { connect, ToolError } = require('./bentrix-node/mcp');

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

`index.js` and its Gym (the in-process engine) use Bentrix's engine library, which is not part of this repository.

## Documentation

Every method, its arguments, the permission it needs and what it answers: **https://bentrix.net/en/docs/sdk/javascript/**

## Licence

MIT — see [LICENSE](LICENSE). It covers this source code only. Bentrix's engine library that some of these bindings load (`libbentrix`), and the Bentrix application, are Bentrix's own and distributed under their own terms.
