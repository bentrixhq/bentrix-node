'use strict';
/*
 * Bentrix's JavaScript client of a running Bentrix (MCP): every capability of the catalogue, typed,
 * under client.<domain> (generated.js), over the hand-written connection (client.js).
 *
 *   const { connect } = require('bentrix/mcp');
 *   const b = await connect();                     // finds the running application, pairs, connects
 *   const state = await b.workspace.getState();
 *   const bench = await openBench(b);              // the selected workbench: bench.buy(0.1, { sl }), bench.step('H1')
 */
const runtime = require('./client.js');
const { Bentrix, CATALOGUE_VERSION, CATALOGUE_DIGEST } = require('./generated.js');
const { Answer, Bench, Refused, openBench } = require('./bench.js');
const forecast = require('./forecast.js');
const output = require('./output.js');

/**
 * Open a connection: connect({ url, token }) uses exactly what it is given; connect() finds the running
 * application through endpoint.json in Bentrix's agents folder (agentsFolder overrides where) and pairs
 * with it under name (BENTRIX_AGENT_NAME, else this script's name).
 */
async function connect({ url, token, agentsFolder, name, ...opts } = {}) {
  if (!url || !token) ({ url, token } = await runtime.discover({ agentsFolder, name }));
  const b = new Bentrix(url, token, opts);
  if (opts.checkVersion !== false) await b.verifyCatalogue();
  return b;
}

module.exports = { connect, openBench, Answer, Bench, Refused, Bentrix, CATALOGUE_VERSION, CATALOGUE_DIGEST, ...runtime, forecast, output };
