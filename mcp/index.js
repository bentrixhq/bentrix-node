'use strict';
/*
 * BENTRIX's JavaScript client of a running BENTRIX (MCP): every capability of the catalogue, typed,
 * under client.<domain> (generated.js), over the hand-written connection (client.js).
 *
 *   const { connect } = require('bentrix/mcp');
 *   const b = await connect();                     // finds the running application, pairs, connects
 *   const state = await b.workspace.getState();
 */
const runtime = require('./client.js');
const { Bentrix, CATALOGUE_VERSION, CATALOGUE_DIGEST } = require('./generated.js');
const forecast = require('./forecast.js');
const output = require('./output.js');

/**
 * Open a connection: connect({ url, token }) uses exactly what it is given; connect() finds the running
 * application through endpoint.json in BENTRIX's agents folder (agentsFolder overrides where) and pairs
 * with it under name (BENTRIX_AGENT_NAME, else this script's name).
 */
async function connect({ url, token, agentsFolder, name, ...opts } = {}) {
  if (!url || !token) ({ url, token } = await runtime.discover({ agentsFolder, name }));
  const b = new Bentrix(url, token, opts);
  if (opts.checkVersion !== false) await b.verifyCatalogue();
  return b;
}

module.exports = { connect, Bentrix, CATALOGUE_VERSION, CATALOGUE_DIGEST, ...runtime, forecast, output };
