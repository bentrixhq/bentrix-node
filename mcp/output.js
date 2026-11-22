'use strict';
/*
 * A model's output of any kind on the chart: the output_spec document built by hand for each of the twelve
 * kinds (path is Forecast's; here scalar, classes, quantiles, rank, position, weights, event, levels, action, text,
 * series), checked as Bentrix checks it - a value outside its declared range refused in words, never clamped - and
 * put through output_put; and the person's meaning (output_meaning) set through output_meaning_set, never in a
 * model's file. An output never names its arrival: Bentrix stamps put_ms.
 *
 * A caller is anything with call(name, args): the client, or a test's script.
 */

const KINDS = ['path', 'scalar', 'classes', 'quantiles', 'rank', 'position', 'weights', 'event', 'levels', 'action', 'text', 'series'];
const MEANING_WORDS = ['buy', 'sell', 'nothing', 'up', 'down', 'flat', 'in', 'out', 'close'];
const INTENTS = ['buy', 'sell', 'close_buys', 'close_sells', 'nothing'];
const LABEL = /^[a-z0-9_]{1,32}$/;

function inRange(field, v, range) {
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error(`${field} ${v} is not a number`);
  if (range && (v < range[0] || v > range[1])) throw new Error(`${field} the output answers ${range[0]} to ${range[1]}; ${v} is outside it`);
}

class Output {
  /** One output of `model` named `name` for `symbol`, anchored at `anchorMs`, of `kind`. */
  constructor(kind, model, name, symbol, anchorMs, fields = {}) {
    Object.assign(this, { kind, model, name, symbol, anchorMs, values: [], epoch: 0 }, fields);
  }

  static scalar(model, name, symbol, anchorMs, values, { range = null, units = null } = {}) {
    return new Output('scalar', model, name, symbol, anchorMs, { range, units, values: [].concat(values).map((value) => ({ value })) });
  }
  static classes(model, name, symbol, anchorMs, names, steps, { exclusive = true, softmax = false, persistent = false } = {}) {
    return new Output('classes', model, name, symbol, anchorMs, { names, exclusive, softmax, persistent, values: steps.map((p) => ({ p })) });
  }
  static quantiles(model, name, symbol, anchorMs, levels, steps, { units = null } = {}) {
    return new Output('quantiles', model, name, symbol, anchorMs, { levels, units, values: steps.map((q) => ({ q })) });
  }
  static rank(model, name, symbol, anchorMs, universe, value) {
    return new Output('rank', model, name, symbol, anchorMs, { universe, values: [{ value }] });
  }
  static position(model, name, symbol, anchorMs, target, { units = 'fraction', range = null } = {}) {
    return new Output('position', model, name, symbol, anchorMs, { units, range, values: [{ target }] });
  }
  static weights(model, name, symbol, anchorMs, w, { longOnly = true } = {}) {
    return new Output('weights', model, name, symbol, anchorMs, { long_only: longOnly, markets: Object.keys(w), values: [{ w }] });
  }
  static event(model, name, symbol, anchorMs, score, { withinSteps = null } = {}) {
    const v = { score };
    if (withinSteps) v.within_steps = withinSteps;
    return new Output('event', model, name, symbol, anchorMs, { values: [v] });
  }
  static levels(model, name, symbol, anchorMs, levels) {
    return new Output('levels', model, name, symbol, anchorMs, { values: [{ levels }] });
  }
  static action(model, name, symbol, anchorMs, intent, { size = null } = {}) {
    const v = { intent };
    if (size !== null) v.size = size;
    return new Output('action', model, name, symbol, anchorMs, { values: [v] });
  }
  static text(model, name, symbol, anchorMs, text) {
    return new Output('text', model, name, symbol, anchorMs, { values: [{ text }] });
  }
  static series(model, name, symbol, anchorMs, names, steps) {
    return new Output('series', model, name, symbol, anchorMs, { names, values: steps.map((lines) => ({ lines })) });
  }

  /** The horizon: bars of the anchor's interval. */
  steps(n) { this.horizon = { steps: n }; return this; }
  /** The horizon in business days (a date-keyed output). */
  businessDays(n) { this.horizon = { business_days: n }; return this; }
  /** Held until 'levels' or 'next_output'. */
  until(what) { this.horizon = { until: what }; return this; }

