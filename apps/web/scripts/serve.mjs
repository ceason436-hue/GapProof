import { spawn } from "node:child_process";
import { createRequire } from "node:module";

const mode = process.argv[2];
if (mode !== "dev" && mode !== "start") throw new Error("Expected dev or start");
const port = process.env.WEB_PORT ?? "3000";
if (!/^\d+$/.test(port)) throw new Error("WEB_PORT must be a non-negative integer");

const require = createRequire(import.meta.url);
const nextBin = require.resolve("next/dist/bin/next");
const child = spawn(process.execPath, [nextBin, mode, "-p", port], { stdio: "inherit", windowsHide: true });
child.once("exit", code => process.exitCode = code ?? 1);
for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => child.kill(signal));
