import { parseArgs } from 'node:util';
import path from 'node:path';
import { readFile, writeFile, rm } from 'node:fs/promises';
import { repository, info, history, diff, commitAt, report } from './git.js';
import { run, launch } from './process.js';
import { startServer } from './server.js';
import { createDemo } from './demo.js';
import { bisect } from './bisect.js';

const help = `
  COMMITFLIX  /  Press play on any commit.

  commitflix                         Open the local timeline dashboard
  commitflix demo                    Try a four-commit demo, no repository needed
  commitflix play <ref>               Launch a commit + dashboard
  commitflix compare <ref> <ref>      Launch two committed versions
  commitflix log                     Print searchable history
  commitflix diff <ref> <ref>         Show a patch, or export HTML
  commitflix doctor                  Inspect repository and prerequisites
  commitflix hunt --good X --bad Y    Find a regression using an npm script

  Options
    --repo PATH                 Repository (default: current directory)
    --app PATH                  App directory relative to repo root (default: .)
    --script NAME               Preview script (default: dev, then start)
    --at DATE                   Preview last HEAD commit before an ISO date
    --port NUMBER               Dashboard port (default: auto)
    --no-open                   Do not open browser
    --skip-install              Skip dependency installation
    --allow-install-scripts     Enable dependency lifecycle scripts
    --env-file PATH             Explicitly copy this file into previews as .env.local
    --limit NUMBER              Log entries (1–200, default: 100)
    --search TEXT               Search commit messages
    --ref REF                   History branch/tag (default: HEAD)
    --out PATH                  Export diff as standalone HTML
    --json                      Machine-readable output (log, diff, doctor, hunt)
    --good REF --bad REF        Regression hunt endpoints
    --check NAME                Regression check npm script (default: test)
    --timeout NUMBER            Hunt command timeout in seconds (default: 60)
    --help / --version

  Previews execute historical project code on your machine. Use trusted repos.
  Worktrees separate files, not OS access, databases or external services.
  Ctrl+C stops previews and removes their disposable worktrees.
`;

function number(value, name, max, fallback) {
  if (value === undefined) return fallback;
  if (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > max) throw new Error(`${name} must be between 1 and ${max}.`);
  return Number(value);
}

