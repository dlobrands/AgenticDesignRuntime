import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/cli.ts", "src/agent-cli.ts"],
  outDir: "dist",
  format: ["esm"],
  platform: "node",
  target: "node22",
  sourcemap: false,
  clean: true,
  splitting: false,
  noExternal: [/.*/],
});
