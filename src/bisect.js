import path from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { git, resolveCommit } from './git.js';
import { projectAt, plan } from './sessions.js';
import { launch, stopTree } from './process.js';

async function command(file, args, cwd, timeout) {
  const child = launch(file, args, { cwd, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '', expired = false;
  child.stdout.on('data', data => { output = (output + data).slice(-10000); });
  child.stderr.on('data', data => { output = (output + data).slice(-10000); });
  const timer = setTimeout(() => { expired = true; void stopTree(child); }, timeout);
  try {
    const code = await new Promise((resolve, reject) => { child.on('error', reject); child.on('close', resolve); });
    if (expired) throw new Error('Check timed out; result is inconclusive.');
    return { code, output };
  } finally { clearTimeout(timer); await stopTree(child); }
}

export async function bisect(root, goodRef, badRef, options = {}) {
  const [good, bad] = await Promise.all([resolveCommit(root, goodRef), resolveCommit(root, badRef)]);
  const chain = (await git(root, ['rev-list', '--first-parent', bad])).split('\n');
  const index = chain.indexOf(good);
  if (index < 1) throw new Error('Good must be an earlier commit on the first-parent history of bad.');
  const commits = chain.slice(0, index + 1).reverse();
  const checked = [];
  const check = async sha => {
    const base = await mkdtemp(path.join(tmpdir(), 'commitflix-bisect-'));
    const target = path.join(base, 'checkout');
    let added = false;
    try {
      await git(root, ['-c', 'core.hooksPath=', 'worktree', 'add', '--detach', target, sha]); added = true;
      const { target: cwd, pkg } = await projectAt(target, options.app);
      const config = await plan(cwd, pkg, { ...options, script: options.check || 'test' });
      if (!options.skipInstall) {
        const installed = await command(config.manager, config.install, cwd, options.timeout || 180000);
        if (installed.code !== 0) throw new Error(`Install failed at ${sha.slice(0, 8)}; cannot classify commit.\n${installed.output}`);
      }
      const result = await command(config.manager, ['run', config.script], cwd, options.timeout || 60000);
      if (result.code === 125 || result.code === null) throw new Error(`Inconclusive check at ${sha.slice(0, 8)}. Exit 125/signals cannot classify a commit.`);
      const entry = { sha, passed: result.code === 0, output: result.output };
      checked.push(entry); options.onCheck?.(entry);
      return entry.passed;
    } finally {
      if (added) await git(root, ['worktree', 'remove', '--force', target]);
      await rm(base, { recursive: true, force: true });
    }
  };
  if (!await check(good)) throw new Error('The good endpoint fails the check. Choose a known passing commit.');
  if (await check(bad)) throw new Error('The bad endpoint passes the check. Choose a known failing commit.');
  let lo = 0, hi = commits.length - 1;
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (await check(commits[mid])) lo = mid; else hi = mid;
  }
  return { firstBad: commits[hi], lastGood: commits[lo], checked, assumption: 'First-parent history; assumes a single passing-to-failing transition.' };
}
