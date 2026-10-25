// Vercel serverless function: same handler as the local server.
const { handleState } = require('../lib/state');

module.exports = async (req, res) => {
  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body;
  const result = await handleState(req.method, body, req.headers);
  res.setHeader('Cache-Control', 'no-store');
  res.status(result.status).json(result.body);
};
