import { execFileSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const rootDirectory = resolve(process.cwd());

const filesToCheck = [
  join(rootDirectory, "app.js"),
  join(rootDirectory, "platform.js"),
  ...collectJavaScriptFiles(join(rootDirectory, "api"))
];

for (const filePath of filesToCheck) {
  try {
    execFileSync(process.execPath, ["--check", filePath], {
      stdio: "inherit"
    });
  } catch {
    process.exitCode = 1;
    break;
  }
}

if (!process.exitCode) {
  console.log(`Syntax check passed for ${filesToCheck.length} JavaScript files.`);
}

function collectJavaScriptFiles(directoryPath) {
  try {
    return readdirSync(directoryPath).flatMap((entryName) => {
      const entryPath = join(directoryPath, entryName);
      const entryStats = statSync(entryPath);

      if (entryStats.isDirectory()) {
        return collectJavaScriptFiles(entryPath);
      }

      return entryName.endsWith(".js") ? [entryPath] : [];
    });
  } catch (error) {
    console.error(`Unable to scan ${directoryPath}:`, error.message);
    process.exit(1);
  }
}