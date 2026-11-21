import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { createDemo } from '../src/demo.js';
import { git, history, diff, report, resolveCommit } from '../src/git.js';
import { startServer } from '../src/server.js';
import { bisect } from '../src/bisect.js';

test('real repository: live preview, API boundaries, unchanged source, cleanup and regression hunt', { timeout: 45000 }, async () => {
  const root = await createDemo();
  let app;
  try {
    const commits = await history(root);
    assert.equal(commits.length, 4);
    assert.equal((await history(root, { search: 'midnight' })).length, 1);
    await assert.rejects(resolveCommit(root, '--help'), /Invalid/);
    await writeFile(path.join(root, 'index.html'), 'uncommitted original');
    const before = await git(root, ['status', '--porcelain']);
    app = await startServer(root, { skipInstall: true, startTimeout: 15000 });
    const headers = { 'X-CommitFlix-Token': app.token };
    assert.equal((await fetch(`${app.url}/api/info`)).status, 403);
    assert.equal((await fetch(`${app.url}/api/info`, { headers: { ...headers, Origin: 'https://example.com' } })).status, 403);
    assert.equal((await fetch(`${app.url}/api/info`, { headers })).status, 200);
    assert.equal((await fetch(`${app.url}/../../etc/passwd`)).status, 404);
    const id = await app.sessions.create(commits.at(-1).id);
    const deadline = Date.now() + 18000;
    while (Date.now() < deadline) {
      const session = app.sessions.list().find(item => item.id === id);
      if (session.status === 'error') assert.fail(session.logs);
      if (session.status === 'ready') break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    const session = app.sessions.list()[0];
    assert.equal(session.status, 'ready');
    assert.match(await (await fetch(session.url)).text(), /Add to cart/);
    await app.sessions.stop(id);
    await assert.rejects(fetch(session.url));
    assert.equal(await readFile(path.join(root, 'index.html'), 'utf8'), 'uncommitted original');
    assert.equal(await git(root, ['status', '--porcelain']), before);
    assert.match((await diff(root, commits.at(-1).id, commits[0].id)).patch, /Checkout soon/);
    assert.match(report({ from: '<script>', to: 'HEAD', stat: '', patch: '<img>' }), /&lt;script&gt;/);
    const result = await bisect(root, commits.at(-1).id, commits[0].id, { skipInstall: true, timeout: 10000 });
    assert.equal(result.firstBad, commits[0].id);
    assert.equal(result.lastGood, commits[1].id);
    const broken = await app.sessions.create('does-not-exist');
    while (app.sessions.list().find(s => s.id === broken).status !== 'error') await new Promise(r => setTimeout(r, 20));
    await app.sessions.stop(broken);
    assert.equal((await git(root, ['worktree', 'list', '--porcelain'])).split('\n').filter(line => line.startsWith('worktree ')).length, 1);
  } finally { await app?.close(); await rm(root, { recursive: true, force: true }); }
});
