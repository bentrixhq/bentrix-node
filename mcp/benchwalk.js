'use strict';
/*
 * The JavaScript Bench's walk against a running Bentrix (bentrix --serve over a practice tape): the common tasks -
 * a refusal read as an answer, a step, a buy with a stop and a target, a modify, a part closed, close_all, the
 * account and the deals - through bench.js, the layer generated from the Bench table. What it saw is printed as
 * JSON for sdk/python/tests/test_bench.py, which holds it to the engine's own walk over the same tape.
 *
 *   LOCALAPPDATA=<the serve's> node sdk/node/mcp/benchwalk.js                   (a running Bentrix)
 *   BENTRIX_PRACTICE=<a practice folder> node sdk/node/mcp/benchwalk.js         (the engine in this process: koffi)
 */
const path = require('path');
const { connect, openBench } = require('./index.js');

function check(held, what) {
  if (!held) throw new Error(`FAILED: ${what}`);
}

(async () => {
  // One walk, either door: the engine in this process over a practice folder, or the running Bentrix.
  const practice = process.env.BENTRIX_PRACTICE;
  const local = practice ? new (require('../index.js').Local)(path.join(practice, 'ws'), path.join(practice, 'store')) : null;
  const b = local ? null : await connect({ name: 'node-bench' });
  const bench = await openBench(local || b);
  const markets = await bench.markets();
  check(markets.length === 1 && markets[0] === 'XAUUSD', `the markets: ${markets}`);
  const seen = {};
  const refused = await bench.buy(0.001);
  check(!refused.ok && refused.kind === 'volume_out_of_range', `the refusal: ${JSON.stringify(refused)}`);
  check(refused.reason && refused.remedy.includes('volume_min') && refused.docs.endsWith('go/concept.volume/'), `the refusal's words: ${JSON.stringify(refused)}`);
  seen.refused = [refused.outcome, refused.kind, refused.reason];
  const first = await bench.step({ interval: 'H1' });
  check(first && first.time > 0 && first.close > 0, `the first step: ${JSON.stringify(first)}`);
  seen.first = first;
  const group = await bench.group('walk');
  check(group === 1, `a group's number: ${JSON.stringify(group)}`);
  seen.group = group;
  const closed = await bench.bars({ interval: 'H1', limit: 5 });
  check(Array.isArray(closed) && closed.length === 1 && closed[0][0] === first.time, `the closed candles: ${JSON.stringify(closed)}`);
  seen.bars = [closed[0][0]];
  const q = await bench.quote();
  check(q && q.ask > q.bid, `the quote: ${JSON.stringify(q)}`);
  const sl = Math.round(q.ask - 30.0);
  const tp = Math.round(q.ask + 30.0);
  const bought = await bench.buy(0.1, { sl, tp });
  check(bought.ok, `the buy: ${JSON.stringify(bought)}`);
  await bench.step({ interval: 'H1' });
  const [position, ...more] = await bench.positions();
  check(position && !more.length && position.side === 'buy' && position.volume === 0.1 && position.sl === sl && position.tp === tp, `the position: ${JSON.stringify(position)}`);
  check((await bench.modify(position, { sl: sl + 5.0 })).ok, 'the modify');
  const [moved] = await bench.positions();
  check(moved.sl === sl + 5.0 && moved.tp === tp, `only what was named changes: ${JSON.stringify(moved)}`);
  check((await bench.close(moved, { lots: 0.04 })).ok, 'the part closed');
  await bench.step({ interval: 'H1' });
  const [rest] = await bench.positions();
  check(rest.volume === 0.06, `the rest: ${JSON.stringify(rest)}`);
  check((await bench.closeAll()).ok, 'close_all');
  await bench.step({ interval: 'H1' });
  check((await bench.positions()).length === 0, 'a position stayed');
  const nothing = await bench.closeAll();
  check(nothing.ok && nothing.raw.closed === 0, `close_all with nothing open: ${JSON.stringify(nothing.raw)}`);
  const account = await bench.account();
  check(account.equity === account.balance && account.balance !== 10000.0, `the account: ${JSON.stringify(account)}`);
  const deals = await bench.deals();
  const entries = deals.map((d) => d.entry);
  check(entries.filter((e) => e === 'in').length === 1 && entries.filter((e) => e === 'out').length === 2, `the deals: ${entries}`);
  const kept = await bench.keep('kept');
  check((await kept.positions()).length === 0, 'the kept workbench reads');
  // Past the days' end, advance stands at their last moment, by either door.
  seen.end = await bench.advance(4102444800000);
  check(Number.isInteger(seen.end) && seen.end > 0 && seen.end < 4102444800000, `the days' end: ${seen.end}`);
  if (b) {
    // A workbench resource by its address: the same book as by its three parts.
    const [home, owner, , name] = bench.uri.slice('bentrix://'.length).split('/');
    const byParts = JSON.stringify(await b.trade.book({ home, owner, bench: name }));
    check(JSON.stringify(await b.trade.book({ bench: bench.uri })) === byParts, 'the book by its address');
    check(JSON.stringify(await b.trade.book({ bench })) === byParts, 'the book by the workbench');
  }
  if (local) {
    // The engine's session is closed and its workspace let go: the same folder opens again in this process, and
    // holds what the walk did.
    local.close();
    const again = new (require('../index.js').Local)(path.join(practice, 'ws'), path.join(practice, 'store'));
    const reread = await (await openBench(again, bench.uri)).deals();
    check(reread.length === deals.length, `the workspace opened again after close: ${reread.length} deals`);
    again.close();
  }
  seen.deals = deals.map((d) => [d.entry, d.side, d.volume]);
  seen.balance = account.balance;
  console.log(JSON.stringify(seen));
  console.log('PASS');
})().catch((e) => {
  console.error(e.stack || String(e));
  process.exit(1);
});
