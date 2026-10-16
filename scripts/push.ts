import { execFileSync } from "node:child_process";
import fs from "node:fs";

const run = (command: string, args: string[]) => {
  execFileSync(command, args, { stdio: "inherit" });
};

const packageJson = JSON.parse(fs.readFileSync("package.json", "utf8")) as {
  version: string;
};
const explicitVersion = process.argv.find((arg) => /^\d+\.\d+\.\d+$/.test(arg));
const current = packageJson.version.match(/^(\d+)\.(\d+)\.(\d+)$/);
if (!current)
  throw new Error(`Invalid current version: ${packageJson.version}`);

const version =
  explicitVersion ?? `${current[1]}.${current[2]}.${Number(current[3]) + 1}`;
const args = process.argv.slice(2);
const remote = args.find((arg) => arg === "origin" || arg.includes("/"));
const branch = args.find((arg) => arg === "HEAD" || arg === "NewUI");

run("pnpm", ["bump", version]);
run("git", ["add", "-A"]);
run("git", ["commit", "-m", `chore: release ${version}`]);

const pushArgs = ["push"];
if (remote) pushArgs.push(remote);
if (branch) pushArgs.push(branch);
run("git", pushArgs);
