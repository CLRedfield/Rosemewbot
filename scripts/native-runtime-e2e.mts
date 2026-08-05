import path from "node:path";

import { NativeRuntimeManager } from "../desktop/native-runtime.js";

const userDataDir = path.resolve(
  process.env.ROSEMEWBOT_E2E_DIR
  ?? process.env.AGENT_SPACE_E2E_DIR
  ?? "artifacts/native-e2e-user-data",
);
const manager = new NativeRuntimeManager(userDataDir, (progress) => {
  process.stdout.write(`[${String(progress.percent).padStart(3, " ")}%] ${progress.component}: ${progress.detail}\n`);
});

const result = await manager.runAction("install");
const state = await manager.getState();

console.log("NATIVE_RUNTIME_E2E", JSON.stringify({ result, state }, null, 2));
if (!result.ok || !state.nativeReady) process.exitCode = 1;
