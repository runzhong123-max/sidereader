import { readFile, readdir } from "node:fs/promises";
import { resolve, relative, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { builtinModules } from "node:module";
import ts from "typescript";

const builtins = new Set(builtinModules.flatMap((name) => [name, `node:${name}`]));
const runtimeModules = new Set(["src/tutor-sessions.mjs"]);
const packageName = (specifier) => specifier.startsWith("@") ? specifier.split("/").slice(0, 2).join("/") : specifier.split("/")[0];
const pureModule = (file) => /^src\/domain\//.test(file) || /^server\/domain\//.test(file) || (/^src\/[^/]+\.mjs$/.test(file) && !runtimeModules.has(file));
const persistentAccess = new Set(["localStorage", "sessionStorage", "indexedDB"]);

export function inspectModule(file, source, dependencies) {
  const violations = [];
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const report = (message) => violations.push(`${file}: ${message}`);
  const checkImport = (specifier) => {
    if (!specifier.startsWith(".") && !specifier.startsWith("/") && !builtins.has(specifier)) {
      if (!dependencies.has(packageName(specifier))) report(`undeclared direct dependency: ${specifier}`);
    }
    const target = specifier.startsWith(".") ? relative(process.cwd(), resolve(dirname(resolve(file)), specifier)).replaceAll("\\", "/") : specifier;
    if (pureModule(file) && (/^(react(?:-dom)?|lucide-react)(?:\/|$)/.test(specifier) || /(?:^|\/)components\//.test(target) || /persistence\/(?!keys[.])/.test(target) || /(?:^|\/)services\//.test(target) || /(?:^|\/)storage(?:[.]|$)/.test(target))) {
      report(`pure domain module depends on UI or I/O: ${specifier}`);
    }
    if (file.startsWith("src/persistence/") && (target.startsWith("src/services/") || target.startsWith("src/components/") || /^(react(?:-dom)?)(?:\/|$)/.test(specifier))) report(`persistence must not depend on transport or UI: ${specifier}`);
    if (file.startsWith("src/") && target.startsWith("server/")) report(`browser code imports server implementation: ${specifier}`);
    if (file.startsWith("server/") && !file.endsWith(".test.mjs") && target.startsWith("src/") && !pureModule(target)) report(`server imports browser runtime instead of pure domain: ${specifier}`);
    if (specifier === "idb-keyval" && !file.startsWith("src/persistence/")) report("IndexedDB access must go through src/persistence");
    if (file !== "src/storage.ts" && file.startsWith("src/") && /(?:^|\/)storage(?:[.]|$)/.test(target)) report("new consumers must import a repository or service explicitly");
  };
  const visit = (node) => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) checkImport(node.moduleSpecifier.text);
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) checkImport(node.arguments[0].text);
    if (ts.isIdentifier(node) && persistentAccess.has(node.text) && file.startsWith("src/") && !file.startsWith("src/persistence/")) report(`browser storage must go through src/persistence: ${node.text}`);
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "fetch" && file.startsWith("src/") && !file.startsWith("src/services/")) report("HTTP calls must go through src/services");
    ts.forEachChild(node, visit);
  };
  visit(ast);
  return [...new Set(violations)];
}

async function sourceFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const lists = await Promise.all(entries.map(async (entry) => {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(?:mjs|tsx?|jsx?)$/.test(path) && !/\.d\.(?:mts|ts)$/.test(path) ? [path] : [];
  }));
  return lists.flat();
}

export async function checkArchitecture() {
  const manifest = JSON.parse(await readFile("package.json", "utf8"));
  const lock = JSON.parse(await readFile("package-lock.json", "utf8"));
  const dependencies = new Set([...Object.keys(manifest.dependencies || {}), ...Object.keys(manifest.devDependencies || {})]);
  const files = [...(await Promise.all(["src", "server", "scripts"].map(sourceFiles))).flat(), "vite.config.ts"];
  const violations = (await Promise.all(files.map(async (file) => inspectModule(file, await readFile(file, "utf8"), dependencies)))).flat();
  for (const group of ["dependencies", "devDependencies"]) {
    const declared = manifest[group] || {}, locked = lock.packages?.[""]?.[group] || {};
    for (const name of new Set([...Object.keys(declared), ...Object.keys(locked)])) {
      if (declared[name] !== locked[name]) violations.push(`package-lock.json: ${name} differs from package.json`);
    }
  }
  return { files: files.length, violations };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { files, violations } = await checkArchitecture();
  if (violations.length) {
    process.stderr.write(`${violations.join("\n")}\n`);
    process.exitCode = 1;
  } else process.stdout.write(`Architecture boundaries and direct dependencies verified (${files} modules).\n`);
}
