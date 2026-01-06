/**
 * Post-build script to fix CJS output:
 * 1. Add package.json to dist/cjs to mark it as CommonJS
 * 2. Fix .js extension imports to work with CJS
 */

import { writeFileSync, readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

const cjsDir = new URL('../dist/cjs', import.meta.url).pathname;
const esmDir = new URL('../dist/esm', import.meta.url).pathname;

// Write package.json to mark cjs directory as CommonJS
writeFileSync(
  join(cjsDir, 'package.json'),
  JSON.stringify({ type: 'commonjs' }, null, 2) + '\n'
);

// Write package.json to mark esm directory as ESM (explicit)
writeFileSync(
  join(esmDir, 'package.json'),
  JSON.stringify({ type: 'module' }, null, 2) + '\n'
);

console.log('✓ Added package.json markers to dist/cjs and dist/esm');

