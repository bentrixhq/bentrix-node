// **Model outputs of every kind and the person's meaning**: every kind builds a document Bentrix reads; a
// value outside its declared range is refused in words before anything is sent; three examples are three
// meanings; a put never sends an arrival.
//
//   node --test sdk/node/test/output.test.js
//
// Mutation (2026-11-11), red: inRange not comparing - a 1.3 for a 0..1 output was sent.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { Output, Meaning, putOutputs, setMeaning, KINDS } = require('../mcp/output.js');

function recorder() {
  const calls = [];
  return { calls, call: async (name, args) => { calls.push([name, args]); return { ok: true }; } };
}

test('every kind builds a document Bentrix reads - the twelve, pinned', () => {
  const built = [
    Output.scalar('m1', 'o1', 'EURUSD', 1, 0.7, { range: [0, 1] }),
    Output.classes('m1', 'o1', 'EURUSD', 1, ['up', 'down'], [{ up: 0.6, down: 0.4 }]),
    Output.quantiles('m1', 'o1', 'EURUSD', 1, [0.1, 0.9], [{ '0.1': 1.0, '0.9': 1.2 }]),
    Output.rank('m1', 'o1', 'AAPL', 1, 4871, 0.62),
    Output.position('m1', 'o1', 'EURUSD', 1, -0.5),
    Output.weights('m1', 'o1', 'EURUSD', 1, { EURUSD: 0.6, GBPUSD: 0.4 }),
    Output.event('m1', 'o1', 'EURUSD', 1, 0.8, { withinSteps: 3 }),
    Output.levels('m1', 'o1', 'EURUSD', 1, { stop: 1.09, target: 1.12 }),
    Output.action('m1', 'o1', 'EURUSD', 1, 'buy', { size: 0.5 }),
    Output.text('m1', 'o1', 'EURUSD', 1, 'the trend held'),
    Output.series('m1', 'o1', 'EURUSD', 1, ['a'], [{ a: 1 }]),
  ];
  const kinds = new Set(['path']);
  for (const o of built) { o.check(); JSON.stringify(o.spec()); kinds.add(o.kind); }
  assert.strictEqual(KINDS.length, 12);
  assert.strictEqual(kinds.size, 12, 'the builders do not cover the twelve kinds');
});

test('a value outside its declared range is refused in words before anything is sent', async () => {
  const r = recorder();
  await assert.rejects(Output.scalar('m1', 'o1', 'EURUSD', 1, 1.3, { range: [0, 1] }).put(r, 'bench'), /0 to 1; 1.3 is outside it/);
  assert.strictEqual(r.calls.length, 0, 'something was sent');
  assert.throws(() => Output.rank('m1', 'o1', 'AAPL', 1, 10, 1.5).check(), /outside it/);
});

test("three examples are three meanings; profit is not a word", async () => {
  const r = recorder();
  for (const m of [
    new Meaning({ highMeans: 'buy', lowMeans: 'sell', actAbove: 0.6, actBelow: 0.4 }),
    new Meaning({ highMeans: 'buy', lowMeans: 'nothing', actAbove: 0.6 }),
    new Meaning({ highMeans: 'sell', lowMeans: 'nothing', actAbove: 0.6 }),
  ]) await setMeaning(r, 'bench', 'm1', 'o1', m, [0, 1]);
  assert.strictEqual(r.calls[2][0], 'output_meaning_set');
  assert.strictEqual(r.calls[2][1].meaning.high_means, 'sell');
  await assert.rejects(setMeaning(r, 'bench', 'm1', 'o1', new Meaning({ highMeans: 'profit' }), [0, 1]));
  await assert.rejects(setMeaning(r, 'bench', 'm1', 'o1', new Meaning({ highMeans: 'buy', actAbove: 1.5 }), [0, 1]));
});

test('put and putOutputs send the document and never an arrival', async () => {
  const r = recorder();
  await Output.scalar('m1', 'dir', 'EURUSD', 1, 0.7, { range: [0, 1] }).steps(4).put(r, 'bench');
  await putOutputs(r, 'bench', [Output.event('m1', 'e', 'EURUSD', 1, 0.9)], true);
  const [name, args] = r.calls[0];
  assert.strictEqual(name, 'output_put');
  assert.deepStrictEqual(args.output.horizon, { steps: 4 });
  assert.ok(!('put_ms' in args.output), 'an arrival was sent');
  assert.strictEqual(r.calls[1][0], 'output_put_many');
  assert.strictEqual(r.calls[1][1].all_or_nothing, true);
});
