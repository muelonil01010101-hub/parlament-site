import { DatabaseSync } from 'node:sqlite';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const dbPath = resolve(process.argv[2] || '../clan.db');
const outPath = resolve(process.argv[3] || './import.sql');
const db = new DatabaseSync(dbPath, { readOnly: true });
const tables = {
  news: ['id','d','t','b'], members: ['id','nick','role','d','bio','mkey'],
  apps: ['id','d','nick','contact','about','status','code'], ach: ['id','member_id','title'],
  polls: ['id','q','d','closed'], opts: ['id','poll_id','t'], votes: ['id','poll_id','member_id','opt_id'], kv: ['k','v']
};
const quote = v => v === null || v === undefined ? 'NULL' : typeof v === 'number' ? String(v) : `'${String(v).replaceAll("'", "''")}'`;
let sql = '-- Generated from clan.db. Keep this file private; it contains application contact details.\n';
for (const [table, columns] of Object.entries(tables)) {
  const existing = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table);
  if (!existing) continue;
  for (const row of db.prepare(`SELECT ${columns.join(',')} FROM ${table}`).all()) {
    sql += `INSERT OR REPLACE INTO ${table} (${columns.join(',')}) VALUES (${columns.map(c=>quote(row[c])).join(',')});\n`;
  }
}
db.close();
writeFileSync(outPath, sql, { encoding: 'utf8', mode: 0o600 });
console.log(`Created private import file: ${outPath}`);
