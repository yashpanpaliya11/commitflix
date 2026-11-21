import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { git } from './git.js';

export async function createDemo() {
  const root = await mkdtemp(path.join(tmpdir(), 'commitflix-demo-'));
  try {
    await git(root, ['init', '-b', 'main']);
    await git(root, ['config', 'user.name', 'CommitFlix Demo']);
    await git(root, ['config', 'user.email', 'demo@example.invalid']);
    const pkg = { name: 'commitflix-demo', private: true, type: 'module', scripts: { dev: 'node server.js', test: 'node check.js' } };
    await writeFile(path.join(root, 'package.json'), JSON.stringify(pkg, null, 2));
    await writeFile(path.join(root, '.gitignore'), 'node_modules\n');
    await writeFile(path.join(root, 'server.js'), `import http from 'node:http';\nimport {readFile} from 'node:fs/promises';\nhttp.createServer(async(req,res)=>{res.setHeader('content-type','text/html');res.end(await readFile(new URL('index.html',import.meta.url)));}).listen(Number(process.env.PORT||3000),'127.0.0.1');\n`);
    await writeFile(path.join(root, 'check.js'), `import {readFileSync} from 'node:fs';\nif(!readFileSync('index.html','utf8').includes('Add to cart'))process.exit(1);\n`);
    const versions = [
      ['The first spark', '#f3f0e8', '#171717', 'A quieter kind of shopping.', 'Thoughtful objects for everyday rituals.', 'Add to cart'],
      ['Give the storefront a midnight makeover', '#111a23', '#f4c56a', 'Good things. After hours.', 'A collection made for your downtime.', 'Add to cart'],
      ['Introduce the electric summer collection', '#dfedcb', '#193527', 'Less noise. More summer.', 'Everyday essentials, with a little more sunshine.', 'Add to cart'],
      ['Ship the new checkout (and a tiny regression)', '#e8dff7', '#34234e', 'Your next favorite thing.', 'Objects worth keeping. Stories worth telling.', 'Checkout soon']
    ];
    for (let i = 0; i < versions.length; i++) {
      const [message, bg, fg, headline, detail, cta] = versions[i];
      await writeFile(path.join(root, 'index.html'), `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>STILL / collection 0${i + 1}</title><style>*{box-sizing:border-box}body{background:${bg};color:${fg};margin:0;font-family:system-ui;padding:36px}header{display:flex;justify-content:space-between;font-size:13px;letter-spacing:3px}main{max-width:900px;margin:70px auto}small{letter-spacing:3px}h1{font-size:clamp(40px,7vw,90px);font-weight:500;line-height:1.02;letter-spacing:-5px;max-width:700px}p{opacity:.7;font-size:18px}button{background:${fg};color:${bg};border:0;border-radius:50px;padding:18px 30px;font-size:16px;margin-top:24px}.shape{width:160px;height:160px;border:28px solid currentColor;border-radius:${i % 2 ? '30% 60% 40% 50%' : '50%'};transform:rotate(${i * 25}deg);opacity:.3;float:right;margin:20px}</style><header><b>STILL®</b><span>COLLECTION 0${i + 1}</span></header><main><small>LESS, BUT BETTER.</small><div class="shape"></div><h1>${headline}</h1><p>${detail}</p><button>${cta}</button></main></html>`);
      await git(root, ['add', '.']);
      await git(root, ['-c', 'core.hooksPath=', '-c', 'commit.gpgSign=false', 'commit', '-m', message]);
    }
    return root;
  } catch (error) { await rm(root, { recursive: true, force: true }); throw error; }
}
