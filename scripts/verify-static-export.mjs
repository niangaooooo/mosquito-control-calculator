import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const requiredFiles = [
  'out/index.html',
  'out/manifest.json',
  'out/calculate/ulv/index.html',
  'out/calculate/indoor/index.html',
  'out/calculate/residual/index.html',
  'out/drugs/index.html',
  'out/machines/index.html',
  'out/history/index.html',
];

for (const file of requiredFiles) {
  if (!existsSync(resolve(file))) throw new Error(`静态导出缺少文件: ${file}`);
}

const home = readFileSync(resolve('out/index.html'), 'utf8');
const ulv = readFileSync(resolve('out/calculate/ulv/index.html'), 'utf8');

if (home.includes('localhost:3000') || ulv.includes('localhost:3000')) {
  throw new Error('静态导出仍包含开发端口 localhost:3000');
}
if (!home.includes('href="/mosquito/manifest.json"')) {
  throw new Error('manifest 没有使用 /mosquito 基础路径');
}
if (!home.includes('href="/mosquito/calculate/ulv/"')) {
  throw new Error('首页 ULV 链接不是可由静态服务器直接提供的目录路由');
}
if (!ulv.includes('href="/mosquito/"')) {
  throw new Error('ULV 返回首页链接缺少 /mosquito 基础路径');
}

console.log(`静态导出检查通过：${requiredFiles.length} 个关键文件，入口、返回链接与 manifest 路径正确。`);
