import process from "node:process";
if (process.platform !== "win32")
  throw new Error("Use the installer for your operating system.");
await import("./install-release.mjs");
