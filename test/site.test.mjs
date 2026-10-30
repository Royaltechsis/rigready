import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const site = join(root, 'site');
const read = (p) => readFileSync(join(site, p), 'utf8');

test('trainer page has title, viewport, core content and the disclaimer', () => {
  const html = read('index.html');
  assert.match(html, /<title>RigReady: Mud Pump Lockout<\/title>/);
  assert.match(html, /<meta name="viewport" content="width=device-width/);
  assert.match(html, /Before you board: practise the job safely/);
  assert.match(html, /id="nameInput"/);
  assert.match(html, /Demo procedure is a generic LOTO pattern; verify against your company's procedure\./);
  assert.match(html, /id="incident"/);
  assert.match(html, /id="score"/);
  assert.match(html, /dashboard\.html/);
});

test('dashboard page exists with readiness table and disclaimer', () => {
  const html = read('dashboard.html');
  assert.match(html, /<title>RigReady Supervisor Dashboard<\/title>/);
  assert.match(html, /<meta name="viewport"/);
  assert.match(html, /Crew readiness/);
  assert.match(html, /Demo procedure is a generic LOTO pattern/);
});

test('every local asset referenced by the pages exists', () => {
  for (const page of ['index.html', 'dashboard.html']) {
    const html = read(page);
    const refs = [...html.matchAll(/(?:src|href)="(\.\/[^"#?]+)"/g)].map((m) => m[1]);
    assert.ok(refs.length >= 2, page + ' should reference built assets');
    for (const r of refs) assert.ok(existsSync(join(site, r)), `${page} references missing ${r}`);
  }
});

test('procedure config is valid and references real steps', () => {
  const proc = JSON.parse(readFileSync(join(root, 'src/procedure.json'), 'utf8'));
  const ids = new Set(proc.steps.map((s) => s.id));
  assert.equal(ids.size, proc.steps.length, 'step ids are unique');
  for (const s of proc.steps) for (const r of s.requires || []) {
    assert.ok(ids.has(r.step), `${s.id} requires unknown step ${r.step}`);
    assert.ok(['block', 'mistake', 'incident'].includes(r.outcome));
    if (r.outcome === 'incident') assert.ok(proc.incidents[r.incident], `unknown incident ${r.incident}`);
    if (r.check) assert.ok(proc.checks[r.check], `unknown check ${r.check}`);
  }
  for (const k of ['lock', 'bleed', 'verify', 'open_cover', 'unlock']) assert.ok(ids.has(k));
  assert.match(proc.incidentSource.url, /iadc\.org\/safety-alerts\/alert-08-14/);
  assert.equal(proc.tools.filter((t) => t.correct).length, 3);
});

test('no em dashes or placeholder text in on-screen copy', () => {
  const files = ['index.html', 'dashboard.html'].map(read);
  files.push(readFileSync(join(root, 'src/procedure.json'), 'utf8'));
  files.push(readFileSync(join(root, 'src/main.js'), 'utf8'));
  files.push(readFileSync(join(root, 'src/dashboard.js'), 'utf8'));
  for (const f of files) {
    assert.ok(!f.includes('\u2014'), 'em dash found');
    assert.ok(!/lorem ipsum|TODO|FIXME/i.test(f), 'placeholder found');
  }
});

test('built bundle is small enough for a mid-range phone', () => {
  const assets = readdirSync(join(site, 'assets'));
  const js = assets.filter((a) => a.endsWith('.js')).map((a) => readFileSync(join(site, 'assets', a)).length).reduce((a, b) => a + b, 0);
  assert.ok(js < 900 * 1024, `JS is ${js} bytes`);
});
