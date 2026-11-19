import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
test('required app files are present',()=>{
 for(const name of ['server.mjs','public/index.html','public/styles.css','public/app.js','README.md','CLAUDE.md']){
  assert.ok(fs.statSync(path.join(root,name)).isFile(),name);
 }
});
test('core route handlers and mutual-acceptance guard exist',()=>{
 const src=fs.readFileSync(path.join(root,'server.mjs'),'utf8');
 assert.match(src,/stage_agreed/);assert.match(src,/Proposing party cannot accept own proposal/);assert.match(src,/Terms changed; refresh before acting/);
});
