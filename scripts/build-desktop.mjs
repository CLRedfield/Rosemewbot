import { build } from "esbuild";

const shared = {
  bundle: true,
  platform: "node",
  target: "node22",
  format: "cjs",
  sourcemap: true,
  external: ["electron"],
};

await Promise.all([
  build({
    ...shared,
    entryPoints: ["desktop/main.ts"],
    outfile: "dist-electron/main.cjs",
  }),
  build({
    ...shared,
    entryPoints: ["desktop/preload.ts"],
    outfile: "dist-electron/preload.cjs",
  }),
]);

console.log("Electron main and preload bundles built.");
