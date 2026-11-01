// Copies Monaco's AMD build into public/monaco/vs so the editor loads from the
// app itself (see src/components/question/code-editor.tsx). Runs before dev/build.
import { cpSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

// Not require.resolve: the package's `exports` map hides package.json.
const pkg = path.resolve("node_modules/monaco-editor");
const { version } = JSON.parse(readFileSync(path.join(pkg, "package.json"), "utf8"));
const target = path.resolve("public/monaco");
const marker = path.join(target, "VERSION");

if (existsSync(marker) && readFileSync(marker, "utf8").trim() === version) process.exit(0);
cpSync(path.join(pkg, "min", "vs"), path.join(target, "vs"), { recursive: true });
writeFileSync(marker, version + "\n");
console.log(`Monaco ${version} → public/monaco/vs`);
