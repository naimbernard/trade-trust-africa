import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('required app files are present', () => {
  for (const name of ['server.mjs', 'public/index.html', 'public/styles.css', 'public/app.js', 'README.md', 'CLAUDE.md', 'src/app.mjs', 'src/routes/deals.mjs']) {
    assert.ok(fs.statSync(path.join(root, name)).isFile(), name);
  }
});

test('core mutual-acceptance guards are still in place', () => {
  const src = fs.readFileSync(path.join(root, 'src/routes/deals.mjs'), 'utf8');
  assert.match(src, /stage_agreed/);
  assert.match(src, /Proposing party cannot accept own proposal/);
  assert.match(src, /Refresh before acting/);
});

test('no live payment provider is wired in', () => {
  const src = fs.readFileSync(path.join(root, 'src/billing/provider.mjs'), 'utf8');
  assert.match(src, /simulated/);
  assert.doesNotMatch(src, /api\.stripe\.com|api\.paystack\.co/);
});
