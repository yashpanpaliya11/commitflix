import path from 'node:path';
import { realpath } from 'node:fs/promises';
import { run } from './process.js';

export const git = async (cwd, args) => (await run('git', ['-c', 'core.quotepath=false', '-C', cwd, ...args])).stdout.trimEnd();

export async function repository(cwd) {
  try {
    const root = await realpath(await git(cwd, ['rev-parse', '--show-toplevel']));
    await resolveCommit(root, 'HEAD');
    return root;
  } catch { throw new Error('Open a Git repository with at least one commit, or pass --repo /path/to/repo.'); }
}

export function safeRef(ref) {
  if (typeof ref !== 'string' || !ref || ref.startsWith('-') || ref.length > 500 || /[\x00-\x1f]/.test(ref)) throw new Error('Invalid Git reference.');
  return ref;
}

export async function resolveCommit(root, ref) {
  return (await git(root, ['rev-parse', '--verify', '--end-of-options', `${safeRef(ref)}^{commit}`])).trim();
}

export async function commitAt(root, date) {
  if (!date || Number.isNaN(Date.parse(date))) throw new Error('Use a valid date, for example 2026-01-15.');
  const sha = await git(root, ['rev-list', '-1', `--before=${new Date(date).toISOString()}`, 'HEAD']);
  if (!sha) throw new Error('No commit exists before this date on HEAD history.');
  return sha;
}

export async function history(root, { limit = 100, skip = 0, search = '', ref = 'HEAD' } = {}) {
  const sha = await resolveCommit(root, ref);
  limit = Math.max(1, Math.min(200, Number(limit) || 100));
  skip = Math.max(0, Math.min(1000000, Number(skip) || 0));
  const args = ['log', `--max-count=${limit}`, `--skip=${skip}`, '--format=%H%x00%h%x00%aI%x00%an%x00%s%x00%d%x00%x1e'];
  if (search) args.push('--fixed-strings', '--regexp-ignore-case', `--grep=${String(search).slice(0, 200)}`);
  const raw = await git(root, [...args, sha, '--']);
  return raw.split('\x1e').filter(s => s.trim()).map(row => {
    const [id, short, date, author, message, refs] = row.trimStart().split('\0');
    return { id, short, date, author, message, refs: refs?.trim() || '' };
  });
}

export async function diff(root, from, to) {
  const [a, b] = await Promise.all([resolveCommit(root, from), resolveCommit(root, to)]);
  const [stat, patch] = await Promise.all([
    git(root, ['diff', '--stat', a, b, '--']),
    git(root, ['diff', '--no-ext-diff', '--no-textconv', '--no-color', '--unified=3', a, b, '--'])
  ]);
  return { from: a, to: b, stat, patch };
}

export async function info(root) {
  const [head, branch, status, count, shallow] = await Promise.all([
    resolveCommit(root, 'HEAD'), git(root, ['branch', '--show-current']), git(root, ['status', '--porcelain']),
    git(root, ['rev-list', '--count', 'HEAD']), git(root, ['rev-parse', '--is-shallow-repository'])
  ]);
  return { name: path.basename(root), root, head, branch: branch || 'detached HEAD', dirty: Boolean(status), commits: Number(count), shallow: shallow === 'true' };
}

export const escapeHtml = text => String(text).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export function report(data) {
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>CommitFlix comparison</title><style>body{background:#101114;color:#eee;font:15px system-ui;margin:5vw;max-width:1200px}h1{color:#c9ff78}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#191b20;padding:24px;border-radius:12px;line-height:1.6}small{color:#aaa}</style><h1>CommitFlix / comparison</h1><p>${escapeHtml(data.from)} → ${escapeHtml(data.to)}</p><small>Committed snapshots only. Generated locally.</small><h2>Changed files</h2><pre>${escapeHtml(data.stat || 'No changes')}</pre><h2>Patch</h2><pre>${escapeHtml(data.patch || 'Identical snapshots')}</pre></html>`;
}
