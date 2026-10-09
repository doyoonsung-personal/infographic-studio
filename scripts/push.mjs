// Push the working tree to GitHub as one commit on main, using the REST API (no git needed).
//   GITHUB_TOKEN=... node scripts/push.mjs "commit message"
// Files ignored: see SKIP below (mirrors .gitignore).

import fs from 'node:fs';
import path from 'node:path';

const OWNER = process.env.GH_OWNER || 'doyoonsung-personal';
const REPO = process.env.GH_REPO || 'infographic-studio';
const BRANCH = process.env.GH_BRANCH || 'main';
const TOKEN = process.env.GITHUB_TOKEN;
if (!TOKEN) { console.error('GITHUB_TOKEN is not set'); process.exit(1); }
const msg = process.argv[2] || 'Update';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, '$1')), '..');
const SKIP = [/^node_modules\//, /^\.tools\//, /^\.wrangler\//, /^\.dev\.vars$/, /^work\//, /\.log$/, /^\.claude\//, /^\.git\//];

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, e.name);
    const rel = path.relative(ROOT, abs).split(path.sep).join('/');
    if (SKIP.some((re) => re.test(rel + (e.isDirectory() ? '/' : '')))) continue;
    if (e.isDirectory()) walk(abs, out); else out.push(rel);
  }
  return out;
}

async function gh(method, p, body) {
  const r = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}${p}`, {
    method,
    headers: { Authorization: `Bearer ${TOKEN}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'infographic-studio-push' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`${method} ${p} -> ${r.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : {};
}

const files = walk(ROOT);
const ref = await gh('GET', `/git/ref/heads/${BRANCH}`);
const parent = ref.object.sha;
const tree = [];
for (const f of files) {
  const content = fs.readFileSync(path.join(ROOT, f)).toString('base64');
  const blob = await gh('POST', '/git/blobs', { content, encoding: 'base64' });
  tree.push({ path: f, mode: '100644', type: 'blob', sha: blob.sha });
}
const t = await gh('POST', '/git/trees', { tree });
const commit = await gh('POST', '/git/commits', { message: msg, tree: t.sha, parents: [parent] });
await gh('PATCH', `/git/refs/heads/${BRANCH}`, { sha: commit.sha });
console.log(`Pushed ${files.length} files to ${OWNER}/${REPO}@${BRANCH}: ${commit.sha.slice(0, 7)} "${msg}"`);
