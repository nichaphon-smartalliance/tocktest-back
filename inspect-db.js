const { Client } = require('pg');

async function run() {
  // 1) connect to default 'postgres' db to list databases
  const admin = new Client({
    host: '154.197.124.206', port: 5432, user: 'postgres',
    password: 'smart2026#', database: 'postgres', ssl: false,
  });
  await admin.connect();
  const dbs = await admin.query(
    `SELECT datname FROM pg_database WHERE datistemplate = false ORDER BY datname;`
  );
  console.log('=== DATABASES ===');
  console.log(dbs.rows.map(r => r.datname).join(', '));
  await admin.end();

  // pick tocktest db
  const target = dbs.rows.map(r => r.datname).find(n => /tock/i.test(n))
    || dbs.rows.map(r => r.datname).find(n => n !== 'postgres');
  console.log('\n=== TARGET DB:', target, '===');

  const c = new Client({
    host: '154.197.124.206', port: 5432, user: 'postgres',
    password: 'smart2026#', database: target, ssl: false,
  });
  await c.connect();

  const users = await c.query(`SELECT id, email FROM users ORDER BY created_at;`).catch(e => ({ rows: [`ERR ${e.message}`] }));
  console.log('\n--- users ---');
  console.table(users.rows);

  const repos = await c.query(
    `SELECT id, user_id, github_repo_id, full_name, name FROM repositories ORDER BY full_name;`
  ).catch(e => ({ rows: [`ERR ${e.message}`] }));
  console.log('\n--- repositories ---');
  console.table(repos.rows);

  const tcCount = await c.query(
    `SELECT repo_id, COUNT(*)::int AS test_cases FROM test_cases GROUP BY repo_id;`
  ).catch(e => ({ rows: [`ERR ${e.message}`] }));
  console.log('\n--- test_cases count per repo_id ---');
  console.table(tcCount.rows);

  // how many distinct users own the "same" github repo
  const dup = await c.query(
    `SELECT full_name, COUNT(DISTINCT user_id)::int AS owners, COUNT(*)::int AS rows
     FROM repositories GROUP BY full_name HAVING COUNT(DISTINCT user_id) > 1 ORDER BY full_name;`
  ).catch(e => ({ rows: [`ERR ${e.message}`] }));
  console.log('\n--- repos owned by >1 user (same full_name) ---');
  console.table(dup.rows);

  await c.end();
}
run().catch(e => { console.error('FATAL', e.message); process.exit(1); });
