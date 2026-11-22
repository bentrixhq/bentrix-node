'use strict';
/*
 * The Node.js binding's walk on the CI tape - the engine (a second session refused, thirty hours
 * advanced, a market order filled, the book read, a refusal thrown in its words) and a Gym episode
 * (seed 5, window 8, 12 candles, twelve fixed actions) printed as JSON for test_crosslang.py.
 *
 *   node sdk/node/walk.js <empty directory>
 */
const { Local, TradingEnv, makeTape, intervalMs, build } = require('./index.js');

function check(held, what) {
  if (!held) throw new Error(`FAILED: ${what}`);
}

const dir = process.argv[2];
if (!dir) {
  console.error('usage: walk.js <empty directory>');
  process.exit(2);
}
console.log(`bentrix ${build()}`);
const [ws, store] = makeTape(dir);
const local = new Local(ws, store);
let refusedSecond = false;
try {
  new Local(ws, store);
} catch (e) {
  refusedSecond = true;
  console.log(`a second session refused: ${e.message}`);
}
check(refusedSecond, 'a second session on the held workspace was not refused');
const bench = local.call('get_state').laboratories[0].benches[0].uri;
local.arm(bench);
const from = local.call('replay_step', { bench, unit: 'tick', n: 1 }).cursor_ms;
let reached = local.advance(bench, from + 30 * 3600000);
check(reached >= from + 30 * 3600000, 'the workbench did not advance');
local.call('order_market', { bench, symbol: 'XAUUSD', side: 'buy', volume: 0.01 });
reached = local.advance(bench, reached + 60000);
const positions = local.book(bench).positions;
check(positions.length === 1 && positions[0].side === 'buy', `the order did not fill: ${JSON.stringify(positions)}`);
let said = '';
try {
  local.call('no_such_tool');
} catch (e) {
  said = String(e.message);
}
check(said.includes('no_such_tool'), `a refusal did not say its tool: ${said}`);
check(intervalMs('H1') === 3600000, 'H1 is not an hour');

const env = new TradingEnv(local, bench, { interval: 'H1', window: 8, episode: 'window', episodeBars: 12 });
const actions = [1, 1, 2, 0, 2, 2, 1, 0, 1, 2, 0, 1];
const [obs, info] = env.reset(5);
check(obs.market.length === 8 && obs.account.length === 3, 'the observation is not shaped as declared');
const rewards = [];
const hashes = [info.ledger_hash];
for (const a of actions) {
  const [, r, term, trunc, step] = env.step(a);
  rewards.push(r);
  hashes.push(step.ledger_hash);
  if (term || trunc) break;
}
check(new Set(hashes).size > 1, 'the episode traded nothing');
env.close();
console.log(JSON.stringify({ start_ms: info.start_ms, rewards, hashes }));
console.log('PASS');
