import { NativeRuntimeManager } from "../desktop/native-runtime.js";
import { SnowLumaClient } from "../desktop/snowluma.js";

const userData = process.env.ROSEMEWBOT_DATA_DIR;
if (!userData) throw new Error("Set ROSEMEWBOT_DATA_DIR to the intended installation data directory");
const manager = new NativeRuntimeManager(userData);
await manager.initialize();
if (process.argv.includes("--start")) {
  const result = await manager.runAction("start");
  console.log(result);
  if (!result.ok) process.exit(1);
  await new Promise((resolve) => setTimeout(resolve, 3000));
}
if (process.argv.includes("--restart")) {
  console.log(await manager.runAction("restart"));
  await new Promise((resolve) => setTimeout(resolve, 3000));
}
if (process.argv.includes("--recover")) console.log(await manager.recoverIfNeeded());
const { runtime, acceptance } = await manager.getStatus();
console.log(JSON.stringify({ runtime: { state: runtime.stackState, services: runtime.services }, acceptance }, null, 2));
if (process.argv.includes("--processes")) {
  const client = new SnowLumaClient();
  const { napcatToken: password } = await manager.getCredentials();
  try { console.log(JSON.stringify(await client.getProcesses(password), null, 2)); }
  catch (error) {
    console.error("SnowLuma process inspection unavailable:", error instanceof Error ? error.message : "unknown error");
    process.exitCode = 1;
  }
}
