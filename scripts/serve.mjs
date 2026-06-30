// Detached server control so the game keeps running across tool/chat sessions.
//   node scripts/serve.mjs start|status|stop
import { spawn } from "node:child_process";
import { existsSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const PID_FILE = join(ROOT, ".server.pid");
const LOG_FILE = join(ROOT, ".server.log");

function readPid() {
  if (!existsSync(PID_FILE)) return null;
  const pid = Number(readFileSync(PID_FILE, "utf8").trim());
  return Number.isFinite(pid) ? pid : null;
}

function isRunning(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

const cmd = process.argv[2] ?? "status";

if (cmd === "start") {
  const existing = readPid();
  if (isRunning(existing)) {
    console.log(`already running (pid ${existing})`);
    process.exit(0);
  }
  const out = openSync(LOG_FILE, "a");
  const child = spawn(process.execPath, [join(ROOT, "dist", "server.js")], {
    detached: true,
    stdio: ["ignore", out, out],
    env: process.env,
  });
  child.unref();
  writeFileSync(PID_FILE, String(child.pid));
  console.log(`started detached (pid ${child.pid}) -> http://localhost:${process.env.PORT ?? 3000}/`);
  console.log(`logs: ${LOG_FILE}`);
} else if (cmd === "status") {
  const pid = readPid();
  console.log(isRunning(pid) ? `running (pid ${pid})` : "not running");
} else if (cmd === "stop") {
  const pid = readPid();
  if (isRunning(pid)) {
    process.kill(pid);
    console.log(`stopped (pid ${pid})`);
  } else {
    console.log("not running");
  }
  if (existsSync(PID_FILE)) rmSync(PID_FILE);
} else {
  console.log("usage: node scripts/serve.mjs start|status|stop");
  process.exit(1);
}