  /** Refuses what Bentrix would refuse, in its words. */
  check() {
    if (!LABEL.test(this.model) || !LABEL.test(this.name)) throw new Error('the model and the output are [a-z0-9_]{1,32}');
    if (!KINDS.includes(this.kind)) throw new Error(`${this.kind} is not one of the twelve kinds`);
    if (!this.values.length) throw new Error('values holds no value');
    this.values.forEach((v, i) => {
      const f = `values[${i}]`;
      switch (this.kind) {
        case 'scalar': inRange(`${f}.value`, v.value, this.range); break;
        case 'rank': inRange(`${f}.value`, v.value, this.range || [0, 1]); break;
        case 'event': inRange(`${f}.score`, v.score, [0, 1]); break;
        case 'position': inRange(`${f}.target`, v.target, this.range); break;
        case 'classes':
          if (!this.names || !this.names.length) throw new Error('names a classes output names its classes');
          for (const [k, p] of Object.entries(v.p)) {
            if (!this.names.includes(k)) throw new Error(`${f}.p ${k} is not one of the classes`);
            if (!this.softmax) inRange(`${f}.p.${k}`, p, [0, 1]);
          }
          break;
        case 'quantiles': if (!this.levels || !this.levels.length) throw new Error('levels a quantiles output names its levels'); break;
        case 'series': if (!this.names || !this.names.length) throw new Error('names a series output names its lines'); break;
        case 'action': if (!INTENTS.includes(v.intent)) throw new Error(`${f}.intent ${v.intent} is not one of ${INTENTS.join(', ')}`); break;
        case 'text': if ([...String(v.text)].length > 2000) throw new Error(`${f}.text is longer than 2000 characters`); break;
        default: break;
      }
    });
    if (this.suggested) this.suggested.check(this.range);
    return this;
  }

  /** The output_spec document; never an arrival. */
  spec() {
    const d = { schema_version: 1, model: this.model, output: this.name, symbol: this.symbol, kind: this.kind, anchor: { time_ms: this.anchorMs }, values: this.values };
    for (const k of ['range', 'units', 'horizon', 'names', 'levels', 'universe', 'markets', 'gross', 'note']) if (this[k] !== undefined && this[k] !== null) d[k] = this[k];
    if (this.kind === 'weights') d.long_only = this.long_only;
    if (this.kind === 'classes') { d.exclusive = this.exclusive; if (this.softmax) d.softmax = true; if (this.persistent) d.persistent = true; }
    if (this.epoch) d.epoch = this.epoch;
    if (this.suggested) d.suggested_meaning = this.suggested.doc();
    return d;
  }

  /** output_put on the workbench `bench`, after check. */
  async put(caller, bench) {
    this.check();
    return caller.call('output_put', { bench, output: this.spec() });
  }
}

/** output_put_many: several outputs at one instant. */
async function putOutputs(caller, bench, outputs, allOrNothing = false) {
  outputs.forEach((o) => o.check());
  return caller.call('output_put_many', { bench, outputs: outputs.map((o) => o.spec()), all_or_nothing: allOrNothing });
}

/** The output_meaning document: what a value means to the person. */
class Meaning {
  constructor({ reads = 'direction', highMeans = null, lowMeans = null, actAbove = null, actBelow = null, hysteresis = 0, labels = {} } = {}) {
    Object.assign(this, { reads, highMeans, lowMeans, actAbove, actBelow, hysteresis, labels });
  }
  check(range = null) {
    for (const w of [this.highMeans, this.lowMeans]) if (w !== null && !MEANING_WORDS.includes(w)) throw new Error(`${JSON.stringify(w)} is not one of the meaning's words`);
    for (const t of [this.actAbove, this.actBelow]) if (t !== null && range && (t < range[0] || t > range[1])) throw new Error(`the output answers ${range[0]} to ${range[1]}; ${t} is outside it`);
    for (const [k, l] of Object.entries(this.labels)) if (!MEANING_WORDS.includes(k) || !l || [...l].length > 24) throw new Error(`the label ${JSON.stringify(l)} for ${k} is not a meaning word's, or is empty or longer than 24`);
    return this;
  }
  doc() {
    const d = { reads: this.reads, hysteresis: this.hysteresis };
    if (this.highMeans !== null) d.high_means = this.highMeans;
    if (this.lowMeans !== null) d.low_means = this.lowMeans;
    if (this.actAbove !== null) d.act_above = this.actAbove;
    if (this.actBelow !== null) d.act_below = this.actBelow;
    if (Object.keys(this.labels).length) d.labels = this.labels;
    return d;
  }
}

/** output_meaning_set: the person's meaning of `model`'s `output` on the workbench `bench`. */
async function setMeaning(caller, bench, model, output, meaning, range = null) {
  meaning.check(range);
  return caller.call('output_meaning_set', { bench, model, output, meaning: meaning.doc() });
}

module.exports = { Output, Meaning, putOutputs, setMeaning, KINDS, MEANING_WORDS };
