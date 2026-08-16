import { randomBytes } from "node:crypto";
import { execFile } from "node:child_process";
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import net from "node:net";
import { networkInterfaces } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import { LOCAL_DEMO_STUDENT_ID } from "../packages/db/src/local-demo-seed.ts";

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const composeFile = path.join(repoRoot, "infra", "compose", "dev.compose.yml");

export interface LocalDemoConfig {
  readonly apiPort: number;
  readonly webPort: number;
  readonly databaseUrl: string;
  readonly apiOrigin: string;
  readonly uploadDirectory: string;
  readonly studentId: string;
}

type Environment = Readonly<Record<string, string | undefined>>;

export function discoverLocalDevOrigins(): readonly string[] {
  const origins = new Set(["localhost", "127.0.0.1"]);
  for (const addresses of Object.values(networkInterfaces())) {
    for (const address of addresses ?? []) {
      if (address.family === "IPv4" && !address.internal && !address.address.startsWith("169.254.")) {
        origins.add(address.address);
      }
    }
  }
  return [...origins];
}

export function parsePort(value: string | undefined, fallback: number, name: string): number {
  const candidate = value === undefined || value.trim() === "" ? fallback : Number(value);
  if (!Number.isInteger(candidate) || candidate < 1 || candidate > 65_535) {
    throw new Error(`${name} must be an integer between 1 and 65535.`);
  }
  return candidate;
}

export function createLocalDemoConfig(
  env: Environment = process.env,
  root = repoRoot,
): LocalDemoConfig {
  const apiPort = parsePort(env.API_PORT, 4000, "API_PORT");
  const webPort = parsePort(env.WEB_PORT, 3000, "WEB_PORT");
  if (apiPort === webPort) throw new Error("API_PORT and WEB_PORT must be different.");
  const databaseUrl = env.DATABASE_URL?.trim() || "postgres://gapproof:gapproof_local@127.0.0.1:55432/gapproof";
  const apiOrigin = `http://127.0.0.1:${apiPort}`;
  const uploadDirectory = path.resolve(
    env.GAPPROOF_UPLOAD_DIR?.trim() || path.join(root, ".local", "gapproof", "uploads"),
  );
  return {
    apiPort,
    webPort,
    databaseUrl,
    apiOrigin,
    uploadDirectory,
    studentId: LOCAL_DEMO_STUDENT_ID,
  };
}

export function buildDemoEnvironment(
  env: Environment,
  config: LocalDemoConfig,
  signingSecret: string,
): NodeJS.ProcessEnv {
  return {
    ...env,
    DATABASE_URL: config.databaseUrl,
    API_PORT: String(config.apiPort),
    WEB_PORT: String(config.webPort),
    GAPPROOF_API_ORIGIN: config.apiOrigin,
    GAPPROOF_DEMO_STUDENT_ID: config.studentId,
    GAPPROOF_ALLOWED_DEV_ORIGINS: discoverLocalDevOrigins().join(","),
    GAPPROOF_UPLOAD_DIR: config.uploadDirectory,
    GAPPROOF_UPLOAD_SIGNING_SECRET: signingSecret,
    GAPPROOF_DEVICE_SESSION_SECRET: signingSecret,
  } as unknown as NodeJS.ProcessEnv;
}

async function runCommand(
  command: string,
  args: readonly string[],
  options: { readonly allowFailure?: boolean; readonly env?: Environment } = {},
) {
  try {
    const result = await execFileAsync(command, [...args], {
      cwd: repoRoot,
      ...(options.env ? { env: options.env as NodeJS.ProcessEnv } : {}),
      windowsHide: true,
      maxBuffer: 4 * 1024 * 1024,
    });
    return { stdout: result.stdout, stderr: result.stderr, code: 0 } as const;
  } catch (error) {
    const failure = error as { stdout?: string; stderr?: string; code?: number | string };
    if (options.allowFailure) {
      return {
        stdout: failure.stdout ?? "",
        stderr: failure.stderr ?? "",
        code: typeof failure.code === "number" ? failure.code : 1,
      } as const;
    }
    throw new Error(`${command} ${args.join(" ")} failed (${String(failure.code ?? "unknown")}).`);
  }
}

