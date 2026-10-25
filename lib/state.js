// Stores the whole target list as one JSON row in Neon Postgres (over HTTP, so it works on Vercel and locally).
const crypto = require('crypto');
const { neon } = require('@neondatabase/serverless');

let sql;
let ready;

// The table is created on first use, so there is no manual setup step.
async function db() {
  if (!process.env.DATABASE_URL) throw new Error('Database is not configured (DATABASE_URL).');
  sql ||= neon(process.env.DATABASE_URL);
  ready ||= sql`create table if not exists jar_state (
      id text primary key,
      data jsonb not null,
      updated_at bigint not null)`
    .catch((err) => { ready = null; throw err; });
  await ready;
  return sql;
}

function authorized(headers) {
  const want = Buffer.from(process.env.JAR_KEY || '');
  const got = Buffer.from(String(headers['x-jar-key'] || ''));
  return want.length > 0 && got.length === want.length && crypto.timingSafeEqual(got, want);
}

async function current(q) {
  const rows = await q`select data, updated_at from jar_state where id = 'me'`;
  return rows[0] ? { data: rows[0].data, updatedAt: Number(rows[0].updated_at) } : { data: null, updatedAt: 0 };
}

async function handleState(method, body, headers) {
  if (!process.env.JAR_KEY) return { status: 500, body: { error: 'Passcode is not configured (JAR_KEY).' } };
  if (!authorized(headers)) return { status: 401, body: { error: 'Wrong passcode.' } };
  try {
    const q = await db();
    if (method === 'GET') return { status: 200, body: await current(q) };
    if (method === 'PUT') {
      const { data, updatedAt } = body || {};
      if (!data || !Array.isArray(data.goals) || !Number.isFinite(updatedAt)) {
        return { status: 400, body: { error: 'Expected { data: { goals: [...] }, updatedAt }.' } };
      }
      const json = JSON.stringify(data);
      if (json.length > 200_000) return { status: 413, body: { error: 'Too much data.' } };
      // Last write wins, but an older copy (e.g. from a phone that was offline) never overwrites a newer one.
      await q`insert into jar_state (id, data, updated_at) values ('me', ${json}::jsonb, ${updatedAt})
              on conflict (id) do update set data = excluded.data, updated_at = excluded.updated_at
              where jar_state.updated_at <= excluded.updated_at`;
      return { status: 200, body: await current(q) };
    }
    return { status: 405, body: { error: 'GET or PUT only.' } };
  } catch (err) {
    return { status: 500, body: { error: err.message } };
  }
}

module.exports = { handleState };
