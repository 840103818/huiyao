import { readFile, readdir } from "node:fs/promises";
import { resolve, dirname, extname } from "node:path";
import { SourceTextModule } from "node:vm";

const distDir = resolve(process.argv[2] ?? "dist");
const assetsDir = resolve(distDir, "assets");
const assetNames = await readdir(assetsDir);
const scriptPaths = assetNames
  .filter((name) => extname(name) === ".js")
  .map((name) => resolve(assetsDir, name));

if (scriptPaths.length === 0) {
  throw new Error(`前端产物中没有 JavaScript 文件：${assetsDir}`);
}

const scriptSet = new Set(scriptPaths);
const graph = new Map();

for (const scriptPath of scriptPaths) {
  const source = await readFile(scriptPath, "utf8");
  const module = new SourceTextModule(source, { identifier: scriptPath });
  const dependencies = module.dependencySpecifiers
    .filter((specifier) => specifier.startsWith("."))
    .map((specifier) => resolve(dirname(scriptPath), specifier))
    .filter((dependency) => scriptSet.has(dependency));
  graph.set(scriptPath, dependencies);
}

const visiting = new Set();
const visited = new Set();

function visit(scriptPath, stack) {
  if (visiting.has(scriptPath)) {
    const cycleStart = stack.indexOf(scriptPath);
    const cycle = [...stack.slice(cycleStart), scriptPath]
      .map((path) => path.slice(assetsDir.length + 1))
      .join(" -> ");
    throw new Error(`检测到生产 JavaScript 分块循环依赖：${cycle}`);
  }
  if (visited.has(scriptPath)) return;

  visiting.add(scriptPath);
  stack.push(scriptPath);
  for (const dependency of graph.get(scriptPath) ?? []) visit(dependency, stack);
  stack.pop();
  visiting.delete(scriptPath);
  visited.add(scriptPath);
}

for (const scriptPath of scriptPaths) visit(scriptPath, []);
console.log(`Verified ${scriptPaths.length} frontend JavaScript chunks without dependency cycles.`);