async function assertCommand(command: string, args: readonly string[], label: string) {
  try {
    await runCommand(command, args);
  } catch {
    throw new Error(`${label} is required and was not available.`);
  }
}

export async function isPortAvailable(port: number, host = "127.0.0.1"): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.listen(port, host, () => {
      server.close(() => resolve(true));
    });
  });
}

async function waitFor(
  check: () => Promise<boolean>,
  timeoutMs: number,
  description: string,
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`${description} did not become ready within ${timeoutMs}ms.`);
}

async function ensurePostgres() {
  await assertCommand("docker", ["version"], "Docker");
  await assertCommand("docker", ["compose", "version"], "Docker Compose");
  await runCommand("docker", ["compose", "-f", composeFile, "up", "-d", "postgres"]);
  await waitFor(async () => {
    const health = await runCommand(
      "docker",
      ["compose", "-f", composeFile, "ps", "--format", "json", "postgres"],
      { allowFailure: true },
    );
    if (/healthy/i.test(health.stdout)) return true;
    const ready = await runCommand(
      "docker",
      ["compose", "-f", composeFile, "exec", "-T", "postgres", "pg_isready", "-U", "gapproof", "-d", "gapproof"],
      { allowFailure: true },
    );
    return ready.code === 0;
  }, 60_000, "PostgreSQL");
}

function startChild(args: readonly string[], env: NodeJS.ProcessEnv) {
  const child = spawn(process.execPath, args, {
    cwd: repoRoot,
    env,
    stdio: "inherit",
    windowsHide: true,
  });
  return child;
}

async function waitForHttp(url: string, description: string, predicate: (body: string) => boolean) {
  await waitFor(async () => {
    try {
      const response = await fetch(url);
      if (!response.ok) return false;
      return predicate(await response.text());
    } catch {
      return false;
    }
  }, 90_000, description);
}

async function main() {
  const config = createLocalDemoConfig();
  if (!(await isPortAvailable(config.apiPort))) throw new Error(`API_PORT ${config.apiPort} is already in use.`);
  if (!(await isPortAvailable(config.webPort))) throw new Error(`WEB_PORT ${config.webPort} is already in use.`);
  await mkdir(config.uploadDirectory, { recursive: true });
  await ensurePostgres();

  const childEnv = buildDemoEnvironment(process.env, config, randomBytes(32).toString("hex"));
  await runCommand(process.execPath, ["run", "packages/db/src/migrate.ts"], { env: childEnv });
  await runCommand(process.execPath, ["run", "scripts/local-demo-seed.ts"], { env: childEnv });

  const children = [
    startChild(["run", "apps/api/src/main.ts"], childEnv),
    startChild(["run", "apps/worker/src/main.ts"], childEnv),
    startChild(["run", "--cwd", "apps/web", "dev"], childEnv),
  ];
  let stopping = false;
  const stop = () => {
    if (stopping) return;
    stopping = true;
    for (const child of children) child.kill();
  };
  for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, stop);

  try {
    await waitForHttp(`${config.apiOrigin}/v1/quick-checks/synthetic`, "API", (body) => body.includes('"questions"'));
    await waitForHttp(`http://127.0.0.1:${config.webPort}/student/today`, "Web", (body) => body.includes("today-page"));
    process.stdout.write(`Local Demo stack ready: http://127.0.0.1:${config.webPort}/student/today\n`);
    const lanHost = discoverLocalDevOrigins().find((origin) => origin !== "localhost" && origin !== "127.0.0.1");
    if (lanHost) process.stdout.write(`LAN preview: http://${lanHost}:${config.webPort}/student/today\n`);
    process.stdout.write(`Demo student: ${config.studentId}\n`);
    await new Promise<void>((resolve) => {
      for (const child of children) child.once("exit", () => resolve());
    });
  } finally {
    stop();
    for (const signal of ["SIGINT", "SIGTERM"] as const) process.removeListener(signal, stop);
  }
}

if (import.meta.main) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : "LOCAL_DEMO_STACK_FAILED"}\n`);
    process.exitCode = 1;
  });
}