export async function main(args = process.argv.slice(2)) {
  const { values: v, positionals: pos } = parseArgs({ args, allowPositionals: true, options: {
    repo: { type: 'string' }, app: { type: 'string' }, script: { type: 'string' }, at: { type: 'string' }, port: { type: 'string' },
    'no-open': { type: 'boolean' }, 'skip-install': { type: 'boolean' }, 'allow-install-scripts': { type: 'boolean' },
    'env-file': { type: 'string' }, limit: { type: 'string' }, search: { type: 'string' }, ref: { type: 'string' },
    out: { type: 'string' }, json: { type: 'boolean' }, good: { type: 'string' }, bad: { type: 'string' },
    check: { type: 'string' }, timeout: { type: 'string' }, help: { type: 'boolean', short: 'h' }, version: { type: 'boolean', short: 'v' }
  } });
  if (v.help) { console.log(help); return; }
  if (v.version) { console.log(JSON.parse(await readFile(new URL('../package.json', import.meta.url))).version); return; }
  const command = pos[0] || 'studio';
  if (!['studio', 'demo', 'play', 'compare', 'log', 'diff', 'doctor', 'hunt'].includes(command)) throw new Error(`Unknown command: ${command}. Run commitflix --help.`);
  const root = command === 'demo' ? await createDemo() : await repository(path.resolve(v.repo || '.'));
  const options = { app: v.app || '.', script: v.script, port: number(v.port, 'Port', 65535), skipInstall: command === 'demo' || Boolean(v['skip-install']), installScripts: Boolean(v['allow-install-scripts']), envFile: v['env-file'] && path.resolve(v['env-file']) };
  const print = data => console.log(JSON.stringify(data, null, 2));
  if (command === 'log') {
    const rows = await history(root, { limit: number(v.limit, 'Limit', 200, 100), search: v.search, ref: v.ref });
    if (v.json) print(rows); else rows.forEach(r => console.log(`${r.short}  ${r.date.slice(0, 10)}  ${r.message}  (${r.author})`));
    return;
  }
  if (command === 'diff') {
    if (pos.length !== 3) throw new Error('Usage: commitflix diff <from> <to> [--out report.html]');
    const data = await diff(root, pos[1], pos[2]);
    if (v.out) { await writeFile(path.resolve(v.out), report(data), { flag: 'wx' }); console.log(`Saved ${path.resolve(v.out)}`); }
    else if (v.json) print(data); else console.log(`${data.stat}\n\n${data.patch}`);
    return;
  }
  if (command === 'doctor') {
    let packageInfo;
    try { const pkg = JSON.parse(await readFile(path.resolve(root, options.app, 'package.json'), 'utf8')); packageInfo = { scripts: pkg.scripts || {}, node: pkg.engines?.node || 'not specified', manager: pkg.packageManager || 'lockfile detection' }; }
    catch { packageInfo = { error: 'No readable package.json at app directory.' }; }
    const data = { ...await info(root), node: process.version, git: (await run('git', ['--version'])).stdout.trim(), app: options.app, package: packageInfo };
    if (v.json) print(data); else {
      console.log(`\nCommitFlix / doctor\n\nRepository: ${data.root}\nBranch: ${data.branch}\nCommits: ${data.commits}${data.shallow ? ' (shallow history)' : ''}\nWorking changes: ${data.dirty ? 'present; tool leaves them in place' : 'none'}\nNode: ${data.node}\nGit: ${data.git}\nApp: ${data.app}\n`);
      print(packageInfo);
    }
    return;
  }
  if (command === 'hunt') {
    if (!v.good || !v.bad) throw new Error('Usage: commitflix hunt --good REF --bad REF [--check test]');
    const result = await bisect(root, v.good, v.bad, { ...options, check: v.check, timeout: number(v.timeout, 'Timeout', 3600, 60) * 1000,
      onCheck: entry => { if (!v.json) console.log(`${entry.passed ? 'PASS' : 'FAIL'} ${entry.sha.slice(0, 8)}`); }
    });
    if (v.json) print(result); else console.log(`\nFirst failing commit: ${result.firstBad}\nLast passing commit: ${result.lastGood}\n${result.assumption}`);
    return;
  }
  let refs = [];
  if (v.at) refs = [await commitAt(root, v.at)];
  else if (command === 'play') { if (pos.length !== 2) throw new Error('Usage: commitflix play <ref>'); refs = [pos[1]]; }
  else if (command === 'compare') { if (pos.length !== 3) throw new Error('Usage: commitflix compare <ref> <ref>'); refs = pos.slice(1); }
  let app;
  try { app = await startServer(root, options); } catch (error) { if (command === 'demo') await rm(root, { recursive: true, force: true }); throw error; }
  console.log(`\n  ◀ COMMITFLIX\n  Press play on any commit.\n\n  ${app.url}\n  ${root}\n\n  Preview runs trusted historical code. Ctrl+C to stop and clean up.\n`);
  let closing = false;
  const close = async () => {
    if (closing) return; closing = true;
    console.log('\nStopping previews and removing disposable worktrees…');
    try { await app.close(); if (command === 'demo') await rm(root, { recursive: true, force: true }); }
    catch (error) { console.error(error.message); process.exitCode = 1; }
  };
  process.once('SIGINT', close); process.once('SIGTERM', close);
  for (const ref of refs) await app.sessions.create(ref);
  if (!v['no-open']) {
    const file = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'rundll32' : 'xdg-open';
    const child = launch(file, process.platform === 'win32' ? ['url.dll,FileProtocolHandler', app.url] : [app.url], { stdio: 'ignore' });
    child.on('error', () => console.log(`Open ${app.url} in your browser.`)); child.unref();
  }
  return app;
}
