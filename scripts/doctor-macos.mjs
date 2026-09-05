import process from "node:process";
if (process.platform !== "darwin")
  throw new Error("Use the doctor for your operating system.");
await import("./doctor.mjs");
