import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { expect, test } from "@playwright/test";
const execute = promisify(execFile);

test("installed runtime health exercises production transactions and verifies rendered pixels", async () => {
  test.setTimeout(120_000);
  const result = await execute(
    process.execPath,
    [path.join(process.cwd(), "apps/runtime/dist/cli.js"), "health", "--json"],
    { timeout: 110_000, encoding: "utf8" },
  );
  expect(JSON.parse(result.stdout.trim())).toMatchObject({
    status: "healthy",
    renderVerified: true,
  });
});
