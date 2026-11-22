'use strict';
/*
 * A model's forecast on the chart, built by hand: the forecast_spec document step by step - a time form
 * (an interval) or an element form (a chart built by price: renko, kagi, line_break, point_figure, range_bars - no
 * interval, its rule in form.elements) - put through forecast_put; and an evaluation's sheet waited on:
 * forecast_eval_make's answer is the run at once, or an ask the person answers in Bentrix's window, watched on the
 * bentrix://forecasts/eval event. A forecast never names its arrival: Bentrix stamps put_ms.
 *
 * A caller is anything with call(name, args): the client, or a test's script.
 */

const EVAL_EVENT = 'bentrix://forecasts/eval';

class Forecast {
  /** A forecast of `timeframe`'s bars (null for an element form), anchored at the last closed bar's open. */
  constructor(model, symbol, timeframe, anchorMs, { chartType = 'candlestick', elements = null, epoch = 0, note = null, look = null } = {}) {
    Object.assign(this, { model, symbol, timeframe, anchorMs, chartType, elements, epoch, note, look, steps: [] });
  }

  /**
   * A forecast of a chart built by price: no interval; `elements` its rule ({ renko_box: 0.0005 }) where it is not
   * the chart's own. A step's expectedMs, given on every step or none, is what places it on a chart by time.
   */
  static ofElements(model, symbol, chartType, anchorMs, elements = null, opts = {}) {
    return new Forecast(model, symbol, null, anchorMs, { ...opts, chartType, elements });
  }

  /** One more bar. bands as [lo, hi, p?] or { lo, hi, p }; quantiles by level. */
  step(close, { open, high, low, volume, bands, quantiles, samples, expectedMs } = {}) {
    const s = { close: Number(close) };
    for (const [k, v] of [['open', open], ['high', high], ['low', low], ['volume', volume], ['expected_ms', expectedMs]]) {
      if (v !== undefined && v !== null) s[k] = v;
    }
    if (bands && bands.length) s.bands = bands.map((b) => (Array.isArray(b) ? { lo: b[0], hi: b[1], ...(b.length > 2 ? { p: b[2] } : {}) } : b));
    if (quantiles && Object.keys(quantiles).length) s.quantiles = Object.fromEntries(Object.entries(quantiles).map(([k, v]) => [String(k), Number(v)]));
    if (samples && samples.length) s.samples = samples.map(Number);
    this.steps.push(s);
    return this;
  }

  /** The forecast_spec document. */
  spec() {
    const form = { chart_type: this.chartType };
    if (this.timeframe !== null && this.timeframe !== undefined) form.timeframe = this.timeframe;
    if (this.elements) form.elements = { ...this.elements };
    const d = { schema_version: 1, model: this.model, symbol: this.symbol, form, anchor: { time_ms: this.anchorMs }, steps: this.steps, epoch: this.epoch };
    if (this.note !== null) d.note = this.note;
    if (this.look !== null) d.look = this.look;
    return d;
  }

  /** forecast_put: its arrival, its state, where it stands on each chart. */
  put(caller, bench) {
    return caller.call('forecast_put', { bench, forecast: this.spec() });
  }
}

/** forecast_put_many: several markets and models at one instant. */
function putMany(caller, bench, forecasts, allOrNothing = false) {
  return caller.call('forecast_put_many', { bench, forecasts: forecasts.map((f) => f.spec()), all_or_nothing: allOrNothing });
}

/** The person's No on the evaluation's sheet. Not a failure: nothing was made or fetched. */
class DeclinedByThePerson extends Error {
  constructor(ask) {
    super(`the person declined ${ask}`);
    this.ask = ask;
  }
}

/** A laboratory not made over the span, or a run that did not start on it, with Bentrix's why. */
class EvalFailed extends Error {
  constructor(ask, why) {
    super(why);
    this.ask = ask;
    this.why = why;
  }
}

/**
 * The run to drive, from forecast_eval_make's answer: its eval at once, or - over days the workbench's laboratory
 * does not hold - the person's answer on the sheet, watched on the eval event: started resolves to the run's id;
 * declined rejects with DeclinedByThePerson; failed with EvalFailed. No tool answers the sheet. idleLimit waits in a
 * row with no move of this ask reject the watch (never, when null).
 */
async function evalStarted(caller, made, { timeoutMs = 60000, idleLimit = null } = {}) {
  if (made.eval !== undefined && made.eval !== null) return Number(made.eval);
  const ask = made.ask;
  let uri = made.watch || EVAL_EVENT;
  let cursor = uri.includes('after=') ? uri.split('after=')[1].split('&')[0] : '0';
  uri = uri.split('{')[0].split('?')[0];
  for (let idle = 0; idleLimit === null || idle < idleLimit;) {
    const page = await caller.call('wait_for', { uri, after: cursor, timeout_ms: timeoutMs });
    if (page.next !== undefined && page.next !== null) cursor = page.next;
    let moved = false;
    for (const item of page.items || []) {
      if (item.ask !== ask) continue;
      moved = true;
      if (item.state === 'started') return Number(item.eval);
      if (item.state === 'declined') throw new DeclinedByThePerson(ask);
      if (item.state === 'failed') throw new EvalFailed(ask, item.why || 'the evaluation did not start');
    }
    idle = moved ? 0 : idle + 1;
  }
  throw new Error(`${ask}: no answer on the sheet`);
}

module.exports = { Forecast, putMany, evalStarted, DeclinedByThePerson, EvalFailed, EVAL_EVENT };
