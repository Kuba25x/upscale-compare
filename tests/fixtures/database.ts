import { readFile, readdir } from 'node:fs/promises';

export async function migrateTestDatabase(db: { exec: (sql: string) => Promise<unknown> }) {
  for (const file of (await readdir('worker/migrations'))
    .filter((name) => name.endsWith('.sql'))
    .sort()) {
    const sql = (await readFile('worker/migrations/' + file, 'utf8'))
      .replace(/--[^\n]*/g, '')
      .replace(/\n/g, ' ');
    await db.exec(sql);
  }
}
