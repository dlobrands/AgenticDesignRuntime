import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_CONFIG,
  createBaselineEntry,
  createFrameDocument,
  createProjectDocument,
  stableStringify,
} from "@tva-agentic-design/core";
import {
  commitWorkspaceMigration,
  inspectWorkspaceMigration,
  rollbackWorkspaceMigration,
} from "../src/schema-migration.js";

const projectId = "00000000-0000-4000-8000-000000000101";
const frameId = "00000000-0000-4000-8000-000000000102";
const workspaceId = "00000000-0000-4000-8000-000000000103";

describe("workspace schema migration", () => {
  it("migrates schema-1 canonical state with history parity and rolls back before mutation", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "adr-schema-migration-"));
    const projectDirectory = path.join(root, "projects", "fixture");
    await Promise.all([
      mkdir(path.join(root, ".design-runtime"), { recursive: true }),
      mkdir(path.join(projectDirectory, "frames"), { recursive: true }),
      mkdir(path.join(projectDirectory, "assets"), { recursive: true }),
      mkdir(path.join(projectDirectory, "fonts"), { recursive: true }),
      mkdir(path.join(projectDirectory, "history"), { recursive: true }),
    ]);
    const now = "2026-08-27T12:00:00.000Z";
    const frame = createFrameDocument({
      id: frameId,
      slug: "fixture",
      name: "Fixture",
      width: 640,
      height: 480,
      now,
    });
    frame.schemaVersion = 1;
    const project = createProjectDocument({
      id: projectId,
      slug: "fixture",
      name: "Fixture",
      now,
    });
    project.schemaVersion = 1;
    project.frames = [
      {
        id: frameId,
        slug: "fixture",
        name: "Fixture",
        path: "frames/fixture.json",
      },
    ];
    project.frameOrder = [frameId];
    const config = {
      ...DEFAULT_CONFIG(workspaceId),
      schemaVersion: 1 as const,
    };
    const baseline = await createBaselineEntry({
      id: "00000000-0000-4000-8000-000000000104",
      transactionId: "00000000-0000-4000-8000-000000000105",
      projectId,
      frame,
      timestamp: now,
    });
    await Promise.all([
      writeFile(
        path.join(root, "design.config.json"),
        stableStringify(config, true),
      ),
      writeFile(
        path.join(projectDirectory, "project.json"),
        stableStringify(project, true),
      ),
      writeFile(
        path.join(projectDirectory, "frames", "fixture.json"),
        stableStringify(frame, true),
      ),
      writeFile(
        path.join(projectDirectory, "assets", "assets.json"),
        stableStringify({ schemaVersion: 1, assets: [] }, true),
      ),
      writeFile(
        path.join(projectDirectory, "fonts", "fonts.json"),
        stableStringify({ schemaVersion: 1, fonts: [] }, true),
      ),
      writeFile(
        path.join(projectDirectory, "history", "operations.jsonl"),
        stableStringify(baseline),
      ),
    ]);

    expect(await inspectWorkspaceMigration(root)).toMatchObject({
      currentSchemaVersion: 1,
      migrationRequired: true,
    });
    expect(await commitWorkspaceMigration(root)).toMatchObject({
      status: "migrated",
      currentSchemaVersion: 1,
      targetSchemaVersion: 2,
    });
    expect(
      JSON.parse(await readFile(path.join(root, "design.config.json"), "utf8")),
    ).toMatchObject({ schemaVersion: 2 });
    expect(
      JSON.parse(
        await readFile(path.join(projectDirectory, "project.json"), "utf8"),
      ),
    ).toMatchObject({ schemaVersion: 2 });
    expect(
      JSON.parse(
        await readFile(
          path.join(projectDirectory, "frames", "fixture.json"),
          "utf8",
        ),
      ),
    ).toMatchObject({ schemaVersion: 2 });

    expect(await rollbackWorkspaceMigration(root)).toMatchObject({
      status: "rolled-back",
    });
    expect(
      JSON.parse(await readFile(path.join(root, "design.config.json"), "utf8")),
    ).toMatchObject({ schemaVersion: 1 });
  });
});
