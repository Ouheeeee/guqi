#!/usr/bin/env node
/**
 * 一键发布：把当前工作区改动提交到 GitHub main 分支，触发 GitHub Pages 自动部署。
 *
 * 凭据策略：不读取任何本地 token 文件。每次发布时由维护者完成一次
 * GitHub Device Authorization，token 仅通过环境变量或 --token 传入。
 *
 * 用法：GITHUB_TOKEN=<一次性 token> node scripts/deploy.mjs "说明"
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const tokenFlag = args.indexOf('--token');
const flagToken = tokenFlag >= 0 ? args[tokenFlag + 1] : null;
const message = args.find((arg, index) => !arg.startsWith('--') && index !== tokenFlag + 1) || `deploy: ${new Date().toISOString()}`;

function readToken() {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN.trim();
  if (flagToken) return flagToken.trim();
  return null;
}

const token = readToken();
if (!token) {
  console.error('缺少一次性 GitHub Token。先在本次发布中完成 GitHub Device Authorization，然后运行：\n  GITHUB_TOKEN=<一次性 token> node scripts/deploy.mjs "说明"');
  process.exit(1);
}

const headers = {
  Accept: 'application/vnd.github+json',
  Authorization: `Bearer ${token}`,
  'X-GitHub-Api-Version': '2022-11-28',
  'Content-Type': 'application/json',
  'User-Agent': 'GuQiDeploy/1.0',
};

async function gh(url, options = {}) {
  const res = await fetch(url, { ...options, headers: { ...headers, ...(options.headers || {}) } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${options.method || 'GET'} ${url} -> ${res.status} ${data.message || ''}`);
  return data;
}

const repoRes = await fetch('https://api.github.com/repos/Ouheeeee/guqi', { headers });
const repo = await repoRes.json();
if (!repoRes.ok) {
  console.error(`无法访问仓库：${repoRes.status} ${repo.message || ''}`);
  process.exit(1);
}
const api = repo.url;
console.log(`→ ${repo.full_name} (${repo.permissions?.push ? '可推送' : '无推送权限'})`);

const ref = await gh(`${api}/git/ref/heads/main`);
const baseSha = ref.object.sha;
const baseCommit = await gh(`${api}/git/commits/${baseSha}`);
const files = process.env.DEPLOY_FILES
  ? process.env.DEPLOY_FILES.split(',').map((f) => f.trim()).filter(Boolean)
  : await listChangedFiles();

async function listChangedFiles() {
  const { execFileSync } = await import('node:child_process');
  try {
    const changed = execFileSync('git', ['-C', root, 'diff', '--name-only', 'HEAD'], { encoding: 'utf8' })
      .trim().split('\n').filter(Boolean);
    const untracked = execFileSync('git', ['-C', root, 'ls-files', '--others', '--exclude-standard'], { encoding: 'utf8' })
      .trim().split('\n').filter(Boolean);
    const all = [...new Set([...changed, ...untracked])];
    if (all.length) return all;
  } catch {
    // 不是 git 仓库时，默认发布站点与脚本
  }
  return ['site', 'tests', 'scripts', 'README.md', 'package.json'].filter((p) => fs.existsSync(path.join(root, p)));
}

const walk = (entry) => {
  const full = path.join(root, entry);
  if (!fs.existsSync(full)) return [];
  if (fs.statSync(full).isFile()) return [entry];
  return fs.readdirSync(full).flatMap((child) => walk(path.join(entry, child)));
};

const entries = [];
for (const file of files.flatMap(walk)) {
  const buffer = fs.readFileSync(path.join(root, file));
  const binary = /\.(png|jpe?g|gif|webp|ico|pdf|woff2?)$/i.test(file);
  const blob = await gh(`${api}/git/blobs`, {
    method: 'POST',
    body: JSON.stringify({ content: binary ? buffer.toString('base64') : buffer.toString('utf8'), encoding: binary ? 'base64' : 'utf-8' }),
  });
  entries.push({ path: file, mode: '100644', type: 'blob', sha: blob.sha });
  console.log(`  + ${file}`);
}

if (!entries.length) {
  console.log('没有需要发布的改动。');
  process.exit(0);
}

const tree = await gh(`${api}/git/trees`, { method: 'POST', body: JSON.stringify({ base_tree: baseCommit.tree.sha, tree: entries }) });
const date = new Date().toISOString();
const author = { name: repo.owner.login, email: `${repo.owner.id}+${repo.owner.login}@users.noreply.github.com`, date };
const commit = await gh(`${api}/git/commits`, {
  method: 'POST',
  body: JSON.stringify({ message, tree: tree.sha, parents: [baseSha], author, committer: author }),
});
await gh(`${api}/git/refs/heads/main`, { method: 'PATCH', body: JSON.stringify({ sha: commit.sha, force: false }) });

const record = { sha: commit.sha, url: commit.html_url, message, files: entries.map((e) => e.path), date };
fs.mkdirSync(path.join(root, '.deploy'), { recursive: true });
fs.writeFileSync(path.join(root, '.deploy', 'last-api-commit.json'), `${JSON.stringify(record, null, 2)}\n`);

console.log(`✓ 已推送提交 ${commit.sha.slice(0, 7)}：${commit.html_url}`);
console.log('  等待 GitHub Actions 部署：https://github.com/Ouheeeee/guqi/actions');
console.log(`  线上地址：${repo.homepage || 'https://ouheeeee.github.io/guqi/'}`);
