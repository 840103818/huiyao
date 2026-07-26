import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const lockfilePath = resolve(process.argv[2] ?? "package-lock.json");
const officialRegistry = "https://registry.npmjs.org";

let lockfile;
try {
  lockfile = JSON.parse(await readFile(lockfilePath, "utf8"));
} catch (error) {
  console.error(`无法读取 npm 锁文件：${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}

if (!lockfile.packages || typeof lockfile.packages !== "object") {
  console.error("npm 锁文件缺少 packages 对象");
  process.exit(1);
}

const failures = [];
for (const [packagePath, metadata] of Object.entries(lockfile.packages)) {
  if (!metadata || typeof metadata !== "object" || !("resolved" in metadata)) {
    continue;
  }

  if (typeof metadata.resolved !== "string") {
    failures.push(`${packagePath}: resolved 必须是字符串`);
    continue;
  }

  let resolvedUrl;
  try {
    resolvedUrl = new URL(metadata.resolved);
  } catch {
    failures.push(`${packagePath}: resolved 不是有效的 HTTPS URL`);
    continue;
  }

  if (resolvedUrl.origin !== officialRegistry) {
    failures.push(`${packagePath}: resolved 必须来自 ${officialRegistry}`);
  }
  if (typeof metadata.integrity !== "string" || metadata.integrity.length === 0) {
    failures.push(`${packagePath}: 缺少 integrity`);
  }
}

if (failures.length > 0) {
  console.error("npm 锁文件供应链校验失败：");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log("npm 锁文件供应链校验通过");
