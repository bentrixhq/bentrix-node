// **A forecast's builder and an evaluation's sheet**: an element form names no interval and carries its
// rule; the run, the decline and the failure are three answers, another ask's moves skipped.
//
//   node --test sdk/node/test/forecast.test.js
//
// Mutations (2026-11-08), each red: spec writing timeframe whatever it is (the element form named an interval);
// declined read as a failure (a decline was EvalFailed).
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { Forecast, evalStarted, DeclinedByThePerson, EvalFailed, EVAL_EVENT } = require('../mcp/forecast.js');

test('an element forecast names no interval and carries its rule', () => {
  const f = Forecast.ofElements('bricks', 'EURUSD', 'renko', 1700000000000, { renko_box: 0.0005, renko_reversal: 2 });
  f.step(1.1005, { expectedMs: 1700000600000 });
  const d = f.spec();
  assert.deepStrictEqual(d.form, { chart_type: 'renko', elements: { renko_box: 0.0005, renko_reversal: 2 } });
  assert.strictEqual(d.steps[0].expected_ms, 1700000600000);
  assert.deepStrictEqual(new Forecast('m', 'EURUSD', 'H1', 0).step(1).spec().form, { chart_type: 'candlestick', timeframe: 'H1' });
});

function sheet(pages) {
  const asked = [];
  return {
    asked,
    async call(name, args) {
      assert.strictEqual(name, 'wait_for');
      assert.strictEqual(args.uri, EVAL_EVENT);
      asked.push(args.after);
      const items = pages.shift() || [];
      return { items, next: String(Number(args.after) + items.length) };
    },
  };
}

test('an eval sheet is waited on and a decline is not a failure', async () => {
  assert.strictEqual(await evalStarted(sheet([]), { eval: 7 }), 7);
  const ask = { ask: 'bentrix://ask/2', watch: 'bentrix://forecasts/eval?after=0' };
  const s = sheet([
    [{ ask: 'bentrix://ask/1', state: 'declined' }, { ask: 'bentrix://ask/2', state: 'asked' }],
    [{ ask: 'bentrix://ask/2', state: 'made_laboratory' }],
    [{ ask: 'bentrix://ask/2', state: 'started', eval: 11 }],
  ]);
  assert.strictEqual(await evalStarted(s, ask, { idleLimit: 3 }), 11);
  assert.deepStrictEqual(s.asked, ['0', '2', '3']);
  await assert.rejects(evalStarted(sheet([[{ ask: 'bentrix://ask/2', state: 'declined', by: 'the person' }]]), ask, { idleLimit: 3 }), DeclinedByThePerson);
  await assert.rejects(
    evalStarted(sheet([[{ ask: 'bentrix://ask/2', state: 'failed', why: 'the laboratory was not made' }]]), ask, { idleLimit: 3 }),
    (e) => e instanceof EvalFailed && e.why === 'the laboratory was not made',
  );
  await assert.rejects(evalStarted(sheet([]), ask, { idleLimit: 2 }), /no answer on the sheet/);
});
