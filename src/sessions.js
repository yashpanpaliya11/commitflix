import { mkdtemp, readFile, realpath, lstat, copyFile, chmod, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { randomUUID } from 'node:crypto';
import { git, resolveCommit } from './git.js';
import { launch, stopTree } from './process.js';

export async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

export async function projectAt(worktree, app = '.') {
  const target = await realpath(path.resolve(worktree, app));
  const relative = path.relative(await realpath(worktree), target);
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('App directory must stay inside the worktree.');
  const pkg = JSON.parse(await readFile(path.join(target, 'package.json'), 'utf8'));
  return { target, pkg };
}

export async function plan(target, pkg, { script, installScripts = false } = {}) {
  const exists = async file => { try { await lstat(path.join(target, file)); return true; } catch { return false; } };
  const locked = await exists('package-lock.json') || await exists('npm-shrinkwrap.json');
  let manager = pkg.packageManager?.split('@')[0];
  if (!manager) manager = await exists('pnpm-lock.yaml') ? 'pnpm' : await exists('yarn.lock') ? 'yarn' : await exists('bun.lock') || await exists('bun.lockb') ? 'bun' : 'npm';
  if (!['npm', 'pnpm', 'yarn', 'bun'].includes(manager)) throw new Error(`Unsupported package manager: ${manager}`);
  script ||= pkg.scripts?.dev ? 'dev' : 'start';
  if (!/^[a-zA-Z0-9_:-]+$/.test(script) || !pkg.scripts?.[script]) throw new Error(`No ${script} script. Add a dev/start script or use --script NAME.`);
  const major = Number(pkg.packageManager?.split('@')[1]?.split('.')[0] || 1);
  let install = manager === 'npm' ? [locked ? 'ci' : 'install', '--no-audit', '--no-fund'] : manager === 'pnpm' ? ['install', '--frozen-lockfile'] : manager === 'yarn' ? ['install', major >= 2 ? '--immutable' : '--frozen-lockfile'] : ['install', '--frozen-lockfile'];
  if (!installScripts) {
    if (manager === 'yarn' && major >= 2) install.push('--mode=skip-builds');
    else install.push('--ignore-scripts');
  }
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  const command = pkg.scripts[script];
  let flags = [];
  if (/\bnext\s+dev\b/.test(command) && deps.next) flags = ['--hostname', '127.0.0.1', '--port'];
  else if (/\b(vite|astro)\b/.test(command) && (deps.vite || deps.astro)) flags = ['--host', '127.0.0.1', '--port'];
  return { manager, install, script, flags, node: pkg.engines?.node || null };
}

export class Sessions {
  constructor(root, options = {}) { this.root = root; this.options = options; this.items = new Map(); this.closed = false; }
  list() { return [...this.items.values()].map(({ child, task, ...item }) => ({ ...item, logs: item.logs.slice(-20000) })); }
  async create(ref) {
    if (this.closed) throw new Error('CommitFlix is shutting down.');
    if (this.items.size >= 4) throw new Error('Four previews maximum. Stop one before opening another.');
    const id = randomUUID().slice(0, 8);
    const item = { id, ref, status: 'queued', logs: '', url: null, sha: null, path: null, port: null, created: Date.now(), cancelled: false };
    this.items.set(id, item);
    item.task = this.start(item).catch(error => { if (!item.cancelled) { item.status = 'error'; this.log(item, error.message); } });
    return id;
  }
  log(item, message) { item.logs = (item.logs + String(message)).slice(-50000); }
  async command(item, file, args, env) {
    if (item.cancelled) throw new Error('Stopped');
    this.log(item, `\n$ ${file} ${args.join(' ')}\n`);
    const child = launch(file, args, { cwd: item.appPath, env, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
    item.child = child;
    child.stdout.on('data', data => this.log(item, data));
    child.stderr.on('data', data => this.log(item, data));
    const ended = new Promise((resolve, reject) => { child.on('error', reject); child.on('close', code => resolve(code)); });
    return { child, ended };
  }
  async start(item) {
    item.status = 'preparing';
    item.sha = await resolveCommit(this.root, item.ref);
    item.base = await mkdtemp(path.join(tmpdir(), 'commitflix-'));
    item.path = path.join(item.base, 'checkout');
    await git(this.root, ['-c', 'core.hooksPath=', 'worktree', 'add', '--detach', item.path, item.sha]);
    item.added = true;
    if (item.cancelled) return;
    const { target, pkg } = await projectAt(item.path, this.options.app);
    item.appPath = target;
    const config = await plan(target, pkg, this.options);
    item.manager = config.manager;
    item.node = config.node;
    if (config.node) this.log(item, `Historical Node requirement: ${config.node}; using ${process.version}.\n`);
    if (this.options.envFile) {
      const envFile = await realpath(this.options.envFile);
      // Do not follow a historical .env.local symlink outside the checkout.
      const destination = path.join(target, '.env.local');
      await rm(destination, { force: true });
      await copyFile(envFile, destination);
      await chmod(destination, 0o600);
      this.log(item, 'Explicit environment file copied as .env.local (contents hidden).\n');
    }
    item.port = await freePort();
    item.url = `http://127.0.0.1:${item.port}`;
    const env = { ...process.env, PORT: String(item.port), HOST: '127.0.0.1', BROWSER: 'none', COMMITFLIX_ID: item.id, COMMITFLIX_SHA: item.sha, COMMITFLIX_PORT: String(item.port) };
    if (!this.options.skipInstall) {
      item.status = 'installing';
      const { ended, child } = await this.command(item, config.manager, config.install, env);
      const timeout = setTimeout(() => { this.log(item, '\nInstall timed out.\n'); void stopTree(child); }, this.options.installTimeout || 180000);
      let code;
      try { code = await ended; } finally { clearTimeout(timeout); }
      if (item.cancelled) return;
      if (code !== 0) throw new Error('Dependency installation failed. Inspect logs and historical runtime/lockfile.');
    }
    if (item.cancelled) return;
    item.status = 'starting';
    const flags = config.flags.length ? [...config.flags, String(item.port)] : [];
    if (config.flags[0] === '--host' && /\bvite\b/.test(pkg.scripts[config.script])) flags.push('--strictPort');
    const args = ['run', config.script, ...(flags.length ? (config.manager === 'npm' ? ['--', ...flags] : flags) : [])];
    const { ended, child } = await this.command(item, config.manager, args, env);
    void ended.then(code => {
      if (!item.cancelled) { item.status = 'error'; this.log(item, `\nApp exited (${code}).\n`); }
    }).catch(error => { item.status = 'error'; this.log(item, error.message); });
    const deadline = Date.now() + (this.options.startTimeout || 60000);
    while (!item.cancelled && item.status === 'starting' && Date.now() < deadline) {
      try {
        const response = await fetch(item.url, { signal: AbortSignal.timeout(800), redirect: 'manual' });
        await response.body?.cancel();
        if (response.status < 500) { item.status = 'ready'; return; }
      } catch { /* wait for HTTP readiness */ }
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    if (!item.cancelled && item.status === 'starting') {
      await stopTree(child);
      throw new Error(`App did not become ready on PORT=${item.port}. Ensure the script honors PORT or use a supported dev server.`);
    }
  }
  async stop(id) {
    const item = this.items.get(id);
    if (!item) throw new Error('Preview not found.');
    item.cancelled = true;
    item.status = 'stopping';
    await stopTree(item.child);
    await item.task;
    await stopTree(item.child);
    if (item.added) await git(this.root, ['worktree', 'remove', '--force', item.path]);
    if (item.base) await rm(item.base, { recursive: true, force: true });
    this.items.delete(id);
  }
  async close() {
    this.closed = true;
    const results = await Promise.allSettled([...this.items.keys()].map(id => this.stop(id)));
    const failures = results.filter(r => r.status === 'rejected');
    if (failures.length) throw new Error(`Cleanup incomplete: ${failures.map(r => r.reason.message).join('; ')}`);
  }
}
