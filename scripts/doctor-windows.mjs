import process from "node:process";
if (process.platform !== "win32")
  throw new Error("Use the doctor for your operating system.");
await import("./doctor.mjs");
