const client = require('prom-client');

const register = new client.Registry();
client.collectDefaultMetrics({ register });

const httpDuration = new client.Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP request duration',
  labelNames: ['method', 'route', 'status'],
  buckets: [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60, 120],
  registers: [register],
});

const researchQueries = new client.Counter({
  name: 'research_queries_total',
  help: 'Research queries by outcome',
  labelNames: ['outcome'],
  registers: [register],
});

module.exports = { register, httpDuration, researchQueries };
