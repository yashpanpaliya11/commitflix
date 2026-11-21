import { spawn } from 'node:child_process';

export function launch(file, args, options = {}) {
  // .cmd shims need cmd.exe on Windows. Only allow fixed program/script tokens.
  if (process.platform === 'win32' && ['npm', 'pnpm', 'yarn', 'bun'].includes(file)) {
    if (args.some(a => !/^[a-zA-Z0-9_./:=@+-]+$/.test(a))) throw new Error('Unsupported command token on Windows.');
    return spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `${file} ${args.join(' ')}`], options);
  }
  return spawn(file, args, options);
}

export function run(file, args, options = {}) {
  return new Promise((resolve, reject) => {
    let stdout = '', stderr = '', overflow = false;
    const child = launch(file, args, { ...options, stdio: ['ignore', 'pipe', 'pipe'] });
    const limit = options.maxBuffer || 8 * 1024 * 1024;
    const collect = (type, chunk) => {
      if (overflow) return;
      if (type === 'out') stdout += chunk; else stderr += chunk;
      if (stdout.length + stderr.length > limit) { overflow = true; child.kill(); }
    };
    child.stdout.on('data', chunk => collect('out', chunk));
    child.stderr.on('data', chunk => collect('err', chunk));
    child.on('error', reject);
    child.on('close', code => {
      if (overflow) return reject(new Error('Command output exceeded limit. Narrow your query.'));
      if (code !== 0 && !options.allowFailure) return reject(new Error(stderr.trim() || `${file} exited with ${code}`));
      resolve({ stdout, stderr, code });
    });
  });
}

export async function stopTree(child) {
  if (!child?.pid) return;
  if (process.platform === 'win32') {
    await run('taskkill', ['/pid', String(child.pid), '/T', '/F'], { allowFailure: true }).catch(() => {});
    return;
  }
  const signal = value => { try { process.kill(-child.pid, value); } catch { /* already gone */ } };
  signal('SIGTERM');
  await new Promise(resolve => setTimeout(resolve, 250));
  signal('SIGKILL');
}
