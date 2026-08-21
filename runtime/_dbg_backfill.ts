import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig } from './src/config.ts';
const config = loadConfig();
const dateFolder = path.join(config.downloadRoot, '2026-08-20');
console.log('dateFolder', path.resolve(dateFolder), fs.existsSync(dateFolder));
const dirs = fs.readdirSync(dateFolder, { withFileTypes: true })
  .filter((d) => d.isDirectory() && /^T247-\d+$/i.test(d.name))
  .map((d) => d.name);
console.log('count', dirs.length);
console.log('has103517468', dirs.includes('T247-103517468'));
const onlyId = '103517468';
const filtered = dirs.filter((name) => name.replace(/\D/g, '') === onlyId);
console.log('filtered', filtered);
