import { readdir } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawn } from "node:child_process";

export const UNIT_TEST_DIRECTORIES = ["frontend/src", "shared", "scripts", "src/server"];

// Discover nested tests once, rather than maintaining a list of feature globs
// that silently omits a new owner. Integration runners remain explicit commands.
export async function discoverUnitTests(root, directories = UNIT_TEST_DIRECTORIES) {
  async function visit(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    const files = await Promise.all(entries.map(async (entry) => {
      const target = resolve(directory, entry.name);
      if (entry.isDirectory()) return visit(target);
      return entry.isFile() && entry.name.endsWith(".test.js") ? [relative(root, target)] : [];
    }));
    return files.flat();
  }
  return (await Promise.all(directories.map((directory) => visit(resolve(root, directory))))).flat().sort();
}

async function runUnitTests() {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const files = await discoverUnitTests(root);
  if (!files.length) throw new Error("No unit tests discovered.");
  console.log(`Running ${files.length} unit test files, including nested feature owners.`);
  const child = spawn(process.execPath, ["--test", ...files], { cwd: root, stdio: "inherit" });
  child.once("error", (error) => { console.error(error.message); process.exitCode = 1; });
  child.once("exit", (code) => { process.exitCode = code ?? 1; });
  for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => child.kill(signal));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await runUnitTests();
}
