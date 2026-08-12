import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import {
  mkdtemp,
  readFile,
  realpath,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { SUPPORTED_BLEND_MODES } from "@agentic-design/core";

const runtimeRequire = createRequire(
  path.join(process.cwd(), "apps/runtime/package.json"),
);
const sharp = runtimeRequire("sharp") as (input: Buffer) => {
  metadata: () => Promise<{
    format?: string;
    width?: number;
    height?: number;
    hasAlpha?: boolean;
  }>;
  raw: () => { toBuffer: () => Promise<Buffer> };
};

const projectId = "11111111-1111-4111-8111-111111111111";
const frameId = "22222222-2222-4222-8222-222222222222";
let root: string;
let runtime: ChildProcessWithoutNullStreams;
let descriptorPath: string;
let descriptor: {
  runtimeId: string;
  workspaceId: string;
  capabilityToken: string;
  baseUrl: string;
};

const availablePort = async (): Promise<number> =>
  new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("Could not allocate a loopback port."));
        return;
      }
      server.close((error) => (error ? reject(error) : resolve(address.port)));
    });
  });

const request = async (route: string, body: unknown): Promise<unknown> => {
  const response = await fetch(`${descriptor.baseUrl}${route}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${descriptor.capabilityToken}`,
      "content-type": "application/json",
      "x-design-runtime-id": descriptor.runtimeId,
      "x-design-workspace-id": descriptor.workspaceId,
    },
    body: JSON.stringify(body),
  });
  if (!response.ok)
    throw new Error(`${response.status}: ${await response.text()}`);
  return response.json();
};

const runtimeHeaders = (): Record<string, string> => ({
  authorization: `Bearer ${descriptor.capabilityToken}`,
  "x-design-runtime-id": descriptor.runtimeId,
  "x-design-workspace-id": descriptor.workspaceId,
});

const bootstrapStudio = async (page: Page, next = "/"): Promise<void> => {
  const result = (await request("/api/runtime/studio/bootstrap", { next })) as {
    bootstrapPath: string;
  };
  await page.goto(`${descriptor.baseUrl}${result.bootstrapPath}`);
};

const importProjectFont = async (input: {
  projectId: string;
  baseRevision: number;
  path: string;
  filename: string;
}): Promise<{ id: string }> => {
  const form = new FormData();
  form.set("baseRevision", String(input.baseRevision));
  form.set("licenseNotes", "SIL Open Font License test fixture.");
  form.set(
    "file",
    new File([await readFile(input.path)], input.filename, {
      type: "font/woff2",
    }),
  );
  const response = await fetch(
    `${descriptor.baseUrl}/api/projects/${input.projectId}/fonts/import`,
    { method: "POST", headers: runtimeHeaders(), body: form },
  );
  const result = (await response.json()) as { font: { id: string } };
  expect(response.status, JSON.stringify(result)).toBe(200);
  return result.font;
};

test.beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), "agentic-studio-e2e-"));
  const descriptorDirectory = path.join(root, "descriptors");
  const port = await availablePort();
  runtime = spawn(
    process.execPath,
    [
      "apps/runtime/dist/cli.js",
      "dev",
      root,
      "--no-open",
      "--port",
      String(port),
    ],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        ADR_DESCRIPTOR_DIRECTORY: descriptorDirectory,
        ADR_PREFERENCES_PATH: path.join(root, "preferences.json"),
        ADR_UPDATE_CONFIG_PATH: path.join(root, "unbound-update-trust.json"),
        ADR_UPDATE_ROOT: path.join(root, "updates"),
      },
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
  const ready = await new Promise<{
    runtimeId: string;
    workspaceId: string;
    baseUrl: string;
  }>((resolve, reject) => {
    let output = "";
    const timer = setTimeout(
      () => reject(new Error(`Runtime did not become ready. ${output}`)),
      30_000,
    );
    runtime.stdout.on("data", (chunk: Buffer) => {
      output += chunk.toString();
      for (const line of output.split("\n")) {
        try {
          const value = JSON.parse(line) as {
            status?: string;
            runtimeId: string;
            workspaceId: string;
            baseUrl: string;
          };
          if (value.status === "ready") {
            clearTimeout(timer);
            resolve(value);
          }
        } catch {
          // A partial line is expected while the child is still writing.
        }
      }
    });
    runtime.stderr.on("data", (chunk: Buffer) => {
      output += chunk.toString();
    });
    runtime.once("exit", (code) => {
      clearTimeout(timer);
      reject(
        new Error(`Runtime exited before readiness with ${code}. ${output}`),
      );
    });
  });
  const stored = JSON.parse(
    await readFile(
      (descriptorPath = path.join(
        descriptorDirectory,
        `${ready.runtimeId}.json`,
      )),
      "utf8",
    ),
  ) as typeof descriptor;
  descriptor = { ...stored, baseUrl: ready.baseUrl };
  await request("/api/transactions", {
    schemaVersion: 1,
    mode: "commit",
    runtimeId: descriptor.runtimeId,
    workspaceId: descriptor.workspaceId,
    scope: { kind: "workspace" },
    baseRevision: null,
    actor: { source: "system", id: "e2e" },
    operations: [
      { kind: "createProject", projectId, slug: "e2e", name: "E2E Instrument" },
    ],
  });
  await request("/api/transactions", {
    schemaVersion: 1,
    mode: "commit",
    runtimeId: descriptor.runtimeId,
    workspaceId: descriptor.workspaceId,
    scope: { kind: "project", projectId },
    baseRevision: 0,
    actor: { source: "system", id: "e2e" },
    operations: [
      {
        kind: "createFrame",
        frameId,
        slug: "portrait",
        name: "Portrait",
        width: 1080,
        height: 1350,
      },
    ],
  });
});

test.afterAll(async () => {
  if (runtime && runtime.exitCode === null) {
    runtime.kill("SIGTERM");
    await once(runtime, "exit").catch(() => undefined);
  }
  await rm(root, { recursive: true, force: true });
});

test("two Studio sessions and MCP synchronize without self-echo or provenance spoofing", async ({
  browser,
}, testInfo) => {
  test.setTimeout(60_000);
  const collaborationProjectId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const collaborationFrameId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  await request("/api/transactions", {
    schemaVersion: 1,
    mode: "commit",
    runtimeId: descriptor.runtimeId,
    workspaceId: descriptor.workspaceId,
    scope: { kind: "workspace" },
    baseRevision: null,
    actor: { source: "studio", id: "setup" },
    operations: [
      {
        kind: "createProject",
        projectId: collaborationProjectId,
        slug: "collaboration-e2e",
        name: "Collaboration E2E",
      },
    ],
  });
  await request("/api/transactions", {
    schemaVersion: 1,
    mode: "commit",
    runtimeId: descriptor.runtimeId,
    workspaceId: descriptor.workspaceId,
    scope: { kind: "project", projectId: collaborationProjectId },
    baseRevision: 0,
    actor: { source: "studio", id: "setup" },
    operations: [
      {
        kind: "createFrame",
        frameId: collaborationFrameId,
        slug: "shared-frame",
        name: "Shared frame",
        width: 1080,
        height: 1350,
      },
    ],
  });

  const firstContext = await browser.newContext();
  const secondContext = await browser.newContext();
  const firstPage = await firstContext.newPage();
  const secondPage = await secondContext.newPage();
  let firstFrameLoads = 0;
  let secondFrameLoads = 0;
  const framePath = `/api/projects/${collaborationProjectId}/frames/${collaborationFrameId}`;
  firstPage.on("request", (browserRequest) => {
    if (
      browserRequest.method() === "GET" &&
      new URL(browserRequest.url()).pathname === framePath
    )
      firstFrameLoads += 1;
  });
  secondPage.on("request", (browserRequest) => {
    if (
      browserRequest.method() === "GET" &&
      new URL(browserRequest.url()).pathname === framePath
    )
      secondFrameLoads += 1;
  });

  const firstIdentityResponse = firstPage.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/clients/session" &&
      response.request().method() === "POST",
  );
  const secondIdentityResponse = secondPage.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/clients/session" &&
      response.request().method() === "POST",
  );
  await Promise.all([
    bootstrapStudio(
      firstPage,
      `/project/${collaborationProjectId}/frame/${collaborationFrameId}`,
    ),
    bootstrapStudio(
      secondPage,
      `/project/${collaborationProjectId}/frame/${collaborationFrameId}`,
    ),
  ]);
  await Promise.all([
    expect(
      firstPage.getByRole("button", { name: /Shared frame/ }),
    ).toContainText("r0"),
    expect(
      secondPage.getByRole("button", { name: /Shared frame/ }),
    ).toContainText("r0"),
  ]);
  const firstIdentity = (await (await firstIdentityResponse).json()) as {
    clientId: string;
    sessionId: string;
    source: string;
  };
  const secondIdentity = (await (await secondIdentityResponse).json()) as {
    clientId: string;
    sessionId: string;
    source: string;
  };
  expect(firstIdentity.source).toBe("studio");
  expect(secondIdentity.source).toBe("studio");
  expect(firstIdentity.sessionId).not.toBe(secondIdentity.sessionId);
  expect(firstIdentity.clientId).not.toBe(secondIdentity.clientId);
  firstFrameLoads = 0;
  secondFrameLoads = 0;

  await firstPage.getByRole("button", { name: "Add rectangle" }).click();
  await Promise.all([
    expect(
      firstPage.getByRole("button", { name: /Shared frame/ }),
    ).toContainText("r1"),
    expect(
      secondPage.getByRole("button", { name: /Shared frame/ }),
    ).toContainText("r1"),
  ]);
  await expect.poll(() => firstFrameLoads).toBe(1);
  await expect.poll(() => secondFrameLoads).toBe(1);

  await secondPage.getByRole("button", { name: "Add ellipse" }).click();
  await Promise.all([
    expect(
      firstPage.getByRole("button", { name: /Shared frame/ }),
    ).toContainText("r2"),
    expect(
      secondPage.getByRole("button", { name: /Shared frame/ }),
    ).toContainText("r2"),
  ]);
  await expect.poll(() => firstFrameLoads).toBe(2);
  await expect.poll(() => secondFrameLoads).toBe(2);

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["apps/mcp/dist/cli.js", "--descriptor", descriptorPath],
    cwd: process.cwd(),
    stderr: "pipe",
  });
  const mcp = new Client({ name: "collaboration-e2e", version: "1.0.0" });
  await mcp.connect(transport);
  try {
    const inspected = await mcp.callTool({
      name: "get_frame",
      arguments: {
        projectId: collaborationProjectId,
        frameId: collaborationFrameId,
      },
    });
    const canonical = inspected.structuredContent as {
      revision: number;
      root: {
        children: Array<{
          id: string;
          opacity: number;
          transform: { x: number; y: number };
        }>;
      };
    };
    expect(canonical.revision).toBe(2);
    const target = canonical.root.children[0]!;
    const committed = await mcp.callTool({
      name: "commit_batch",
      arguments: {
        scope: "frame",
        projectId: collaborationProjectId,
        frameId: collaborationFrameId,
        baseRevision: canonical.revision,
        actorId: "collab-mcp",
        operations: [
          {
            kind: "updateNode",
            nodeId: target.id,
            propertyGroup: "compositing",
            value: { opacity: 0.75 },
          },
        ],
      },
    });
    expect(committed.isError, JSON.stringify(committed.content)).not.toBe(true);
    await Promise.all([
      expect(
        firstPage.getByRole("button", { name: /Shared frame/ }),
      ).toContainText("r3"),
      expect(
        secondPage.getByRole("button", { name: /Shared frame/ }),
      ).toContainText("r3"),
    ]);

    const rectangleLayer = firstPage
      .getByRole("treeitem")
      .filter({ hasText: "Rectangle" });
    await rectangleLayer.click();
    const selectionBox = firstPage.locator(".selection-box");
    const initialBounds = await selectionBox.boundingBox();
    expect(initialBounds).not.toBeNull();
    await firstPage.mouse.move(
      initialBounds!.x + initialBounds!.width / 2,
      initialBounds!.y + initialBounds!.height / 2,
    );
    await firstPage.mouse.down();
    await firstPage.mouse.move(
      initialBounds!.x + initialBounds!.width / 2 + 48,
      initialBounds!.y + initialBounds!.height / 2,
      { steps: 6 },
    );
    await expect(firstPage.getByText("Unsaved", { exact: true })).toBeVisible();

    const agentDuringGesture = await mcp.callTool({
      name: "commit_batch",
      arguments: {
        scope: "frame",
        projectId: collaborationProjectId,
        frameId: collaborationFrameId,
        baseRevision: 3,
        actorId: "gesture-agent",
        operations: [
          {
            kind: "updateNode",
            nodeId: target.id,
            propertyGroup: "transform",
            value: { x: target.transform.x + 16 },
          },
        ],
      },
    });
    expect(
      agentDuringGesture.isError,
      JSON.stringify(agentDuringGesture.content),
    ).not.toBe(true);
    await expect(
      secondPage.getByRole("button", { name: /Shared frame/ }),
    ).toContainText("r4");
    await expect(
      firstPage.getByRole("button", { name: /Shared frame/ }),
    ).toContainText("r4");
    await expect(
      firstPage.getByText("Canonical frame updated externally."),
    ).toBeVisible();
    await firstPage.mouse.up();
    await expect(
      firstPage.getByRole("heading", { name: /Canonical state moved/ }),
    ).toHaveCount(0);

    await rectangleLayer.click();
    const colorButton = firstPage.getByRole("button", { name: "Paint color" });
    await colorButton.click();
    const colorField = firstPage.getByRole("slider", {
      name: "Saturation and brightness",
    });
    const colorBounds = await colorField.boundingBox();
    expect(colorBounds).not.toBeNull();
    await firstPage.mouse.move(colorBounds!.x + 24, colorBounds!.y + 24);
    await firstPage.mouse.down();
    await firstPage.mouse.move(
      colorBounds!.x + colorBounds!.width - 28,
      colorBounds!.y + colorBounds!.height / 2,
      { steps: 8 },
    );
    await expect(firstPage.getByText("Unsaved", { exact: true })).toBeVisible();
    const agentFillConflict = await mcp.callTool({
      name: "commit_batch",
      arguments: {
        scope: "frame",
        projectId: collaborationProjectId,
        frameId: collaborationFrameId,
        baseRevision: 4,
        actorId: "conflict-agent",
        operations: [
          {
            kind: "updateNode",
            nodeId: target.id,
            propertyGroup: "fill",
            value: {
              fill: { type: "solid", color: "#FF3366", opacity: 1 },
            },
          },
        ],
      },
    });
    expect(
      agentFillConflict.isError,
      JSON.stringify(agentFillConflict.content),
    ).not.toBe(true);
    await expect(
      secondPage.getByRole("button", { name: /Shared frame/ }),
    ).toContainText("r5");
    await firstPage.mouse.up();
    await expect(
      firstPage.getByRole("heading", {
        name: "Canonical state moved to r5",
      }),
    ).toBeVisible();
    await expect(
      firstPage.locator("code", { hasText: `node:${target.id}.fill` }).first(),
    ).toBeVisible();
    await expect(
      firstPage.getByRole("button", { name: "Commit reviewed rebase" }),
    ).toHaveCount(0);
    await expect(
      firstPage.getByRole("button", { name: /Shared frame/ }),
    ).toContainText("r5");
    await firstPage.screenshot({
      path: testInfo.outputPath("semantic-conflict-review.png"),
      fullPage: true,
    });
    await firstPage.getByRole("button", { name: "Discard draft" }).click();

    if (!(await colorField.isVisible())) await colorButton.click();
    const rebaseColorBounds = await colorField.boundingBox();
    expect(rebaseColorBounds).not.toBeNull();
    await firstPage.mouse.move(
      rebaseColorBounds!.x + 32,
      rebaseColorBounds!.y + 32,
    );
    await firstPage.mouse.down();
    await firstPage.mouse.move(
      rebaseColorBounds!.x + rebaseColorBounds!.width / 2,
      rebaseColorBounds!.y + rebaseColorBounds!.height - 32,
      { steps: 8 },
    );
    await expect(firstPage.getByText("Unsaved", { exact: true })).toBeVisible();
    const unrelatedAgentChange = await mcp.callTool({
      name: "commit_batch",
      arguments: {
        scope: "frame",
        projectId: collaborationProjectId,
        frameId: collaborationFrameId,
        baseRevision: 5,
        actorId: "rebase-agent",
        operations: [
          {
            kind: "updateNode",
            nodeId: target.id,
            propertyGroup: "transform",
            value: { y: target.transform.y + 16 },
          },
        ],
      },
    });
    expect(
      unrelatedAgentChange.isError,
      JSON.stringify(unrelatedAgentChange.content),
    ).not.toBe(true);
    await expect(
      secondPage.getByRole("button", { name: /Shared frame/ }),
    ).toContainText("r6");
    await firstPage.mouse.up();
    await expect(
      firstPage.getByRole("heading", {
        name: "Rebased preview ready at r6",
      }),
    ).toBeVisible();
    await firstPage.getByText("Intervening canonical changes").click();
    await expect(
      firstPage
        .locator("code", { hasText: `node:${target.id}.transform.y` })
        .first(),
    ).toBeVisible();
    await expect(
      firstPage.getByRole("button", { name: /Shared frame/ }),
    ).toContainText("r6");
    await firstPage.screenshot({
      path: testInfo.outputPath("safe-rebase-review.png"),
      fullPage: true,
    });
    await firstPage
      .getByRole("button", { name: "Commit reviewed rebase" })
      .click();
    await Promise.all([
      expect(
        firstPage.getByRole("button", { name: /Shared frame/ }),
      ).toContainText("r7"),
      expect(
        secondPage.getByRole("button", { name: /Shared frame/ }),
      ).toContainText("r7"),
    ]);
  } finally {
    await mcp.close();
  }

  const historyResponse = await fetch(
    `${descriptor.baseUrl}${framePath}/history`,
    {
      headers: {
        authorization: `Bearer ${descriptor.capabilityToken}`,
        "x-design-runtime-id": descriptor.runtimeId,
        "x-design-workspace-id": descriptor.workspaceId,
      },
    },
  );
  expect(historyResponse.status).toBe(200);
  const history = (await historyResponse.json()) as Array<{
    revision: number;
    actor: {
      source: string;
      id: string;
      clientId?: string;
      sessionId?: string;
    };
  }>;
  const participantEntries = history.filter((entry) => entry.revision > 0);
  expect(participantEntries.map((entry) => entry.actor.source)).toEqual([
    "studio",
    "studio",
    "mcp",
    "mcp",
    "mcp",
    "mcp",
    "studio",
  ]);
  expect(participantEntries[0]?.actor.sessionId).toBe(firstIdentity.sessionId);
  expect(participantEntries[1]?.actor.sessionId).toBe(secondIdentity.sessionId);
  expect(participantEntries[2]?.actor.id).toBe("collab-mcp");
  expect(participantEntries[2]?.actor.clientId).toBeTruthy();
  expect(participantEntries[2]?.actor.sessionId).toBeTruthy();
  expect(participantEntries[3]?.actor.id).toBe("gesture-agent");
  expect(participantEntries[4]?.actor.id).toBe("conflict-agent");
  expect(participantEntries[5]?.actor.id).toBe("rebase-agent");
  expect(participantEntries[6]?.actor.sessionId).toBe(firstIdentity.sessionId);

  await Promise.all([firstContext.close(), secondContext.close()]);
});

test("direct text editing commits once and rebases safely with MCP", async ({
  page,
}, testInfo) => {
  test.setTimeout(60_000);
  const textProjectId = "84848484-8484-4848-8848-848484848484";
  const textFrameId = "85858585-8585-4858-8858-858585858585";
  const fixedTextId = "86868686-8686-4868-8868-868686868686";
  const autoTextId = "87878787-8787-4878-8878-878787878787";
  await request("/api/transactions", {
    schemaVersion: 1,
    mode: "commit",
    runtimeId: descriptor.runtimeId,
    workspaceId: descriptor.workspaceId,
    scope: { kind: "workspace" },
    baseRevision: null,
    actor: { source: "system", id: "direct-text-e2e" },
    operations: [
      {
        kind: "createProject",
        projectId: textProjectId,
        slug: "direct-text-e2e",
        name: "Direct Text E2E",
      },
    ],
  });
  const fontForm = new FormData();
  fontForm.set("baseRevision", "0");
  fontForm.set("licenseNotes", "SIL Open Font License test fixture.");
  fontForm.set(
    "file",
    new File(
      [
        await readFile(
          path.join(
            process.cwd(),
            "apps/studio/node_modules/@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-600-normal.woff2",
          ),
        ),
      ],
      "ibm-plex-sans-600.woff2",
      { type: "font/woff2" },
    ),
  );
  const fontResponse = await fetch(
    `${descriptor.baseUrl}/api/projects/${textProjectId}/fonts/import`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${descriptor.capabilityToken}`,
        "x-design-runtime-id": descriptor.runtimeId,
        "x-design-workspace-id": descriptor.workspaceId,
      },
      body: fontForm,
    },
  );
  const importedFont = (await fontResponse.json()) as { font: { id: string } };
  expect(fontResponse.status).toBe(200);
  await request("/api/transactions", {
    schemaVersion: 1,
    mode: "commit",
    runtimeId: descriptor.runtimeId,
    workspaceId: descriptor.workspaceId,
    scope: { kind: "project", projectId: textProjectId },
    baseRevision: 1,
    actor: { source: "system", id: "direct-text-e2e" },
    operations: [
      {
        kind: "createFrame",
        frameId: textFrameId,
        slug: "text-workflow",
        name: "Text workflow",
        width: 800,
        height: 600,
      },
    ],
  });
  const transform = (x: number, y: number, width: number, height: number) => ({
    x,
    y,
    width,
    height,
    rotation: 0,
    scaleX: 1,
    scaleY: 1,
    skewX: 0,
    skewY: 0,
    anchorX: 0,
    anchorY: 0,
  });
  const typography = {
    fontId: importedFont.font.id,
    fontSize: 34,
    fontWeight: 600,
    fontStyle: "normal" as const,
    lineHeight: 42,
    letterSpacing: 0,
    alignment: "left" as const,
    verticalAlignment: "top" as const,
    color: "#F4F6FF",
    opacity: 1,
  };
  await request("/api/transactions", {
    schemaVersion: 1,
    mode: "commit",
    runtimeId: descriptor.runtimeId,
    workspaceId: descriptor.workspaceId,
    scope: {
      kind: "frame",
      projectId: textProjectId,
      frameId: textFrameId,
    },
    baseRevision: 0,
    actor: { source: "system", id: "direct-text-e2e" },
    operations: [
      {
        kind: "createNode",
        parentId: "root",
        node: {
          id: fixedTextId,
          type: "text",
          name: "Campaign headline",
          visible: true,
          locked: false,
          transform: transform(100, 110, 500, 60),
          opacity: 1,
          blendMode: "normal",
          text: "Original campaign headline",
          typography,
          textBox: {
            mode: "fixed",
            width: 500,
            height: 60,
            wrapping: "word",
            overflow: "clip",
            overflowAccepted: false,
          },
        },
      },
      {
        kind: "createNode",
        parentId: "root",
        node: {
          id: autoTextId,
          type: "text",
          name: "Auto width label",
          visible: true,
          locked: false,
          transform: transform(100, 280, 180, 50),
          opacity: 1,
          blendMode: "normal",
          text: "Auto label",
          typography: { ...typography, fontSize: 28, lineHeight: 34 },
          textBox: {
            mode: "autoWidth",
            width: 180,
            height: 50,
            wrapping: "none",
            overflow: "visible",
          },
        },
      },
    ],
  });

  let studioTransactions = 0;
  page.on("request", (browserRequest) => {
    if (
      browserRequest.method() === "POST" &&
      new URL(browserRequest.url()).pathname === "/api/transactions"
    )
      studioTransactions += 1;
  });
  await bootstrapStudio(page, `/project/${textProjectId}/frame/${textFrameId}`);
  await expect(
    page.getByRole("button", { name: /Text workflow/ }),
  ).toContainText("r1");
  const canvas = page.locator("canvas");
  const fixedLayer = page
    .getByRole("treeitem")
    .filter({ hasText: "Campaign headline" });
  await fixedLayer.click();
  const fixedBounds = await page.locator(".selection-box").boundingBox();
  expect(fixedBounds).not.toBeNull();
  await page.getByRole("button", { name: "Text tool", exact: true }).click();
  await expect(canvas).toHaveAttribute("data-active-tool", "text");
  await page.mouse.click(
    fixedBounds!.x + fixedBounds!.width / 2,
    fixedBounds!.y + fixedBounds!.height / 2,
  );
  const editor = page.getByRole("textbox", { name: "Text content" });
  await expect(editor).toBeFocused();
  await expect(canvas).toHaveAttribute("data-tool-state", "text:editing");
  await editor.fill(
    "This campaign headline is deliberately long enough to exceed the fixed text box across multiple lines.",
  );
  await expect(
    page.getByText(/Text exceeds the fixed box and will be clipped/),
  ).toBeVisible();
  expect(studioTransactions).toBe(0);
  await page.screenshot({
    path: testInfo.outputPath("direct-text-overflow.png"),
    fullPage: true,
  });
  await page.keyboard.press("Escape");
  await expect(editor).toHaveCount(0);
  await expect(canvas).toHaveAttribute("data-tool-state", "text:idle");
  expect(studioTransactions).toBe(0);
  await expect(
    page.getByRole("button", { name: /Text workflow/ }),
  ).toContainText("r1");
  await page.getByRole("button", { name: "Select tool", exact: true }).click();
  await expect(canvas).toHaveAttribute("data-active-tool", "select");

  await fixedLayer.click();
  await page.getByRole("button", { name: "Edit text on canvas" }).click();
  await editor.fill("Campaign headline revised");
  await page.getByRole("button", { name: "Save text" }).click();
  await expect(
    page.getByRole("button", { name: /Text workflow/ }),
  ).toContainText("r2");
  expect(studioTransactions).toBe(1);
  let canonicalResponse = await fetch(
    `${descriptor.baseUrl}/api/projects/${textProjectId}/frames/${textFrameId}`,
    {
      headers: {
        authorization: `Bearer ${descriptor.capabilityToken}`,
        "x-design-runtime-id": descriptor.runtimeId,
        "x-design-workspace-id": descriptor.workspaceId,
      },
    },
  );
  let canonical = (await canonicalResponse.json()) as {
    revision: number;
    root: {
      children: Array<{
        id: string;
        text: string;
        transform: { width: number; height: number };
        typography: { fontSize: number };
      }>;
    };
  };
  expect(canonical.root.children).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        id: fixedTextId,
        text: "Campaign headline revised",
      }),
      expect.objectContaining({ id: autoTextId, text: "Auto label" }),
    ]),
  );

  const autoLayer = page
    .getByRole("treeitem")
    .filter({ hasText: "Auto width label" });
  await autoLayer.click();
  await expect(autoLayer).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("textbox", { name: "Name" })).toHaveValue(
    "Auto width label",
  );
  await expect
    .poll(async () => (await page.locator(".selection-box").boundingBox())?.y)
    .toBeGreaterThan(fixedBounds!.y + 20);
  const autoBounds = await page.locator(".selection-box").boundingBox();
  expect(autoBounds).not.toBeNull();
  await page.mouse.dblclick(
    autoBounds!.x + autoBounds!.width / 2,
    autoBounds!.y + autoBounds!.height / 2,
  );
  await expect(editor).toBeFocused();
  await expect(editor).toHaveValue("Auto label");
  await editor.fill("Auto width campaign label expanded");
  await expect(page.getByText(/Auto size will resolve(?: to)?/)).toBeVisible();
  await page.keyboard.press(
    process.platform === "darwin" ? "Meta+Enter" : "Control+Enter",
  );
  await expect(
    page.getByRole("button", { name: /Text workflow/ }),
  ).toContainText("r3");
  expect(studioTransactions).toBe(2);
  canonicalResponse = await fetch(
    `${descriptor.baseUrl}/api/projects/${textProjectId}/frames/${textFrameId}`,
    { headers: runtimeHeaders() },
  );
  canonical = (await canonicalResponse.json()) as typeof canonical;
  const autoNode = canonical.root.children.find(
    (node) => node.id === autoTextId,
  )!;
  expect(autoNode.text).toBe("Auto width campaign label expanded");
  expect(autoNode.transform.width).toBeGreaterThan(180);

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["apps/mcp/dist/cli.js", "--descriptor", descriptorPath],
    cwd: process.cwd(),
    stderr: "pipe",
  });
  const mcp = new Client({ name: "direct-text-e2e", version: "1.0.0" });
  await mcp.connect(transport);
  try {
    await fixedLayer.click();
    await canvas.focus();
    await page.keyboard.press("F2");
    await editor.fill("Human text survives a concurrent agent style edit");
    const agentChange = await mcp.callTool({
      name: "commit_batch",
      arguments: {
        scope: "frame",
        projectId: textProjectId,
        frameId: textFrameId,
        baseRevision: 3,
        actorId: "direct-text-agent",
        operations: [
          {
            kind: "updateNode",
            nodeId: fixedTextId,
            propertyGroup: "typography",
            value: { fontSize: 38 },
          },
        ],
      },
    });
    expect(agentChange.isError, JSON.stringify(agentChange.content)).not.toBe(
      true,
    );
    await expect(
      page.getByRole("button", { name: /Text workflow/ }),
    ).toContainText("r4");
    await expect(editor).toHaveValue(
      "Human text survives a concurrent agent style edit",
    );
    await page.getByRole("button", { name: "Save text" }).click();
    await expect(
      page.getByRole("heading", { name: "Rebased preview ready at r4" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Commit reviewed rebase" }),
    ).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath("direct-text-agent-rebase.png"),
      fullPage: true,
    });
    await page.getByRole("button", { name: "Commit reviewed rebase" }).click();
    await expect(
      page.getByRole("button", { name: /Text workflow/ }),
    ).toContainText("r5");

    await fixedLayer.click();
    await canvas.focus();
    await page.keyboard.press("F2");
    await editor.fill("Human draft must not overwrite a concurrent agent edit");
    const overlappingAgentChange = await mcp.callTool({
      name: "commit_batch",
      arguments: {
        scope: "frame",
        projectId: textProjectId,
        frameId: textFrameId,
        baseRevision: 5,
        actorId: "direct-text-conflict-agent",
        operations: [
          {
            kind: "updateNode",
            nodeId: fixedTextId,
            propertyGroup: "textContent",
            value: { text: "Agent canonical text wins until human review" },
          },
        ],
      },
    });
    expect(
      overlappingAgentChange.isError,
      JSON.stringify(overlappingAgentChange.content),
    ).not.toBe(true);
    await expect(
      page.getByRole("button", { name: /Text workflow/ }),
    ).toContainText("r6");
    await expect(editor).toHaveValue(
      "Human draft must not overwrite a concurrent agent edit",
    );
    await page.getByRole("button", { name: "Save text" }).click();
    await expect(
      page.getByRole("heading", { name: "Canonical state moved to r6" }),
    ).toBeVisible();
    await expect(
      page.locator("code", { hasText: `node:${fixedTextId}.text` }).first(),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Commit reviewed rebase" }),
    ).toHaveCount(0);
    await page.screenshot({
      path: testInfo.outputPath("direct-text-agent-conflict.png"),
      fullPage: true,
    });
    await page.getByRole("button", { name: "Discard draft" }).click();
  } finally {
    await mcp.close();
  }

  canonicalResponse = await fetch(
    `${descriptor.baseUrl}/api/projects/${textProjectId}/frames/${textFrameId}`,
    { headers: runtimeHeaders() },
  );
  canonical = (await canonicalResponse.json()) as typeof canonical;
  expect(canonical.revision).toBe(6);
  expect(
    canonical.root.children.find((node) => node.id === fixedTextId),
  ).toMatchObject({
    id: fixedTextId,
    text: "Agent canonical text wins until human review",
    typography: { fontSize: 38 },
  });
  expect(canonical.root.children.map((node) => node.id)).toEqual([
    fixedTextId,
    autoTextId,
  ]);
  const historyResponse = await fetch(
    `${descriptor.baseUrl}/api/projects/${textProjectId}/frames/${textFrameId}/history`,
    { headers: runtimeHeaders() },
  );
  const history = (await historyResponse.json()) as Array<{
    revision: number;
    actor: { source: string; id: string };
  }>;
  expect(history.find((entry) => entry.revision === 4)?.actor).toMatchObject({
    source: "mcp",
    id: "direct-text-agent",
  });
  expect(history.find((entry) => entry.revision === 6)?.actor).toMatchObject({
    source: "mcp",
    id: "direct-text-conflict-agent",
  });

  const canvasBounds = await canvas.boundingBox();
  expect(canvasBounds).not.toBeNull();
  await canvas.focus();
  await page.keyboard.press("t");
  await expect(canvas).toHaveAttribute("data-active-tool", "text");
  const newTextPoint = {
    x: canvasBounds!.x + canvasBounds!.width * 0.72,
    y: canvasBounds!.y + canvasBounds!.height * 0.78,
  };
  await page.mouse.click(newTextPoint.x, newTextPoint.y);
  await expect(editor).toHaveValue("Text");
  await editor.fill("Cancelled canvas note");
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("button", { name: /Text workflow/ }),
  ).toContainText("r6");

  await page.mouse.click(newTextPoint.x, newTextPoint.y);
  await editor.fill("New canvas note");
  await page.getByRole("button", { name: "Save text" }).click();
  await expect(
    page.getByRole("button", { name: /Text workflow/ }),
  ).toContainText("r7");

  const inspectorContent = page.getByRole("textbox", {
    name: /Content Changes preview live/,
  });
  await inspectorContent.fill("New canvas note revised in Inspector");
  await expect(
    page.getByRole("status").filter({ hasText: "Unsaved" }),
  ).toBeVisible();
  await page.getByRole("textbox", { name: "Name" }).click();
  await expect(
    page.getByRole("button", { name: /Text workflow/ }),
  ).toContainText("r8");
  canonicalResponse = await fetch(
    `${descriptor.baseUrl}/api/projects/${textProjectId}/frames/${textFrameId}`,
    { headers: runtimeHeaders() },
  );
  canonical = (await canonicalResponse.json()) as typeof canonical;
  expect(canonical.root.children).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ text: "New canvas note revised in Inspector" }),
    ]),
  );
});

test("rich text spans migrate, render, edit, export, and flatten canonically", async ({
  page,
}, testInfo) => {
  test.setTimeout(60_000);
  const richProjectId = "91919191-9191-4919-8919-919191919191";
  const richFrameId = "92929292-9292-4929-8929-929292929292";
  const richTextId = "93939393-9393-4939-8939-939393939393";
  await request("/api/transactions", {
    schemaVersion: 1,
    mode: "commit",
    runtimeId: descriptor.runtimeId,
    workspaceId: descriptor.workspaceId,
    scope: { kind: "workspace" },
    baseRevision: null,
    actor: { source: "system", id: "rich-text-e2e" },
    operations: [
      {
        kind: "createProject",
        projectId: richProjectId,
        slug: "rich-text-e2e",
        name: "Rich Text E2E",
      },
    ],
  });
  const baseFont = await importProjectFont({
    projectId: richProjectId,
    baseRevision: 0,
    path: path.join(
      process.cwd(),
      "apps/studio/node_modules/@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-600-normal.woff2",
    ),
    filename: "ibm-plex-sans-600.woff2",
  });
  const emphasisFont = await importProjectFont({
    projectId: richProjectId,
    baseRevision: 1,
    path: path.join(
      process.cwd(),
      "apps/studio/node_modules/@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-400-normal.woff2",
    ),
    filename: "ibm-plex-mono-400.woff2",
  });
  await request("/api/transactions", {
    schemaVersion: 1,
    mode: "commit",
    runtimeId: descriptor.runtimeId,
    workspaceId: descriptor.workspaceId,
    scope: { kind: "project", projectId: richProjectId },
    baseRevision: 2,
    actor: { source: "system", id: "rich-text-e2e" },
    operations: [
      {
        kind: "createFrame",
        frameId: richFrameId,
        slug: "rich-text",
        name: "Rich text",
        width: 720,
        height: 480,
      },
    ],
  });
  await request("/api/transactions", {
    schemaVersion: 1,
    mode: "commit",
    runtimeId: descriptor.runtimeId,
    workspaceId: descriptor.workspaceId,
    scope: {
      kind: "frame",
      projectId: richProjectId,
      frameId: richFrameId,
    },
    baseRevision: 0,
    actor: { source: "system", id: "rich-text-e2e" },
    operations: [
      {
        kind: "createNode",
        parentId: "root",
        node: {
          id: richTextId,
          type: "text",
          name: "Campaign statement",
          visible: true,
          locked: false,
          transform: {
            x: 80,
            y: 150,
            width: 560,
            height: 100,
            rotation: 0,
            scaleX: 1,
            scaleY: 1,
            skewX: 0,
            skewY: 0,
            anchorX: 0,
            anchorY: 0,
          },
          opacity: 1,
          blendMode: "normal",
          text: "Make AI useful",
          typography: {
            fontId: baseFont.id,
            fontSize: 42,
            fontWeight: 600,
            fontStyle: "normal",
            lineHeight: 58,
            letterSpacing: 0,
            alignment: "left",
            verticalAlignment: "middle",
            color: "#2B2E38",
            opacity: 1,
          },
          textBox: {
            mode: "fixed",
            width: 560,
            height: 100,
            wrapping: "word",
            overflow: "clip",
            overflowAccepted: false,
          },
        },
      },
    ],
  });

  await bootstrapStudio(page, `/project/${richProjectId}/frame/${richFrameId}`);
  await page
    .getByRole("treeitem")
    .filter({ hasText: "Campaign statement" })
    .click();
  const canvas = page.locator("canvas");
  await canvas.focus();
  await page.keyboard.press("F2");
  const editor = page.getByRole("textbox", { name: "Text content" });
  await expect(editor).toBeFocused();
  await editor.press("Home");
  for (let index = 0; index < 4; index += 1)
    await editor.press("Shift+ArrowRight");
  await expect(page.getByText("Selection 0–4")).toBeVisible();
  await page
    .getByRole("combobox", { name: "Selection font" })
    .selectOption(emphasisFont.id);
  await page.getByRole("button", { name: "Bold selection" }).click();
  await page.getByRole("button", { name: "Italic selection" }).click();
  await page
    .getByRole("combobox", { name: "Selection decoration" })
    .selectOption("underline");
  await page.getByLabel("Selection color").fill("#315cf5");
  for (const [label, value] of [
    ["Selection font size", "52"],
    ["Selection opacity", "0.75"],
    ["Selection tracking", "1.5"],
    ["Selection baseline shift", "4"],
  ] as const) {
    const input = page.getByLabel(label);
    await input.fill(value);
    await input.blur();
    await expect(editor).toBeFocused();
    await expect(page.getByText("Selection 0–4")).toBeVisible();
  }
  await page.getByRole("button", { name: "Save text" }).click();
  await expect(page.getByRole("button", { name: /Rich text/ })).toContainText(
    "r2",
  );

  let canonicalResponse = await fetch(
    `${descriptor.baseUrl}/api/projects/${richProjectId}/frames/${richFrameId}`,
    { headers: runtimeHeaders() },
  );
  type RichCanonical = {
    revision: number;
    root: {
      children: Array<{
        id: string;
        text: string;
        typography: { fontId: string; fontSize: number };
        spans?: Array<{
          id: string;
          start: number;
          end: number;
          style: Record<string, unknown>;
        }>;
      }>;
    };
  };
  let canonical = (await canonicalResponse.json()) as RichCanonical;
  const richNode = canonical.root.children[0]!;
  expect(richNode.id).toBe(richTextId);
  expect(richNode.typography).toMatchObject({
    fontId: baseFont.id,
    fontSize: 42,
  });
  expect(richNode.spans).toHaveLength(2);
  expect(richNode.spans?.[0]).toMatchObject({
    start: 0,
    end: 4,
    style: {
      fontId: emphasisFont.id,
      fontSize: 52,
      fontWeight: 700,
      fontStyle: "italic",
      color: "#315cf5",
      opacity: 0.75,
      letterSpacing: 1.5,
      baselineShift: 4,
      decoration: "underline",
    },
  });
  expect(richNode.spans?.[1]).toMatchObject({
    start: 4,
    end: "Make AI useful".length,
    style: {},
  });

  await expect(page.getByText("2 rich text spans")).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("rich-text-studio.png"),
    fullPage: true,
  });
  const previewResponse = await fetch(
    `${descriptor.baseUrl}/api/projects/${richProjectId}/frames/${richFrameId}/render-preview`,
    { method: "POST", headers: runtimeHeaders() },
  );
  expect(previewResponse.status).toBe(200);
  const previewBytes = Buffer.from(await previewResponse.arrayBuffer());
  expect(previewBytes.length).toBeGreaterThan(1_000);
  await writeFile(testInfo.outputPath("rich-text-preview.png"), previewBytes);
  const exportResponse = await fetch(
    `${descriptor.baseUrl}/api/projects/${richProjectId}/frames/${richFrameId}/export`,
    { method: "POST", headers: runtimeHeaders() },
  );
  const exportResult = (await exportResponse.json()) as { path: string };
  expect(exportResponse.status, JSON.stringify(exportResult)).toBe(200);
  const exportBytes = await readFile(
    path.join(root, "projects", "rich-text-e2e", exportResult.path),
  );
  expect(exportBytes).toEqual(previewBytes);

  await page.getByRole("button", { name: "Edit text on canvas" }).click();
  await editor.fill("Make practical AI useful");
  await page.getByRole("button", { name: "Save text" }).click();
  await expect(page.getByRole("button", { name: /Rich text/ })).toContainText(
    "r3",
  );
  canonicalResponse = await fetch(
    `${descriptor.baseUrl}/api/projects/${richProjectId}/frames/${richFrameId}`,
    { headers: runtimeHeaders() },
  );
  canonical = (await canonicalResponse.json()) as RichCanonical;
  expect(canonical.root.children[0]).toMatchObject({
    id: richTextId,
    text: "Make practical AI useful",
  });
  expect(canonical.root.children[0]!.spans?.[0]).toMatchObject({
    start: 0,
    end: 4,
    style: { fontId: emphasisFont.id, color: "#315cf5" },
  });

  await page
    .getByRole("button", { name: "Flatten to paragraph style" })
    .click();
  await expect(page.getByRole("button", { name: /Rich text/ })).toContainText(
    "r4",
  );
  canonicalResponse = await fetch(
    `${descriptor.baseUrl}/api/projects/${richProjectId}/frames/${richFrameId}`,
    { headers: runtimeHeaders() },
  );
  canonical = (await canonicalResponse.json()) as RichCanonical;
  expect(canonical.root.children).toHaveLength(1);
  expect(canonical.root.children[0]).not.toHaveProperty("spans");
  expect(canonical.root.children[0]).toMatchObject({
    id: richTextId,
    text: "Make practical AI useful",
    typography: { fontId: baseFont.id, fontSize: 42 },
  });

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["apps/mcp/dist/cli.js", "--descriptor", descriptorPath],
    cwd: process.cwd(),
    stderr: "pipe",
  });
  const mcp = new Client({ name: "rich-text-e2e", version: "1.0.0" });
  await mcp.connect(transport);
  try {
    const agentFormat = await mcp.callTool({
      name: "commit_batch",
      arguments: {
        scope: "frame",
        projectId: richProjectId,
        frameId: richFrameId,
        baseRevision: 4,
        actorId: "rich-text-agent",
        operations: [
          {
            kind: "updateNode",
            nodeId: richTextId,
            propertyGroup: "textContent",
            value: {
              text: "Make practical AI useful",
              spans: [
                {
                  id: "agent-emphasis",
                  start: 0,
                  end: 4,
                  style: { fontWeight: 800, color: "#315CF5" },
                },
                {
                  id: "agent-remainder",
                  start: 4,
                  end: "Make practical AI useful".length,
                  style: {},
                },
              ],
            },
          },
        ],
      },
    });
    expect(agentFormat.isError, JSON.stringify(agentFormat.content)).not.toBe(
      true,
    );
  } finally {
    await mcp.close();
  }
  await expect(page.getByRole("button", { name: /Rich text/ })).toContainText(
    "r5",
  );
  await page
    .getByRole("treeitem")
    .filter({ hasText: "Campaign statement" })
    .click();
  await expect(page.getByText("2 rich text spans")).toBeVisible();
  canonicalResponse = await fetch(
    `${descriptor.baseUrl}/api/projects/${richProjectId}/frames/${richFrameId}`,
    { headers: runtimeHeaders() },
  );
  canonical = (await canonicalResponse.json()) as RichCanonical;
  expect(canonical.root.children[0]!.spans?.[0]).toMatchObject({
    id: "agent-emphasis",
    start: 0,
    end: 4,
    style: { fontWeight: 800, color: "#315CF5" },
  });
  const historyResponse = await fetch(
    `${descriptor.baseUrl}/api/projects/${richProjectId}/frames/${richFrameId}/history`,
    { headers: runtimeHeaders() },
  );
  const history = (await historyResponse.json()) as Array<{
    revision: number;
    actor: { source: string; id: string };
  }>;
  expect(history.find((entry) => entry.revision === 5)?.actor).toMatchObject({
    source: "mcp",
    id: "rich-text-agent",
  });
});

test("ordered effect stacks migrate, edit, reorder, and render canonically", async ({
  page,
}, testInfo) => {
  const effectProjectId = "81818181-8181-4181-8181-818181818181";
  const effectFrameId = "82828282-8282-4282-8282-828282828282";
  const effectNodeId = "83838383-8383-4383-8383-838383838383";
  await request("/api/transactions", {
    schemaVersion: 1,
    mode: "commit",
    runtimeId: descriptor.runtimeId,
    workspaceId: descriptor.workspaceId,
    scope: { kind: "workspace" },
    baseRevision: null,
    actor: { source: "system", id: "effect-stack-e2e" },
    operations: [
      {
        kind: "createProject",
        projectId: effectProjectId,
        slug: "effect-stack-e2e",
        name: "Effect Stack E2E",
      },
    ],
  });
  await request("/api/transactions", {
    schemaVersion: 1,
    mode: "commit",
    runtimeId: descriptor.runtimeId,
    workspaceId: descriptor.workspaceId,
    scope: { kind: "project", projectId: effectProjectId },
    baseRevision: 0,
    actor: { source: "system", id: "effect-stack-e2e" },
    operations: [
      {
        kind: "createFrame",
        frameId: effectFrameId,
        slug: "effect-stack",
        name: "Effect Stack",
        width: 720,
        height: 480,
      },
    ],
  });
  await request("/api/transactions", {
    schemaVersion: 1,
    mode: "commit",
    runtimeId: descriptor.runtimeId,
    workspaceId: descriptor.workspaceId,
    scope: {
      kind: "frame",
      projectId: effectProjectId,
      frameId: effectFrameId,
    },
    baseRevision: 0,
    actor: { source: "system", id: "effect-stack-e2e" },
    operations: [
      {
        kind: "createNode",
        parentId: "root",
        node: {
          id: effectNodeId,
          type: "rectangle",
          name: "Campaign card",
          visible: true,
          locked: false,
          transform: {
            x: 180,
            y: 120,
            width: 360,
            height: 240,
            rotation: 0,
            scaleX: 1,
            scaleY: 1,
            skewX: 0,
            skewY: 0,
            anchorX: 0,
            anchorY: 0,
          },
          opacity: 1,
          blendMode: "normal",
          fill: { type: "solid", color: "#F4F5F8", opacity: 1 },
          cornerRadius: {
            topLeft: 28,
            topRight: 28,
            bottomRight: 28,
            bottomLeft: 28,
          },
          effects: {
            outerShadow: {
              enabled: true,
              offsetX: 0,
              offsetY: 14,
              blur: 24,
              spread: 0,
              color: "#000000",
              opacity: 0.35,
            },
          },
        },
      },
    ],
  });
  await bootstrapStudio(
    page,
    `/project/${effectProjectId}/frame/${effectFrameId}`,
  );
  const frameButton = page.getByRole("button", { name: /Effect Stack/ });
  await expect(frameButton).toContainText("r1");
  const layer = page.getByRole("treeitem").filter({ hasText: "Campaign card" });
  await layer.click();
  await expect(page.getByText("Legacy outer shadow")).toBeVisible();
  await page.getByLabel("Add effect").selectOption({ label: "Inner shadow" });
  await expect(frameButton).toContainText("r2");
  const migratedResponse = await fetch(
    `${descriptor.baseUrl}/api/projects/${effectProjectId}/frames/${effectFrameId}`,
    { headers: runtimeHeaders() },
  );
  const migrated = (await migratedResponse.json()) as {
    root: {
      children: Array<{
        id: string;
        effects: { items: Array<{ id: string }> };
      }>;
    };
  };
  expect(migrated.root.children[0]).toMatchObject({
    id: effectNodeId,
    effects: {
      items: [
        { id: "legacy-outer-shadow" },
        expect.objectContaining({ id: expect.any(String) }),
      ],
    },
  });

  const stackItems = [
    {
      id: "legacy-outer-shadow",
      type: "outerShadow",
      enabled: true,
      offsetX: 0,
      offsetY: 14,
      blur: 24,
      spread: 0,
      color: "#000000",
      opacity: 0.35,
    },
    {
      id: "inner-shadow",
      type: "innerShadow",
      enabled: true,
      offsetX: 3,
      offsetY: 5,
      blur: 10,
      spread: 0,
      color: "#111827",
      opacity: 0.35,
    },
    { id: "soft-blur", type: "blur", enabled: true, radius: 1.5 },
    {
      id: "inner-glow",
      type: "innerGlow",
      enabled: true,
      blur: 8,
      spread: 1,
      color: "#FFFFFF",
      opacity: 0.4,
    },
    {
      id: "outer-glow",
      type: "outerGlow",
      enabled: true,
      blur: 16,
      spread: 2,
      color: "#315CF5",
      opacity: 0.4,
    },
    {
      id: "color-overlay",
      type: "colorOverlay",
      enabled: true,
      paint: { type: "solid", color: "#FF3366", opacity: 1 },
      opacity: 0.24,
    },
    {
      id: "gradient-overlay",
      type: "gradientOverlay",
      enabled: true,
      paint: {
        type: "linearGradient",
        start: { x: 0, y: 0 },
        end: { x: 1, y: 1 },
        stops: [
          {
            id: "84848484-8484-4484-8484-848484848484",
            offset: 0,
            color: "#315CF5",
            opacity: 0.7,
          },
          {
            id: "85858585-8585-4585-8585-858585858585",
            offset: 1,
            color: "#FFB000",
            opacity: 0.7,
          },
        ],
        interpolation: "linear-srgb",
        spread: "pad",
        dither: true,
      },
      opacity: 0.45,
    },
  ];
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["apps/mcp/dist/cli.js", "--descriptor", descriptorPath],
    cwd: process.cwd(),
    stderr: "pipe",
  });
  const mcp = new Client({ name: "effect-stack-e2e", version: "1.0.0" });
  await mcp.connect(transport);
  try {
    const committed = await mcp.callTool({
      name: "commit_batch",
      arguments: {
        scope: "frame",
        projectId: effectProjectId,
        frameId: effectFrameId,
        baseRevision: 2,
        actorId: "effect-stack-agent",
        operations: [
          {
            kind: "updateNode",
            nodeId: effectNodeId,
            propertyGroup: "effects",
            value: { effects: { items: stackItems } },
          },
        ],
      },
    });
    expect(committed.isError, JSON.stringify(committed.content)).not.toBe(true);
  } finally {
    await mcp.close();
  }
  await expect(frameButton).toContainText("r3");
  const historyResponse = await fetch(
    `${descriptor.baseUrl}/api/projects/${effectProjectId}/frames/${effectFrameId}/history`,
    { headers: runtimeHeaders() },
  );
  const history = (await historyResponse.json()) as Array<{
    revision: number;
    actor: { source: string; id: string };
  }>;
  expect(history.find((entry) => entry.revision === 3)?.actor).toMatchObject({
    source: "mcp",
    id: "effect-stack-agent",
  });
  await layer.click();
  for (const label of [
    "Outer shadow",
    "Inner shadow",
    "Blur",
    "Inner glow",
    "Outer glow",
    "Color overlay",
    "Gradient overlay",
  ])
    await expect(
      page
        .locator(".effect-heading strong")
        .filter({ hasText: new RegExp(`^${label}$`) }),
    ).toHaveCount(1);

  const render = async (): Promise<Buffer> => {
    const response = await fetch(
      `${descriptor.baseUrl}/api/projects/${effectProjectId}/frames/${effectFrameId}/render-preview`,
      { method: "POST", headers: runtimeHeaders() },
    );
    const bytes = Buffer.from(await response.arrayBuffer());
    expect(response.status, bytes.toString("utf8")).toBe(200);
    return bytes;
  };
  const initial = await render();
  expect(initial.byteLength).toBeGreaterThan(5_000);
  await writeFile(
    testInfo.outputPath("ordered-effect-stack-initial.png"),
    initial,
  );
  expect(createHash("sha256").update(initial).digest("hex")).toBe(
    "42018bbacf7e8e444a9f8af8cb7e4028af39a6b64cc7d7377c156048faa31587",
  );
  await page.getByRole("button", { name: "Move Gradient overlay up" }).click();
  await expect(frameButton).toContainText("r4");
  const reordered = await render();
  expect(reordered.equals(initial)).toBe(false);
  await layer.click();
  await page
    .getByRole("button", { name: "Move Gradient overlay down" })
    .click();
  await expect(frameButton).toContainText("r5");
  const restored = await render();
  expect(restored).toEqual(initial);

  await layer.click();
  const blurCard = page.locator(".effect-card").filter({
    has: page.locator(".effect-heading strong", { hasText: /^Blur$/ }),
  });
  await blurCard.getByLabel("Enabled").click();
  await expect(frameButton).toContainText("r6");
  expect((await render()).equals(initial)).toBe(false);
  await layer.click();
  await blurCard.getByLabel("Enabled").click();
  await expect(frameButton).toContainText("r7");
  expect(await render()).toEqual(initial);

  await layer.click();
  await page.getByRole("button", { name: "Duplicate Color overlay" }).click();
  await expect(frameButton).toContainText("r8");
  await layer.click();
  const colorCards = page
    .locator(".effect-card")
    .filter({ hasText: "Color overlay" });
  await expect(colorCards).toHaveCount(2);
  await colorCards
    .last()
    .getByRole("button", { name: "Remove Color overlay" })
    .click();
  await expect(frameButton).toContainText("r9");
  const finalRender = await render();
  expect(finalRender).toEqual(initial);
  await writeFile(
    testInfo.outputPath("ordered-effect-stack-render.png"),
    finalRender,
  );
  await layer.click();
  await page.screenshot({
    path: testInfo.outputPath("ordered-effect-stack-studio.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "Export PNG" }).click();
  await expect(page.locator(".feedback-toast")).toContainText(
    "Exported 720×480",
  );
  const exported = await readFile(
    path.join(
      root,
      "projects",
      "effect-stack-e2e",
      "exports",
      "effect-stack-r9.png",
    ),
  );
  expect(exported).toEqual(finalRender);
});

test("professional crop mode previews locally, cancels cleanly, and commits once", async ({
  page,
}, testInfo) => {
  test.setTimeout(90_000);
  const cropProjectId = "86868686-8686-4686-8686-868686868686";
  const cropFrameId = "87878787-8787-4787-8787-878787878787";
  const cropNodeId = "88868686-8686-4686-8686-868686868888";
  await request("/api/transactions", {
    schemaVersion: 1,
    mode: "commit",
    runtimeId: descriptor.runtimeId,
    workspaceId: descriptor.workspaceId,
    scope: { kind: "workspace" },
    baseRevision: null,
    actor: { source: "system", id: "crop-mode-e2e" },
    operations: [
      {
        kind: "createProject",
        projectId: cropProjectId,
        slug: "crop-mode-e2e",
        name: "Crop Mode E2E",
      },
    ],
  });
  await request("/api/transactions", {
    schemaVersion: 1,
    mode: "commit",
    runtimeId: descriptor.runtimeId,
    workspaceId: descriptor.workspaceId,
    scope: { kind: "project", projectId: cropProjectId },
    baseRevision: 0,
    actor: { source: "system", id: "crop-mode-e2e" },
    operations: [
      {
        kind: "createFrame",
        frameId: cropFrameId,
        slug: "campaign-crop",
        name: "Campaign Crop",
        width: 720,
        height: 480,
      },
    ],
  });

  const runtimeRequire = createRequire(
    path.join(process.cwd(), "apps/runtime/package.json"),
  );
  const cropSharp = runtimeRequire("sharp") as (input: Buffer) => {
    png: () => { toBuffer: () => Promise<Buffer> };
  };
  const campaignRaster = await cropSharp(
    Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="720" height="480"><rect width="360" height="480" fill="#315cf5"/><rect x="360" width="360" height="480" fill="#ffb000"/><circle cx="360" cy="240" r="92" fill="#ffffff"/><circle cx="360" cy="240" r="54" fill="#ff3366"/></svg>',
    ),
  )
    .png()
    .toBuffer();
  const replacementRaster = await cropSharp(
    Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="900" height="600"><rect width="450" height="600" fill="#101820"/><rect x="450" width="450" height="600" fill="#8b5cf6"/><circle cx="450" cy="300" r="110" fill="#f4f5f8"/></svg>',
    ),
  )
    .png()
    .toBuffer();
  const importRaster = async (
    baseRevision: number,
    filename: string,
    bytes: Buffer,
  ): Promise<{ id: string; width: number; height: number }> => {
    const form = new FormData();
    form.set("baseRevision", String(baseRevision));
    form.set("file", new File([bytes], filename, { type: "image/png" }));
    const response = await fetch(
      `${descriptor.baseUrl}/api/projects/${cropProjectId}/assets/import`,
      { method: "POST", headers: runtimeHeaders(), body: form },
    );
    const result = (await response.json()) as {
      asset: { id: string; width: number; height: number };
    };
    expect(response.status, JSON.stringify(result)).toBe(200);
    return result.asset;
  };
  const campaignAsset = await importRaster(
    1,
    "campaign-source.png",
    campaignRaster,
  );
  const replacementAsset = await importRaster(
    2,
    "campaign-replacement.png",
    replacementRaster,
  );
  expect(campaignAsset).toMatchObject({ width: 720, height: 480 });
  expect(replacementAsset).toMatchObject({ width: 900, height: 600 });

  await request("/api/transactions", {
    schemaVersion: 1,
    mode: "commit",
    runtimeId: descriptor.runtimeId,
    workspaceId: descriptor.workspaceId,
    scope: {
      kind: "frame",
      projectId: cropProjectId,
      frameId: cropFrameId,
    },
    baseRevision: 0,
    actor: { source: "system", id: "crop-mode-e2e" },
    operations: [
      {
        kind: "createNode",
        parentId: "root",
        node: {
          id: cropNodeId,
          type: "rasterImage",
          name: "Campaign subject",
          visible: true,
          locked: false,
          transform: {
            x: 120,
            y: 90,
            width: 480,
            height: 300,
            rotation: 0,
            scaleX: 1,
            scaleY: 1,
            skewX: 0,
            skewY: 0,
            anchorX: 0,
            anchorY: 0,
          },
          opacity: 1,
          blendMode: "normal",
          assetId: campaignAsset.id,
          fit: "contain",
        },
      },
    ],
  });

  let transactionRequests = 0;
  page.on("request", (nextRequest) => {
    if (
      nextRequest.method() === "POST" &&
      new URL(nextRequest.url()).pathname === "/api/transactions"
    )
      transactionRequests += 1;
  });
  await bootstrapStudio(page, `/project/${cropProjectId}/frame/${cropFrameId}`);
  const frameButton = page.getByRole("button", { name: /Campaign Crop/ });
  const layer = page
    .getByRole("treeitem")
    .filter({ hasText: "Campaign subject" });
  const canvas = page.locator("canvas");
  await expect(frameButton).toContainText("r1");
  await layer.click();
  const canonicalBefore = await canvas.screenshot();
  const requestsBeforeCancel = transactionRequests;
  await page.getByRole("button", { name: "Crop on canvas" }).click();
  await expect(canvas).toHaveAttribute("data-tool-state", "crop:editing");
  const zoom = page.getByRole("slider", { name: "Crop zoom" });
  await zoom.fill("4");
  const cropSurface = page.getByLabel("Move image within crop bounds");
  await cropSurface.focus();
  await cropSurface.press("ArrowRight");
  await cropSurface.press("Shift+ArrowDown");
  await expect(page.getByText(/low resolution/i)).toBeVisible();
  await expect(page.getByText("Unsaved", { exact: true })).toBeVisible();
  await expect
    .poll(async () => (await canvas.screenshot()).equals(canonicalBefore))
    .toBe(false);
  expect(transactionRequests).toBe(requestsBeforeCancel);
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(canvas).toHaveAttribute("data-tool-state", "select:idle");
  await expect
    .poll(async () => (await canvas.screenshot()).equals(canonicalBefore))
    .toBe(true);
  await expect(frameButton).toContainText("r1");
  expect(transactionRequests).toBe(requestsBeforeCancel);

  await page.getByRole("button", { name: "Crop image on canvas" }).click();
  await zoom.fill("3");
  await cropSurface.focus();
  await cropSurface.press("ArrowLeft");
  await cropSurface.press("Shift+ArrowUp");
  await page.screenshot({
    path: testInfo.outputPath("professional-crop-mode-studio.png"),
    fullPage: true,
  });
  const requestsBeforeApply = transactionRequests;
  await page.getByRole("button", { name: "Apply crop" }).click();
  await expect(frameButton).toContainText("r2");
  expect(transactionRequests).toBe(requestsBeforeApply + 1);

  const readCanonical = async () => {
    const response = await fetch(
      `${descriptor.baseUrl}/api/projects/${cropProjectId}/frames/${cropFrameId}`,
      { headers: runtimeHeaders() },
    );
    return response.json() as Promise<{
      revision: number;
      root: {
        children: Array<{
          id: string;
          name: string;
          assetId: string;
          fit: string;
          crop?: { x: number; y: number; width: number; height: number };
        }>;
      };
    }>;
  };
  const cropped = await readCanonical();
  expect(cropped.revision).toBe(2);
  expect(cropped.root.children[0]).toMatchObject({
    id: cropNodeId,
    name: "Campaign subject",
    assetId: campaignAsset.id,
    fit: "cover",
    crop: {
      width: expect.closeTo(1 / 3, 6),
      height: expect.closeTo(1 / 3, 6),
    },
  });
  const committedCrop = structuredClone(cropped.root.children[0]!.crop);

  await layer.click();
  const imageSection = page.locator("details.inspector-section").filter({
    has: page.locator("summary", { hasText: /^Image/ }),
  });
  await imageSection
    .locator("select")
    .first()
    .selectOption(replacementAsset.id);
  await expect(frameButton).toContainText("r3");
  const replaced = await readCanonical();
  expect(replaced.root.children[0]).toMatchObject({
    id: cropNodeId,
    assetId: replacementAsset.id,
    crop: committedCrop,
  });

  const validationResponse = await fetch(
    `${descriptor.baseUrl}/api/projects/${cropProjectId}/frames/${cropFrameId}/validate`,
    { method: "POST", headers: runtimeHeaders() },
  );
  const validation = (await validationResponse.json()) as {
    valid: boolean;
    warnings: Array<{ code: string; nodeIds?: string[] }>;
  };
  expect(validationResponse.status).toBe(200);
  expect(validation.valid).toBe(true);
  expect(validation.warnings).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        code: "LOW_RESOLUTION_ASSET",
        nodeIds: [cropNodeId],
      }),
    ]),
  );

  const renderResponse = await fetch(
    `${descriptor.baseUrl}/api/projects/${cropProjectId}/frames/${cropFrameId}/render-preview`,
    { method: "POST", headers: runtimeHeaders() },
  );
  const rendered = Buffer.from(await renderResponse.arrayBuffer());
  expect(renderResponse.status, rendered.toString("utf8")).toBe(200);
  const exportResponse = await fetch(
    `${descriptor.baseUrl}/api/projects/${cropProjectId}/frames/${cropFrameId}/export`,
    { method: "POST", headers: runtimeHeaders() },
  );
  const exportResult = (await exportResponse.json()) as { path: string };
  expect(exportResponse.status, JSON.stringify(exportResult)).toBe(200);
  const exported = await readFile(
    path.join(root, "projects", "crop-mode-e2e", exportResult.path),
  );
  expect(exported).toEqual(rendered);
  await writeFile(
    testInfo.outputPath("professional-crop-mode-render.png"),
    rendered,
  );
});

test("rulers, persistent guides, safe areas, and equal-spacing snaps stay canonical", async ({
  page,
}, testInfo) => {
  const layoutProjectId = "89898989-8989-4989-8989-898989898989";
  const layoutFrameId = "90909090-9090-4090-8090-909090909090";
  const nodeIds = [
    "91919191-9191-4191-8191-919191919191",
    "92929292-9292-4292-8292-929292929292",
    "93939393-9393-4393-8393-939393939393",
  ];
  await request("/api/transactions", {
    schemaVersion: 1,
    mode: "commit",
    runtimeId: descriptor.runtimeId,
    workspaceId: descriptor.workspaceId,
    scope: { kind: "workspace" },
    baseRevision: null,
    actor: { source: "system", id: "layout-aids-e2e" },
    operations: [
      {
        kind: "createProject",
        projectId: layoutProjectId,
        slug: "layout-aids-e2e",
        name: "Layout Aids E2E",
      },
    ],
  });
  await request("/api/transactions", {
    schemaVersion: 1,
    mode: "commit",
    runtimeId: descriptor.runtimeId,
    workspaceId: descriptor.workspaceId,
    scope: { kind: "project", projectId: layoutProjectId },
    baseRevision: 0,
    actor: { source: "system", id: "layout-aids-e2e" },
    operations: [
      {
        kind: "createFrame",
        frameId: layoutFrameId,
        slug: "campaign-layout",
        name: "Campaign Layout",
        width: 600,
        height: 400,
      },
    ],
  });
  await request("/api/transactions", {
    schemaVersion: 1,
    mode: "commit",
    runtimeId: descriptor.runtimeId,
    workspaceId: descriptor.workspaceId,
    scope: {
      kind: "frame",
      projectId: layoutProjectId,
      frameId: layoutFrameId,
    },
    baseRevision: 0,
    actor: { source: "system", id: "layout-aids-e2e" },
    operations: [
      ...[
        { id: nodeIds[0]!, name: "Left card", x: 50, color: "#315CF5" },
        { id: nodeIds[1]!, name: "Middle card", x: 242, color: "#FF3366" },
        { id: nodeIds[2]!, name: "Right card", x: 450, color: "#FFB000" },
      ].map(({ id, name, x, color }) => ({
        kind: "createNode" as const,
        parentId: "root",
        node: {
          id,
          type: "rectangle" as const,
          name,
          visible: true,
          locked: false,
          transform: {
            x,
            y: 150,
            width: 100,
            height: 100,
            rotation: 0,
            scaleX: 1,
            scaleY: 1,
            skewX: 0,
            skewY: 0,
            anchorX: 0,
            anchorY: 0,
          },
          opacity: 1,
          blendMode: "normal" as const,
          fill: { type: "solid" as const, color, opacity: 1 },
          cornerRadius: {
            topLeft: 16,
            topRight: 16,
            bottomRight: 16,
            bottomLeft: 16,
          },
        },
      })),
    ],
  });
  const render = async () => {
    const response = await fetch(
      `${descriptor.baseUrl}/api/projects/${layoutProjectId}/frames/${layoutFrameId}/render-preview`,
      { method: "POST", headers: runtimeHeaders() },
    );
    const bytes = Buffer.from(await response.arrayBuffer());
    expect(response.status, bytes.toString("utf8")).toBe(200);
    return bytes;
  };
  const originalRender = await render();
  let transactionRequests = 0;
  page.on("request", (nextRequest) => {
    if (
      nextRequest.method() === "POST" &&
      new URL(nextRequest.url()).pathname === "/api/transactions"
    )
      transactionRequests += 1;
  });
  await bootstrapStudio(
    page,
    `/project/${layoutProjectId}/frame/${layoutFrameId}`,
  );
  const frameButton = page.getByRole("button", { name: /Campaign Layout/ });
  const canvas = page.locator("canvas");
  await expect(frameButton).toContainText("r1");
  await expect(
    page.getByRole("button", { name: /Horizontal ruler/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Vertical ruler/ }),
  ).toBeVisible();
  await expect(page.locator(".canvas-center-guides")).toBeVisible();

  await page.getByRole("button", { name: "Add vertical" }).click();
  await expect(frameButton).toContainText("r2");
  await expect(canvas).toHaveAttribute(
    "data-reconciliation-mode",
    "incremental",
  );
  await expect(canvas).toHaveAttribute("data-nodes-rebuilt", "0");
  const firstGuide = page.getByRole("slider", { name: "Vertical guide 1" });
  await expect(firstGuide).toHaveAttribute("aria-valuenow", "300");
  await firstGuide.focus();
  await firstGuide.press("ArrowRight");
  await expect(frameButton).toContainText("r3");
  await expect(firstGuide).toHaveAttribute("aria-valuenow", "301");

  const horizontalRuler = page.getByRole("button", {
    name: /Horizontal ruler/,
  });
  const rulerBounds = await horizontalRuler.boundingBox();
  expect(rulerBounds).not.toBeNull();
  await page.mouse.move(rulerBounds!.x + 80, rulerBounds!.y + 8);
  await page.mouse.down();
  await page.mouse.move(rulerBounds!.x + 140, rulerBounds!.y + 32, {
    steps: 5,
  });
  await page.mouse.up();
  await expect(frameButton).toContainText("r4");
  const secondGuide = page.getByRole("slider", { name: "Vertical guide 2" });
  await expect(secondGuide).toBeVisible();
  await secondGuide.focus();
  await secondGuide.press("Delete");
  await expect(frameButton).toContainText("r5");
  await expect(secondGuide).toHaveCount(0);

  await page.getByRole("button", { name: "Add 5% safe area" }).click();
  await expect(frameButton).toContainText("r6");
  await expect(page.locator(".safe-area-overlay")).toBeVisible();
  const metadataResponse = await fetch(
    `${descriptor.baseUrl}/api/projects/${layoutProjectId}/frames/${layoutFrameId}`,
    { headers: runtimeHeaders() },
  );
  const metadata = (await metadataResponse.json()) as {
    canvas: {
      guides: Array<{
        id: string;
        axis: "horizontal" | "vertical";
        position: number;
      }>;
    };
  };
  const agentGuideId = "94949494-9494-4494-8494-949494949494";
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["apps/mcp/dist/cli.js", "--descriptor", descriptorPath],
    cwd: process.cwd(),
    stderr: "pipe",
  });
  const mcp = new Client({ name: "layout-aids-e2e", version: "1.0.0" });
  await mcp.connect(transport);
  try {
    const committed = await mcp.callTool({
      name: "commit_batch",
      arguments: {
        scope: "frame",
        projectId: layoutProjectId,
        frameId: layoutFrameId,
        baseRevision: 6,
        actorId: "layout-aids-agent",
        operations: [
          {
            kind: "setCanvas",
            value: {
              guides: [
                ...metadata.canvas.guides,
                {
                  id: agentGuideId,
                  axis: "horizontal",
                  position: 200,
                },
              ],
            },
          },
        ],
      },
    });
    expect(committed.isError, JSON.stringify(committed.content)).not.toBe(true);
  } finally {
    await mcp.close();
  }
  await expect(frameButton).toContainText("r7");
  await expect(
    page.getByRole("slider", { name: "Horizontal guide 2" }),
  ).toHaveAttribute("aria-valuenow", "200");
  await page.getByRole("button", { name: "Remove horizontal guide 2" }).click();
  await expect(frameButton).toContainText("r8");
  expect(await render()).toEqual(originalRender);

  const requestsBeforeLocalToggles = transactionRequests;
  await page.getByRole("button", { name: "Snap on" }).click();
  await expect(page.getByRole("button", { name: "Snap off" })).toBeVisible();
  await page.getByRole("button", { name: "Snap off" }).click();
  await page.getByRole("button", { name: "Guides on" }).click();
  await expect(firstGuide).toBeHidden();
  await page.getByRole("button", { name: "Guides off" }).click();
  expect(transactionRequests).toBe(requestsBeforeLocalToggles);

  const middle = page.getByRole("treeitem").filter({ hasText: "Middle card" });
  await middle.click();
  const selectionBox = page.locator(".selection-box");
  const selectionBounds = await selectionBox.boundingBox();
  const canvasBounds = await canvas.boundingBox();
  expect(selectionBounds).not.toBeNull();
  expect(canvasBounds).not.toBeNull();
  const scale = canvasBounds!.width / 600;
  const requestsBeforeSnap = transactionRequests;
  await page.mouse.move(
    selectionBounds!.x + selectionBounds!.width / 2,
    selectionBounds!.y + selectionBounds!.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    selectionBounds!.x + selectionBounds!.width / 2 + 5 * scale,
    selectionBounds!.y + selectionBounds!.height / 2,
    { steps: 5 },
  );
  await expect(page.locator(".spacing-indicator")).toContainText("100 px");
  await expect(page.locator(".snap-line.kind-spacing")).toBeVisible();
  expect(transactionRequests).toBe(requestsBeforeSnap);
  await page.screenshot({
    path: testInfo.outputPath("layout-aids-spacing-snap.png"),
    fullPage: true,
  });
  await page.mouse.up();
  await expect(frameButton).toContainText("r9");
  expect(transactionRequests).toBe(requestsBeforeSnap + 1);

  const canonicalResponse = await fetch(
    `${descriptor.baseUrl}/api/projects/${layoutProjectId}/frames/${layoutFrameId}`,
    { headers: runtimeHeaders() },
  );
  const canonical = (await canonicalResponse.json()) as {
    revision: number;
    canvas: {
      guides: Array<{ id: string; axis: string; position: number }>;
      safeArea: { top: number; right: number; bottom: number; left: number };
    };
    root: { children: Array<{ id: string; transform: { x: number } }> };
  };
  expect(canonical.revision).toBe(9);
  expect(canonical.canvas.guides).toEqual([
    expect.objectContaining({ axis: "vertical", position: 301 }),
  ]);
  expect(canonical.canvas.safeArea).toEqual({
    top: 20,
    right: 30,
    bottom: 20,
    left: 30,
  });
  expect(canonical.root.children.map(({ id }) => id)).toEqual(nodeIds);
  expect(canonical.root.children[1]?.transform.x).toBe(250);
  const snappedRender = await render();
  await writeFile(testInfo.outputPath("layout-aids-render.png"), snappedRender);
  expect(snappedRender.equals(originalRender)).toBe(false);
  const historyResponse = await fetch(
    `${descriptor.baseUrl}/api/projects/${layoutProjectId}/frames/${layoutFrameId}/history`,
    { headers: runtimeHeaders() },
  );
  const history = (await historyResponse.json()) as Array<{
    revision: number;
    actor: { source: string; id: string };
  }>;
  expect(history.find((entry) => entry.revision === 7)?.actor).toMatchObject({
    source: "mcp",
    id: "layout-aids-agent",
  });
});

test("marketing presets resize and duplicate constrained frames canonically", async ({
  page,
}, testInfo) => {
  test.setTimeout(90_000);
  const resizeProjectId = "a1a1a1a1-a1a1-41a1-81a1-a1a1a1a1a1a1";
  const resizeFrameId = "b2b2b2b2-b2b2-42b2-82b2-b2b2b2b2b2b2";
  const nodeIds = [
    "c3c3c3c3-c3c3-43c3-83c3-c3c3c3c3c3c3",
    "d4d4d4d4-d4d4-44d4-84d4-d4d4d4d4d4d4",
    "e5e5e5e5-e5e5-45e5-85e5-e5e5e5e5e5e5",
  ];
  await request("/api/transactions", {
    schemaVersion: 1,
    mode: "commit",
    runtimeId: descriptor.runtimeId,
    workspaceId: descriptor.workspaceId,
    scope: { kind: "workspace" },
    baseRevision: null,
    actor: { source: "system", id: "frame-resize-e2e" },
    operations: [
      {
        kind: "createProject",
        projectId: resizeProjectId,
        slug: "frame-resize-e2e",
        name: "Frame Resize E2E",
      },
    ],
  });
  await request("/api/transactions", {
    schemaVersion: 1,
    mode: "commit",
    runtimeId: descriptor.runtimeId,
    workspaceId: descriptor.workspaceId,
    scope: { kind: "project", projectId: resizeProjectId },
    baseRevision: 0,
    actor: { source: "system", id: "frame-resize-e2e" },
    operations: [
      {
        kind: "createFrame",
        frameId: resizeFrameId,
        slug: "campaign-master",
        name: "Campaign Master",
        width: 1000,
        height: 1000,
      },
    ],
  });
  await request("/api/transactions", {
    schemaVersion: 1,
    mode: "commit",
    runtimeId: descriptor.runtimeId,
    workspaceId: descriptor.workspaceId,
    scope: {
      kind: "frame",
      projectId: resizeProjectId,
      frameId: resizeFrameId,
    },
    baseRevision: 0,
    actor: { source: "system", id: "frame-resize-e2e" },
    operations: [
      ...[
        {
          id: nodeIds[0]!,
          name: "Human constrained card",
          x: 100,
          y: 400,
          color: "#315CF5",
        },
        {
          id: nodeIds[1]!,
          name: "Centered card",
          x: 400,
          y: 400,
          color: "#FF3366",
          resizeConstraints: {
            horizontal: "center" as const,
            vertical: "middle" as const,
          },
        },
        {
          id: nodeIds[2]!,
          name: "Pinned card",
          x: 700,
          y: 700,
          color: "#FFB000",
        },
      ].map(({ id, name, x, y, color, resizeConstraints }) => ({
        kind: "createNode" as const,
        parentId: "root",
        node: {
          id,
          type: "rectangle" as const,
          name,
          visible: true,
          locked: false,
          transform: {
            x,
            y,
            width: 200,
            height: 100,
            rotation: 0,
            scaleX: 1,
            scaleY: 1,
            skewX: 0,
            skewY: 0,
            anchorX: 0,
            anchorY: 0,
          },
          ...(resizeConstraints ? { resizeConstraints } : {}),
          opacity: 1,
          blendMode: "normal" as const,
          fill: { type: "solid" as const, color, opacity: 1 },
          cornerRadius: {
            topLeft: 18,
            topRight: 18,
            bottomRight: 18,
            bottomLeft: 18,
          },
        },
      })),
      {
        kind: "setCanvas",
        value: {
          guides: [
            {
              id: "f6f6f6f6-f6f6-46f6-86f6-f6f6f6f6f6f6",
              axis: "vertical",
              position: 900,
            },
          ],
          safeArea: { top: 50, right: 50, bottom: 50, left: 50 },
        },
      },
    ],
  });

  const transactionBodies: Array<{
    scope: { kind: string };
    operations: Array<Record<string, unknown>>;
  }> = [];
  page.on("request", (nextRequest) => {
    if (
      nextRequest.method() === "POST" &&
      new URL(nextRequest.url()).pathname === "/api/transactions"
    ) {
      const body = nextRequest.postDataJSON() as (typeof transactionBodies)[0];
      transactionBodies.push(body);
    }
  });
  await bootstrapStudio(
    page,
    `/project/${resizeProjectId}/frame/${resizeFrameId}`,
  );
  const masterButton = page.getByRole("button", { name: /Campaign Master/ });
  await expect(masterButton).toContainText("r1");

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["apps/mcp/dist/cli.js", "--descriptor", descriptorPath],
    cwd: process.cwd(),
    stderr: "pipe",
  });
  const mcp = new Client({ name: "frame-resize-e2e", version: "1.0.0" });
  await mcp.connect(transport);
  try {
    const committed = await mcp.callTool({
      name: "commit_batch",
      arguments: {
        scope: "frame",
        projectId: resizeProjectId,
        frameId: resizeFrameId,
        baseRevision: 1,
        actorId: "resize-constraints-agent",
        operations: [
          {
            kind: "updateNode",
            nodeId: nodeIds[2],
            propertyGroup: "resizeConstraints",
            value: {
              constraints: { horizontal: "right", vertical: "bottom" },
            },
          },
        ],
      },
    });
    expect(committed.isError, JSON.stringify(committed.content)).not.toBe(true);
  } finally {
    await mcp.close();
  }
  await expect(masterButton).toContainText("r2");

  await page
    .getByRole("treeitem")
    .filter({ hasText: "Human constrained card" })
    .click();
  const constraintSection = page
    .locator("details.inspector-section")
    .filter({ hasText: "Resize constraints" });
  await constraintSection.locator("summary").click();
  await constraintSection
    .getByRole("combobox", { name: "Horizontal", exact: true })
    .selectOption("center");
  await expect(masterButton).toContainText("r3");
  await page
    .getByRole("treeitem")
    .filter({ hasText: "Human constrained card" })
    .click();
  const refreshedConstraintSection = page
    .locator("details.inspector-section")
    .filter({ hasText: "Resize constraints" });
  await refreshedConstraintSection.locator("summary").click();
  await refreshedConstraintSection
    .getByRole("combobox", { name: "Vertical", exact: true })
    .selectOption("middle");
  await expect(masterButton).toContainText("r4");

  await page.reload();
  await expect(masterButton).toContainText("r4");
  await page
    .getByLabel("Canvas format preset")
    .selectOption("youtube-thumbnail");
  await page.getByLabel("Resize behavior").selectOption("constraints");
  const requestsBeforeResize = transactionBodies.length;
  await page.getByRole("button", { name: "Resize frame", exact: true }).click();
  await expect(masterButton).toContainText("r5");
  expect(transactionBodies).toHaveLength(requestsBeforeResize + 1);
  const resizeRequest = transactionBodies.at(-1)!;
  expect(resizeRequest.scope.kind).toBe("frame");
  expect(resizeRequest.operations).toHaveLength(4);
  expect(resizeRequest.operations[0]).toMatchObject({
    kind: "setCanvas",
    value: { width: 1280, height: 720 },
  });
  await page.screenshot({
    path: testInfo.outputPath("marketing-frame-resize.png"),
    fullPage: true,
  });

  const resizedResponse = await fetch(
    `${descriptor.baseUrl}/api/projects/${resizeProjectId}/frames/${resizeFrameId}`,
    { headers: runtimeHeaders() },
  );
  const resized = (await resizedResponse.json()) as {
    revision: number;
    canvas: {
      width: number;
      height: number;
      guides: Array<{ position: number }>;
      safeArea: { top: number; right: number; bottom: number; left: number };
    };
    root: {
      children: Array<{
        id: string;
        resizeConstraints?: { horizontal: string; vertical: string };
        transform: { x: number; y: number };
      }>;
    };
  };
  expect(resized).toMatchObject({
    revision: 5,
    canvas: {
      width: 1280,
      height: 720,
      guides: [{ position: 900 }],
      safeArea: { top: 50, right: 50, bottom: 50, left: 50 },
    },
  });
  expect(resized.root.children.map(({ id }) => id)).toEqual(nodeIds);
  expect(resized.root.children.map(({ transform }) => transform)).toEqual([
    expect.objectContaining({ x: 240, y: 260 }),
    expect.objectContaining({ x: 540, y: 260 }),
    expect.objectContaining({ x: 980, y: 420 }),
  ]);
  expect(resized.root.children[0]!.resizeConstraints).toEqual({
    horizontal: "center",
    vertical: "middle",
  });
  const resizeHistoryResponse = await fetch(
    `${descriptor.baseUrl}/api/projects/${resizeProjectId}/frames/${resizeFrameId}/history`,
    { headers: runtimeHeaders() },
  );
  const resizeHistory = (await resizeHistoryResponse.json()) as Array<{
    revision: number;
    actor: { source: string; id: string };
  }>;
  expect(
    resizeHistory.find((entry) => entry.revision === 2)?.actor,
  ).toMatchObject({ source: "mcp", id: "resize-constraints-agent" });

  const requestsBeforeDuplicate = transactionBodies.length;
  await page
    .getByRole("button", { name: "Duplicate and resize frame" })
    .click();
  const variationDialog = page.getByRole("dialog");
  await variationDialog.getByLabel("Name").fill("Instagram variation");
  await variationDialog
    .getByLabel("Format preset")
    .selectOption("instagram-portrait");
  await variationDialog
    .getByLabel("Resize behavior")
    .selectOption("constraints");
  await variationDialog
    .getByRole("button", { name: "Create variation" })
    .click();
  await expect(
    page.getByRole("button", { name: /Instagram variation/ }),
  ).toContainText("1080×1350");
  expect(transactionBodies).toHaveLength(requestsBeforeDuplicate + 1);
  const duplicateRequest = transactionBodies.at(-1)!;
  expect(duplicateRequest.scope.kind).toBe("project");
  expect(duplicateRequest.operations).toHaveLength(1);
  expect(duplicateRequest.operations[0]).toMatchObject({
    kind: "duplicateFrame",
    frameId: resizeFrameId,
    name: "Instagram variation",
    resize: { width: 1080, height: 1350, strategy: "constraints" },
  });
  const duplicateFrameId = duplicateRequest.operations[0]![
    "newFrameId"
  ] as string;
  const duplicateResponse = await fetch(
    `${descriptor.baseUrl}/api/projects/${resizeProjectId}/frames/${duplicateFrameId}`,
    { headers: runtimeHeaders() },
  );
  const duplicate = (await duplicateResponse.json()) as typeof resized;
  expect(duplicate.canvas).toMatchObject({ width: 1080, height: 1350 });
  expect(duplicate.root.children.map(({ id }) => id)).toEqual(nodeIds);
  expect(duplicate.root.children.map(({ transform }) => transform)).toEqual([
    expect.objectContaining({ x: 140, y: 575 }),
    expect.objectContaining({ x: 440, y: 575 }),
    expect.objectContaining({ x: 780, y: 1050 }),
  ]);
  const duplicateRenderResponse = await fetch(
    `${descriptor.baseUrl}/api/projects/${resizeProjectId}/frames/${duplicateFrameId}/render-preview`,
    { method: "POST", headers: runtimeHeaders() },
  );
  const duplicateRender = Buffer.from(
    await duplicateRenderResponse.arrayBuffer(),
  );
  expect(duplicateRenderResponse.status).toBe(200);
  expect(duplicateRender.readUInt32BE(16)).toBe(1080);
  expect(duplicateRender.readUInt32BE(20)).toBe(1350);
  await writeFile(
    testInfo.outputPath("marketing-frame-variation.png"),
    duplicateRender,
  );

  const requestsBeforeCreate = transactionBodies.length;
  await page.getByRole("button", { name: "New frame" }).click();
  const createDialog = page.getByRole("dialog");
  await createDialog.getByLabel("Name").fill("Story blank");
  await createDialog.getByLabel("Format preset").selectOption("story-reel");
  await createDialog.getByRole("button", { name: "Create" }).click();
  await expect(page.getByRole("button", { name: /Story blank/ })).toContainText(
    "1080×1920",
  );
  expect(transactionBodies).toHaveLength(requestsBeforeCreate + 1);
  expect(transactionBodies.at(-1)!.operations).toEqual([
    expect.objectContaining({
      kind: "createFrame",
      name: "Story blank",
      width: 1080,
      height: 1920,
    }),
  ]);
});

test("legacy clipContent false is explicit and preserves exact preview-export semantics", async ({
  page,
}, testInfo) => {
  const clipProjectId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
  const clipFrameId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
  const clipNodeId = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
  await request("/api/transactions", {
    schemaVersion: 1,
    mode: "commit",
    runtimeId: descriptor.runtimeId,
    workspaceId: descriptor.workspaceId,
    scope: { kind: "workspace" },
    baseRevision: null,
    actor: { source: "studio", id: "clip-setup" },
    operations: [
      {
        kind: "createProject",
        projectId: clipProjectId,
        slug: "clip-contract-e2e",
        name: "Clip Contract E2E",
      },
    ],
  });
  await request("/api/transactions", {
    schemaVersion: 1,
    mode: "commit",
    runtimeId: descriptor.runtimeId,
    workspaceId: descriptor.workspaceId,
    scope: { kind: "project", projectId: clipProjectId },
    baseRevision: 0,
    actor: { source: "studio", id: "clip-setup" },
    operations: [
      {
        kind: "createFrame",
        frameId: clipFrameId,
        slug: "exact-canvas",
        name: "Exact canvas",
        width: 320,
        height: 240,
      },
    ],
  });
  await request("/api/transactions", {
    schemaVersion: 1,
    mode: "commit",
    runtimeId: descriptor.runtimeId,
    workspaceId: descriptor.workspaceId,
    scope: { kind: "frame", projectId: clipProjectId, frameId: clipFrameId },
    baseRevision: 0,
    actor: { source: "studio", id: "clip-setup" },
    operations: [
      {
        kind: "createNode",
        parentId: "root",
        node: {
          id: clipNodeId,
          type: "rectangle",
          name: "Partially outside",
          visible: true,
          locked: false,
          transform: {
            x: -80,
            y: 60,
            width: 200,
            height: 120,
            rotation: 0,
            scaleX: 1.1,
            scaleY: 0.9,
            skewX: 4,
            skewY: -2,
            anchorX: 0.25,
            anchorY: 0.4,
          },
          opacity: 1,
          blendMode: "normal",
          fill: {
            type: "radialGradient",
            center: { x: 0.5, y: 0.5 },
            radius: { x: 0.6, y: 0.5 },
            focalPoint: { x: 0.35, y: 0.4 },
            stops: [
              {
                id: "11111111-aaaa-4aaa-8aaa-111111111111",
                offset: 0,
                color: "#315CF5",
                opacity: 0.35,
              },
              {
                id: "22222222-aaaa-4aaa-8aaa-222222222222",
                offset: 1,
                color: "#0A1024",
                opacity: 0.9,
              },
            ],
            interpolation: "linear-srgb",
            spread: "pad",
            dither: true,
          },
          stroke: {
            enabled: true,
            width: 4,
            alignment: "center",
            opacity: 0.6,
            paint: { type: "solid", color: "#FFFFFF", opacity: 0.8 },
            dash: { values: [9, 3], offset: 2, cap: "round" },
          },
          effects: {
            outerShadow: {
              enabled: true,
              offsetX: 6,
              offsetY: 8,
              blur: 12,
              spread: 2,
              color: "#123456",
              opacity: 0.42,
            },
          },
          cornerRadius: {
            topLeft: 0,
            topRight: 0,
            bottomRight: 0,
            bottomLeft: 0,
          },
        },
      },
    ],
  });
  const render = async (): Promise<Buffer> => {
    const response = await fetch(
      `${descriptor.baseUrl}/api/projects/${clipProjectId}/frames/${clipFrameId}/render-preview`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${descriptor.capabilityToken}`,
          "x-design-runtime-id": descriptor.runtimeId,
          "x-design-workspace-id": descriptor.workspaceId,
        },
      },
    );
    const bytes = Buffer.from(await response.arrayBuffer());
    expect(
      response.status,
      response.ok ? undefined : bytes.toString("utf8"),
    ).toBe(200);
    return bytes;
  };
  const clipped = await render();
  expect(clipped.readUInt32BE(16)).toBe(320);
  expect(clipped.readUInt32BE(20)).toBe(240);

  await request("/api/transactions", {
    schemaVersion: 1,
    mode: "commit",
    runtimeId: descriptor.runtimeId,
    workspaceId: descriptor.workspaceId,
    scope: { kind: "frame", projectId: clipProjectId, frameId: clipFrameId },
    baseRevision: 1,
    actor: { source: "studio", id: "legacy-import" },
    operations: [{ kind: "setCanvas", value: { clipContent: false } }],
  });
  const legacy = await render();
  expect(legacy.equals(clipped)).toBe(true);
  const validation = (await request(
    `/api/projects/${clipProjectId}/frames/${clipFrameId}/validate`,
    {},
  )) as { warnings: Array<{ code: string; message: string }> };
  expect(validation.warnings).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ code: "CLIP_CONTENT_DEPRECATED" }),
      expect.objectContaining({
        code: "CONTENT_OUTSIDE_ARTBOARD",
        message: expect.stringContaining("still clip to the exact canvas"),
      }),
    ]),
  );

  await bootstrapStudio(page, `/project/${clipProjectId}/frame/${clipFrameId}`);
  await expect(
    page.getByRole("note", { name: "Canvas clipping contract" }),
  ).toContainText("deprecated false value");
  await expect(page.getByLabel("Clip content")).toHaveCount(0);
  await page.screenshot({
    path: testInfo.outputPath("legacy-clipping-contract.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "Normalize clipping" }).click();
  await expect(
    page.getByRole("button", { name: /Exact canvas/ }),
  ).toContainText("r3");
  await expect(
    page.getByRole("button", { name: "Normalize clipping" }),
  ).toHaveCount(0);
  expect((await render()).equals(clipped)).toBe(true);

  await page
    .getByRole("treeitem")
    .filter({ hasText: "Partially outside" })
    .click();
  await page.getByText("Advanced transform").click();
  await expect(page.getByLabel("anchorX")).toHaveValue("0.25");
  await expect(page.getByLabel("Stop alpha").first()).toHaveValue("0.35");
  await expect(page.getByLabel("Focal X")).toHaveValue("0.35");
  await expect(page.getByLabel("Stroke opacity")).toHaveValue("0.6");
  await expect(page.getByLabel("Dash values")).toHaveValue("9, 3");
  await expect(page.getByLabel("Dash offset")).toHaveValue("2");
  await expect(page.getByLabel("Dash cap")).toHaveValue("round");
  await expect(
    page.getByRole("button", { name: "Shadow color" }),
  ).toBeVisible();
  await expect(page.getByLabel("Shadow opacity")).toHaveValue("0.42");
  await page.getByText("Canonical details · read-only").click();
  await expect(page.locator(".canonical-details")).toContainText(
    '"focalPoint"',
  );
  await expect(page.locator(".canonical-details")).toContainText('"dash"');
  await expect(
    page.getByRole("button", { name: /Exact canvas/ }),
  ).toContainText("r3");
  await page.screenshot({
    path: testInfo.outputPath("advanced-property-parity.png"),
    fullPage: true,
  });

  const stopAlpha = page.getByLabel("Stop alpha").first();
  await stopAlpha.fill("0.5");
  await stopAlpha.press("Tab");
  await expect(
    page.getByRole("button", { name: /Exact canvas/ }),
  ).toContainText("r4");
  await expect(page.locator("canvas")).toHaveAttribute(
    "data-reconciliation-mode",
    "incremental",
  );
  await expect(page.locator("canvas")).toHaveAttribute(
    "data-reconciliation-dirty",
    "paint",
  );
  await expect(page.locator("canvas")).toHaveAttribute(
    "data-nodes-rebuilt",
    "1",
  );
  await expect(page.locator("canvas")).toHaveAttribute(
    "data-active-generated-textures",
    "2",
  );
  await page
    .getByRole("treeitem")
    .filter({ hasText: "Partially outside" })
    .click();
  await page
    .locator("details.inspector-section > summary")
    .filter({ hasText: "Stroke" })
    .click();
  const dashValues = page.getByLabel("Dash values");
  await dashValues.fill("9, 3, 2");
  await dashValues.press("Tab");
  await expect(
    page.getByText("Enter an even number of positive dash and gap values."),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Exact canvas/ }),
  ).toContainText("r4");
  await dashValues.fill("10, 4");
  await dashValues.press("Tab");
  await expect(
    page.getByRole("button", { name: /Exact canvas/ }),
  ).toContainText("r5");
  await expect(page.locator("canvas")).toHaveAttribute(
    "data-reconciliation-dirty",
    "paint",
  );
  await expect(page.locator("canvas")).toHaveAttribute(
    "data-active-generated-textures",
    "2",
  );
  await page
    .getByRole("treeitem")
    .filter({ hasText: "Partially outside" })
    .click();
  const shadowOpacity = page.getByLabel("Shadow opacity");
  await shadowOpacity.fill("0.5");
  await shadowOpacity.press("Tab");
  await expect(
    page.getByRole("button", { name: /Exact canvas/ }),
  ).toContainText("r6");
  await expect(page.locator("canvas")).toHaveAttribute(
    "data-reconciliation-dirty",
    "effect",
  );
  await expect(page.locator("canvas")).toHaveAttribute(
    "data-active-generated-textures",
    "2",
  );
  const canonicalResponse = await fetch(
    `${descriptor.baseUrl}/api/projects/${clipProjectId}/frames/${clipFrameId}`,
    {
      headers: {
        authorization: `Bearer ${descriptor.capabilityToken}`,
        "x-design-runtime-id": descriptor.runtimeId,
        "x-design-workspace-id": descriptor.workspaceId,
      },
    },
  );
  const canonicalFrame = (await canonicalResponse.json()) as {
    revision: number;
    root: {
      children: Array<{
        id: string;
        fill: {
          focalPoint: { x: number; y: number };
          stops: Array<{ opacity: number }>;
        };
        stroke: { dash: { values: number[] }; opacity: number };
        effects: {
          items: Array<{
            id: string;
            type: string;
            color: string;
            opacity: number;
          }>;
        };
      }>;
    };
  };
  expect(canonicalFrame).toMatchObject({
    revision: 6,
    root: {
      children: [
        {
          id: clipNodeId,
          fill: {
            focalPoint: { x: 0.35, y: 0.4 },
            stops: [{ opacity: 0.5 }, { opacity: 0.9 }],
          },
          stroke: { dash: { values: [10, 4] }, opacity: 0.6 },
          effects: {
            items: [
              {
                id: "legacy-outer-shadow",
                type: "outerShadow",
                color: "#123456",
                opacity: 0.5,
              },
            ],
          },
        },
      ],
    },
  });
});

test("250-node Studio open and incremental previews emit bounded metrics", async ({
  page,
}, testInfo) => {
  test.setTimeout(60_000);
  const performanceProjectId = "12345678-1234-4234-8234-123456789abc";
  const performanceFrameId = "87654321-4321-4321-8321-cba987654321";
  const nodeIds = Array.from({ length: 250 }, () => crypto.randomUUID());
  await request("/api/transactions", {
    schemaVersion: 1,
    mode: "commit",
    runtimeId: descriptor.runtimeId,
    workspaceId: descriptor.workspaceId,
    scope: { kind: "workspace" },
    baseRevision: null,
    actor: { source: "system", id: "performance-e2e" },
    operations: [
      {
        kind: "createProject",
        projectId: performanceProjectId,
        slug: "performance-e2e",
        name: "Performance E2E",
      },
    ],
  });
  await request("/api/transactions", {
    schemaVersion: 1,
    mode: "commit",
    runtimeId: descriptor.runtimeId,
    workspaceId: descriptor.workspaceId,
    scope: { kind: "project", projectId: performanceProjectId },
    baseRevision: 0,
    actor: { source: "system", id: "performance-e2e" },
    operations: [
      {
        kind: "createFrame",
        frameId: performanceFrameId,
        slug: "ordinary-250",
        name: "Ordinary 250",
        width: 1080,
        height: 1350,
      },
    ],
  });
  await request("/api/transactions", {
    schemaVersion: 1,
    mode: "commit",
    runtimeId: descriptor.runtimeId,
    workspaceId: descriptor.workspaceId,
    scope: {
      kind: "frame",
      projectId: performanceProjectId,
      frameId: performanceFrameId,
    },
    baseRevision: 0,
    actor: { source: "system", id: "performance-e2e" },
    operations: nodeIds.map((nodeId, index) => ({
      kind: "createNode",
      parentId: "root",
      node: {
        id: nodeId,
        type: "rectangle",
        name: `Performance ${index + 1}`,
        visible: true,
        locked: false,
        transform: {
          x: (index % 20) * 52,
          y: Math.floor(index / 20) * 52,
          width: 44,
          height: 44,
          rotation: 0,
          scaleX: 1,
          scaleY: 1,
          skewX: 0,
          skewY: 0,
          anchorX: 0,
          anchorY: 0,
        },
        opacity: 1,
        blendMode: "normal",
        fill: {
          type: "solid",
          color: index % 2 ? "#315CF5" : "#F0A24A",
          opacity: 1,
        },
        cornerRadius: {
          topLeft: 4,
          topRight: 4,
          bottomRight: 4,
          bottomLeft: 4,
        },
      },
    })),
  });

  await bootstrapStudio(
    page,
    `/project/${performanceProjectId}/frame/${performanceFrameId}`,
  );
  const canvas = page.locator("canvas");
  await expect(canvas).toHaveAttribute("data-renderer-state", "ready");
  await expect(canvas).toHaveAttribute("data-nodes-rebuilt", "250");
  const readMetrics = () =>
    canvas.evaluate((element) => ({
      mode: element.dataset.reconciliationMode,
      dirty: element.dataset.reconciliationDirty,
      reconciliationMs: Number(element.dataset.reconciliationDurationMs),
      renderMs: Number(element.dataset.renderDurationMs),
      rebuilt: Number(element.dataset.nodesRebuilt),
      updated: Number(element.dataset.nodesUpdatedInPlace),
      textures: Number(element.dataset.activeGeneratedTextures),
    }));
  const initial = await readMetrics();
  expect(initial.mode).toBe("full");
  expect(initial.reconciliationMs).toBeLessThan(1_000);

  await request("/api/transactions", {
    schemaVersion: 1,
    mode: "commit",
    runtimeId: descriptor.runtimeId,
    workspaceId: descriptor.workspaceId,
    scope: {
      kind: "frame",
      projectId: performanceProjectId,
      frameId: performanceFrameId,
    },
    baseRevision: 1,
    actor: { source: "system", id: "performance-e2e" },
    operations: [
      {
        kind: "updateNode",
        nodeId: nodeIds[125],
        propertyGroup: "transform",
        value: { x: 420, y: 520 },
      },
    ],
  });
  await expect(
    page.getByRole("button", { name: /Ordinary 250/ }),
  ).toContainText("r2");
  const transform = await readMetrics();
  expect(transform).toMatchObject({
    mode: "incremental",
    dirty: "transform",
    rebuilt: 0,
    updated: 1,
  });
  expect(transform.reconciliationMs).toBeLessThan(50);

  await request("/api/transactions", {
    schemaVersion: 1,
    mode: "commit",
    runtimeId: descriptor.runtimeId,
    workspaceId: descriptor.workspaceId,
    scope: {
      kind: "frame",
      projectId: performanceProjectId,
      frameId: performanceFrameId,
    },
    baseRevision: 2,
    actor: { source: "system", id: "performance-e2e" },
    operations: [
      {
        kind: "updateNode",
        nodeId: nodeIds[125],
        propertyGroup: "fill",
        value: {
          fill: { type: "solid", color: "#8B5CF6", opacity: 1 },
        },
      },
    ],
  });
  await expect(
    page.getByRole("button", { name: /Ordinary 250/ }),
  ).toContainText("r3");
  const paint = await readMetrics();
  expect(paint).toMatchObject({
    mode: "incremental",
    dirty: "paint",
    rebuilt: 1,
    updated: 0,
  });
  expect(paint.reconciliationMs).toBeLessThan(50);

  const exportStarted = performance.now();
  const rendered = await fetch(
    `${descriptor.baseUrl}/api/projects/${performanceProjectId}/frames/${performanceFrameId}/export`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${descriptor.capabilityToken}`,
        "x-design-runtime-id": descriptor.runtimeId,
        "x-design-workspace-id": descriptor.workspaceId,
      },
    },
  );
  const exportDurationMs = performance.now() - exportStarted;
  const exportResult = (await rendered.json()) as {
    width: number;
    height: number;
    durationMs: number;
    path: string;
  };
  expect(rendered.status, JSON.stringify(exportResult)).toBe(200);
  expect(exportResult.width).toBe(1080);
  expect(exportResult.height).toBe(1350);
  expect(exportResult.path).toMatch(/^exports\/.+-r3\.png$/);
  expect(exportResult.durationMs).toBeLessThan(2_000);
  expect(exportDurationMs).toBeLessThan(2_000);

  const complexFrameId = "79797979-7979-4797-8797-797979797979";
  await request("/api/transactions", {
    schemaVersion: 1,
    mode: "commit",
    runtimeId: descriptor.runtimeId,
    workspaceId: descriptor.workspaceId,
    scope: { kind: "project", projectId: performanceProjectId },
    baseRevision: 1,
    actor: { source: "system", id: "performance-e2e" },
    operations: [
      {
        kind: "createFrame",
        frameId: complexFrameId,
        slug: "text-mask-12",
        name: "Text and masks 12",
        width: 1080,
        height: 1350,
      },
    ],
  });
  const fontBytes = await readFile(
    path.join(
      process.cwd(),
      "apps/studio/node_modules/@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-600-normal.woff2",
    ),
  );
  const fontForm = new FormData();
  fontForm.set("baseRevision", "2");
  fontForm.set("licenseNotes", "SIL Open Font License performance fixture.");
  fontForm.set(
    "file",
    new File([fontBytes], "performance-ibm-plex-sans-600.woff2", {
      type: "font/woff2",
    }),
  );
  const fontResponse = await fetch(
    `${descriptor.baseUrl}/api/projects/${performanceProjectId}/fonts/import`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${descriptor.capabilityToken}`,
        "x-design-runtime-id": descriptor.runtimeId,
        "x-design-workspace-id": descriptor.workspaceId,
      },
      body: fontForm,
    },
  );
  const importedFont = (await fontResponse.json()) as { font: { id: string } };
  expect(fontResponse.status).toBe(200);
  const runtimeRequire = createRequire(
    path.join(process.cwd(), "apps/runtime/package.json"),
  );
  const sharp = runtimeRequire("sharp") as (input: {
    create: {
      width: number;
      height: number;
      channels: 4;
      background: { r: number; g: number; b: number; alpha: number };
    };
  }) => { png: () => { toBuffer: () => Promise<Buffer> } };
  const largeRasterBytes = await sharp({
    create: {
      width: 2048,
      height: 2048,
      channels: 4,
      background: { r: 49, g: 92, b: 245, alpha: 1 },
    },
  })
    .png()
    .toBuffer();
  const assetForm = new FormData();
  assetForm.set("baseRevision", "3");
  assetForm.set(
    "file",
    new File([largeRasterBytes], "performance-2048.png", {
      type: "image/png",
    }),
  );
  const assetResponse = await fetch(
    `${descriptor.baseUrl}/api/projects/${performanceProjectId}/assets/import`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${descriptor.capabilityToken}`,
        "x-design-runtime-id": descriptor.runtimeId,
        "x-design-workspace-id": descriptor.workspaceId,
      },
      body: assetForm,
    },
  );
  const importedAsset = (await assetResponse.json()) as {
    asset: { id: string; width: number; height: number };
  };
  expect(assetResponse.status).toBe(200);
  expect(importedAsset.asset).toMatchObject({ width: 2048, height: 2048 });
  const maskOperations = Array.from({ length: 12 }, (_, index) => {
    const nodeId = crypto.randomUUID();
    return [
      {
        kind: "createNode",
        parentId: "root",
        node: {
          id: nodeId,
          type: "rectangle",
          name: `Masked tile ${index + 1}`,
          visible: true,
          locked: false,
          transform: {
            x: 40 + (index % 4) * 210,
            y: 180 + Math.floor(index / 4) * 210,
            width: 180,
            height: 180,
            rotation: 0,
            scaleX: 1,
            scaleY: 1,
            skewX: 0,
            skewY: 0,
            anchorX: 0,
            anchorY: 0,
          },
          opacity: 1,
          blendMode: "normal",
          fill: {
            type: "solid",
            color: index % 2 ? "#315CF5" : "#F0A24A",
            opacity: 1,
          },
          cornerRadius: {
            topLeft: 0,
            topRight: 0,
            bottomRight: 0,
            bottomLeft: 0,
          },
        },
      },
      {
        kind: "applyMask",
        maskId: crypto.randomUUID(),
        name: `Performance mask ${index + 1}`,
        mode: index % 2 ? "luminance" : "alpha",
        inverted: index % 3 === 0,
        maskSource: {
          id: crypto.randomUUID(),
          type: "ellipse",
          name: `Mask source ${index + 1}`,
          visible: true,
          locked: false,
          transform: {
            x: 0,
            y: 0,
            width: 180,
            height: 180,
            rotation: 0,
            scaleX: 1,
            scaleY: 1,
            skewX: 0,
            skewY: 0,
            anchorX: 0,
            anchorY: 0,
          },
          opacity: 1,
          blendMode: "normal",
          fill: { type: "solid", color: "#FFFFFF", opacity: 1 },
        },
        nodeIds: [nodeId],
      },
    ];
  }).flat();
  await request("/api/transactions", {
    schemaVersion: 1,
    mode: "commit",
    runtimeId: descriptor.runtimeId,
    workspaceId: descriptor.workspaceId,
    scope: {
      kind: "frame",
      projectId: performanceProjectId,
      frameId: complexFrameId,
    },
    baseRevision: 0,
    actor: { source: "system", id: "performance-e2e" },
    operations: [
      {
        kind: "createNode",
        parentId: "root",
        node: {
          id: crypto.randomUUID(),
          type: "rasterImage",
          name: "Large raster",
          visible: true,
          locked: false,
          transform: {
            x: 860,
            y: 180,
            width: 180,
            height: 600,
            rotation: 0,
            scaleX: 1,
            scaleY: 1,
            skewX: 0,
            skewY: 0,
            anchorX: 0,
            anchorY: 0,
          },
          opacity: 1,
          blendMode: "normal",
          assetId: importedAsset.asset.id,
          fit: "cover",
          crop: { x: 0.2, y: 0.1, width: 0.6, height: 0.8 },
        },
      },
      {
        kind: "createNode",
        parentId: "root",
        node: {
          id: crypto.randomUUID(),
          type: "text",
          name: "Measured headline",
          visible: true,
          locked: false,
          transform: {
            x: 40,
            y: 40,
            width: 800,
            height: 90,
            rotation: 0,
            scaleX: 1,
            scaleY: 1,
            skewX: 0,
            skewY: 0,
            anchorX: 0,
            anchorY: 0,
          },
          opacity: 1,
          blendMode: "normal",
          text: "Measured text and mask-heavy scene",
          typography: {
            fontId: importedFont.font.id,
            fontSize: 42,
            fontWeight: 600,
            fontStyle: "normal",
            lineHeight: 50,
            letterSpacing: 0,
            alignment: "left",
            verticalAlignment: "top",
            color: "#FFFFFF",
            opacity: 1,
          },
          textBox: {
            mode: "fixed",
            width: 800,
            height: 90,
            wrapping: "word",
            overflow: "clip",
          },
        },
      },
      ...maskOperations,
    ],
  });
  const runtimeHeaders = {
    authorization: `Bearer ${descriptor.capabilityToken}`,
    "x-design-runtime-id": descriptor.runtimeId,
    "x-design-workspace-id": descriptor.workspaceId,
  };
  const validationStarted = performance.now();
  const validationResponse = await fetch(
    `${descriptor.baseUrl}/api/projects/${performanceProjectId}/frames/${complexFrameId}/validate`,
    { method: "POST", headers: runtimeHeaders },
  );
  const textValidationDurationMs = performance.now() - validationStarted;
  expect(validationResponse.status).toBe(200);
  expect(await validationResponse.json()).toMatchObject({ valid: true });
  expect(textValidationDurationMs).toBeLessThan(2_000);

  const maskRenderStarted = performance.now();
  const maskRenderResponse = await fetch(
    `${descriptor.baseUrl}/api/projects/${performanceProjectId}/frames/${complexFrameId}/render-preview`,
    { method: "POST", headers: runtimeHeaders },
  );
  const maskRenderDurationMs = performance.now() - maskRenderStarted;
  expect(maskRenderResponse.status).toBe(200);
  expect((await maskRenderResponse.arrayBuffer()).byteLength).toBeGreaterThan(
    1_000,
  );
  expect(maskRenderDurationMs).toBeLessThan(2_000);

  const complexSwitchStarted = performance.now();
  await page.getByRole("button", { name: /Text and masks 12/ }).click();
  await expect(
    page.getByRole("button", { name: /Text and masks 12/ }),
  ).toContainText("r1");
  const complexFrameSwitchDurationMs = performance.now() - complexSwitchStarted;
  expect(complexFrameSwitchDurationMs).toBeLessThan(1_000);
  await expect(page.locator("canvas")).toHaveAttribute(
    "data-active-asset-textures",
    "1",
  );
  const ordinarySwitchStarted = performance.now();
  await page.getByRole("button", { name: /Ordinary 250/ }).click();
  await expect(
    page.getByRole("button", { name: /Ordinary 250/ }),
  ).toContainText("r3");
  const ordinaryFrameSwitchDurationMs =
    performance.now() - ordinarySwitchStarted;
  expect(ordinaryFrameSwitchDurationMs).toBeLessThan(1_000);
  await expect(page.locator("canvas")).toHaveAttribute(
    "data-active-asset-textures",
    "0",
  );

  const repeatedSwitchStarted = performance.now();
  for (let index = 0; index < 5; index += 1) {
    await page.getByRole("button", { name: /Text and masks 12/ }).click();
    await expect(page.locator("canvas")).toHaveAttribute(
      "data-active-asset-textures",
      "1",
    );
    await page.getByRole("button", { name: /Ordinary 250/ }).click();
    await expect(page.locator("canvas")).toHaveAttribute(
      "data-active-asset-textures",
      "0",
    );
  }
  const repeatedFrameSwitchDurationMs =
    performance.now() - repeatedSwitchStarted;
  expect(repeatedFrameSwitchDurationMs).toBeLessThan(5_000);

  const projectSwitchStarted = performance.now();
  await page.getByLabel("Active project").selectOption(projectId);
  await expect(page.getByRole("button", { name: /Portrait/ })).toBeVisible();
  await page.getByLabel("Active project").selectOption(performanceProjectId);
  await expect(
    page.getByRole("button", { name: /Ordinary 250/ }),
  ).toContainText("r3");
  const projectSwitchDurationMs = performance.now() - projectSwitchStarted;
  expect(projectSwitchDurationMs).toBeLessThan(2_000);

  const eventBurstStarted = performance.now();
  for (let index = 0; index < 20; index += 1) {
    await request("/api/transactions", {
      schemaVersion: 1,
      mode: "commit",
      runtimeId: descriptor.runtimeId,
      workspaceId: descriptor.workspaceId,
      scope: {
        kind: "frame",
        projectId: performanceProjectId,
        frameId: performanceFrameId,
      },
      baseRevision: 3 + index,
      actor: { source: "system", id: "performance-event-burst" },
      operations: [
        {
          kind: "updateNode",
          nodeId: nodeIds[125],
          propertyGroup: "transform",
          value: { x: 430 + index },
        },
      ],
    });
  }
  await expect(
    page.getByRole("button", { name: /Ordinary 250/ }),
  ).toContainText("r23");
  const eventBurstDurationMs = performance.now() - eventBurstStarted;
  expect(eventBurstDurationMs).toBeLessThan(5_000);
  const evidence = {
    initial,
    transform,
    paint,
    exportDurationMs,
    workerExportDurationMs: exportResult.durationMs,
    textValidationDurationMs,
    maskRenderDurationMs,
    complexFrameSwitchDurationMs,
    ordinaryFrameSwitchDurationMs,
    repeatedFrameSwitchDurationMs,
    projectSwitchDurationMs,
    eventBurstDurationMs,
  };
  process.stdout.write(`ADR_BROWSER_PERF ${JSON.stringify(evidence)}\n`);
  await writeFile(
    testInfo.outputPath("performance-250.json"),
    `${JSON.stringify(evidence, null, 2)}\n`,
  );
  await page.screenshot({
    path: testInfo.outputPath("performance-250.png"),
    fullPage: true,
  });
});

test("production Studio previews drag transforms before one canonical commit", async ({
  page,
}, testInfo) => {
  const browserMessages: string[] = [];
  let transactionRequests = 0;
  page.on("console", (message) => {
    if (message.type() === "error" || message.type() === "warning")
      browserMessages.push(`${message.type()}: ${message.text()}`);
  });
  page.on("pageerror", (error) => browserMessages.push(error.message));
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      new URL(request.url()).pathname === "/api/transactions"
    )
      transactionRequests += 1;
  });
  await bootstrapStudio(page);
  await expect(page.getByText("Design Runtime", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /Portrait/ })).toBeVisible();
  await expect(page.locator("canvas")).toBeVisible();
  await expect(page.locator(".canvas-error")).toHaveCount(0);
  await expect(page.getByText("runtime nominal")).toHaveCount(0);
  await expect(page.getByText("local · WebGL")).toHaveCount(0);

  const newFrameButton = page.getByRole("button", { name: "New frame" });
  await newFrameButton.click();
  const creationDialog = page.getByRole("dialog", {
    name: "Add an exact-size frame",
  });
  await expect(creationDialog).toBeVisible();
  await expect(creationDialog.getByLabel("Name")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(creationDialog).toHaveCount(0);
  await expect(newFrameButton).toBeFocused();

  const runtimeResponse = await fetch(`${descriptor.baseUrl}/api/runtime`, {
    headers: {
      authorization: `Bearer ${descriptor.capabilityToken}`,
      "x-design-runtime-id": descriptor.runtimeId,
      "x-design-workspace-id": descriptor.workspaceId,
    },
  });
  const runtimeStatus = (await runtimeResponse.json()) as {
    capabilities: {
      maxTextureSize: number;
      maxRenderbufferSize: number;
      maxCanvasDimension: number;
    };
  };
  expect(runtimeStatus.capabilities.maxTextureSize).toBeGreaterThan(0);
  expect(runtimeStatus.capabilities.maxRenderbufferSize).toBeGreaterThan(0);
  expect(runtimeStatus.capabilities.maxCanvasDimension).toBe(
    Math.min(
      runtimeStatus.capabilities.maxTextureSize,
      runtimeStatus.capabilities.maxRenderbufferSize,
    ),
  );
  await page.waitForTimeout(5_000);
  const rendererStartup = await page.locator("canvas").evaluate((canvas) => ({
    state: canvas.dataset.rendererState,
    resources: performance
      .getEntriesByType("resource")
      .map((entry) => ({ name: entry.name, duration: entry.duration })),
  }));
  expect(
    rendererStartup.state,
    JSON.stringify({ browserMessages, resources: rendererStartup.resources }),
  ).toBe("ready");

  await page.getByRole("button", { name: "Add rectangle" }).click();
  await expect(
    page.getByRole("treeitem").filter({ hasText: "Rectangle" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: /Portrait/ })).toContainText(
    "r1",
  );
  await expect(page.locator("canvas")).toHaveAttribute(
    "data-reconciliation-mode",
    "incremental",
  );
  await expect(page.locator("canvas")).toHaveAttribute(
    "data-nodes-rebuilt",
    "1",
  );

  await page.getByRole("button", { name: "Add ellipse" }).click();
  const ellipse = page.getByRole("treeitem").filter({ hasText: "Ellipse" });
  await expect(ellipse).toBeVisible();
  await ellipse.click();
  await page.getByRole("button", { name: "Duplicate layer" }).click();
  await expect(page.getByRole("treeitem")).toHaveCount(3);
  await expect(page.locator("canvas")).toHaveAttribute(
    "data-nodes-rebuilt",
    "1",
  );

  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.getByRole("treeitem")).toHaveCount(2);
  await expect(page.locator("canvas")).toHaveAttribute(
    "data-reconciliation-mode",
    "incremental",
  );
  await expect(page.locator("canvas")).toHaveAttribute(
    "data-nodes-rebuilt",
    "0",
  );
  await page.getByRole("button", { name: "Redo" }).click();
  await expect(page.getByRole("treeitem")).toHaveCount(3);
  await expect(page.locator("canvas")).toHaveAttribute(
    "data-nodes-rebuilt",
    "1",
  );
  await expect(page.getByRole("button", { name: /Portrait/ })).toContainText(
    "r5",
  );

  const firstLayer = page.getByRole("treeitem").first();
  await firstLayer.focus();
  const firstLayerName = await firstLayer.textContent();
  const requestsBeforeTreeNavigation = transactionRequests;
  await page.keyboard.press("ArrowDown");
  const focusedLayerName = await page
    .locator('[role="treeitem"]:focus')
    .textContent();
  expect(focusedLayerName).not.toBe(firstLayerName);
  expect(transactionRequests).toBe(requestsBeforeTreeNavigation);
  await expect(page.getByRole("button", { name: /Portrait/ })).toContainText(
    "r5",
  );

  const draggableLayer = page
    .getByRole("treeitem")
    .filter({ hasText: "Ellipse" })
    .last();
  await draggableLayer.click();
  const selectionBox = page.locator(".selection-box");
  await expect(selectionBox).toBeVisible();
  const initialBounds = await selectionBox.boundingBox();
  expect(initialBounds).not.toBeNull();
  const transactionsBeforeDrag = transactionRequests;
  const canvas = page.locator("canvas");
  await expect(canvas).toHaveAttribute("data-tool-state", "select:idle");
  await canvas.evaluate((element) => {
    element.addEventListener("pointerdown", (event) => {
      element.dataset.lastPointerId = String(event.pointerId);
    });
    element.addEventListener("pointermove", () => {
      element.dataset.pointerMoves = String(
        Number(element.dataset.pointerMoves ?? "0") + 1,
      );
    });
  });
  await page.mouse.move(
    initialBounds!.x + initialBounds!.width / 2,
    initialBounds!.y + initialBounds!.height / 2,
  );
  await page.mouse.down();
  await expect(canvas).toHaveAttribute(
    "data-tool-state",
    "select:transform:move",
  );
  const cancelOrigin = await selectionBox.boundingBox();
  expect(cancelOrigin).not.toBeNull();
  await page.mouse.move(
    initialBounds!.x + initialBounds!.width / 2 + 48,
    initialBounds!.y + initialBounds!.height / 2 + 32,
    { steps: 6 },
  );
  await expect
    .poll(async () => (await selectionBox.boundingBox())?.x)
    .toBeGreaterThan(cancelOrigin!.x + 30);
  await page.keyboard.press("Escape");
  await expect(canvas).toHaveAttribute("data-tool-state", "select:idle");
  await expect
    .poll(async () => (await selectionBox.boundingBox())?.x)
    .toBeLessThan(cancelOrigin!.x + 1);
  await page.mouse.up();
  expect(transactionRequests).toBe(transactionsBeforeDrag);
  await expect(page.getByRole("button", { name: /Portrait/ })).toContainText(
    "r5",
  );

  await page.mouse.move(
    initialBounds!.x + initialBounds!.width / 2,
    initialBounds!.y + initialBounds!.height / 2,
  );
  await page.mouse.down();
  await expect(canvas).toHaveAttribute(
    "data-tool-state",
    "select:transform:move",
  );
  await expect
    .poll(() =>
      canvas.evaluate((element) => {
        const pointerId = Number(element.dataset.lastPointerId);
        return element.hasPointerCapture(pointerId);
      }),
    )
    .toBe(true);
  await page.mouse.move(
    initialBounds!.x + initialBounds!.width / 2 + 96,
    initialBounds!.y + initialBounds!.height / 2 + 64,
    { steps: 12 },
  );
  expect(
    await canvas.evaluate((element) => Number(element.dataset.pointerMoves)),
  ).toBeGreaterThan(0);
  await expect
    .poll(async () => (await selectionBox.boundingBox())?.x)
    .toBeGreaterThan(initialBounds!.x + 80);
  expect(transactionRequests).toBe(transactionsBeforeDrag);
  await expect(page.getByRole("button", { name: /Portrait/ })).toContainText(
    "r5",
  );
  await page.mouse.up();
  await expect(canvas).toHaveAttribute("data-tool-state", "select:idle");
  await expect.poll(() => transactionRequests).toBe(transactionsBeforeDrag + 1);
  await expect(page.getByRole("button", { name: /Portrait/ })).toContainText(
    "r6",
  );
  await expect(selectionBox).toBeVisible();
  await expect(canvas).toHaveAttribute(
    "data-reconciliation-mode",
    "incremental",
  );
  await expect(canvas).toHaveAttribute("data-nodes-rebuilt", "0");
  await expect(canvas).toHaveAttribute("data-texture-allocations", "0");

  await page.getByRole("button", { name: "Validate" }).click();
  await expect(
    page.getByRole("button", { name: /Frame checks/ }),
  ).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByText("3 nodes valid")).toBeVisible();
  await expect(page.getByText("No validation findings.")).toBeVisible();

  await page.getByRole("button", { name: "Export PNG" }).click();
  await expect(page.locator(".feedback-toast")).toContainText(
    "Exported 1080×1350",
  );
  const exported = path.join(
    root,
    "projects",
    "e2e",
    "exports",
    "portrait-r6.png",
  );
  expect((await stat(exported)).size).toBeGreaterThan(1_000);
  const exportedBytes = await readFile(exported);
  const previewResponse = await fetch(
    `${descriptor.baseUrl}/api/projects/${projectId}/frames/${frameId}/render-preview`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${descriptor.capabilityToken}`,
        "x-design-runtime-id": descriptor.runtimeId,
        "x-design-workspace-id": descriptor.workspaceId,
      },
    },
  );
  expect(previewResponse.status).toBe(200);
  const preview = Buffer.from(await previewResponse.arrayBuffer());
  expect(preview.equals(exportedBytes)).toBe(true);

  await page.setViewportSize({ width: 1000, height: 800 });
  const inspectorToggle = page.getByRole("button", { name: "Inspector" });
  await expect(inspectorToggle).toBeVisible();
  await inspectorToggle.click();
  await expect(page.locator("#inspector-panel")).toHaveClass(/is-open/);
  const propertiesTab = page.getByRole("tab", { name: "Properties" });
  const historyTab = page.getByRole("tab", { name: "History" });
  await propertiesTab.focus();
  await page.keyboard.press("ArrowRight");
  await expect(historyTab).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("ArrowLeft");
  await expect(propertiesTab).toHaveAttribute("aria-selected", "true");
  await inspectorToggle.click();
  const inspectorPanel = page.locator("#inspector-panel");
  await expect(inspectorPanel).not.toHaveClass(/is-open/);
  await expect(inspectorPanel).toHaveCSS("visibility", "hidden");
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth,
    ),
  ).toBe(true);

  await page.setViewportSize({ width: 820, height: 800 });
  const navigatorToggle = page.getByRole("button", { name: "Navigate" });
  await expect(navigatorToggle).toBeVisible();
  await expect(navigatorToggle).toHaveAttribute("aria-expanded", "false");
  await navigatorToggle.click();
  await expect(page.locator("#navigator-panel")).toHaveClass(/is-open/);
  await expect(navigatorToggle).toHaveAttribute("aria-expanded", "true");
  await page.keyboard.press("Escape");
  const navigatorPanel = page.locator("#navigator-panel");
  await expect(navigatorPanel).not.toHaveClass(/is-open/);
  await expect(navigatorPanel).toHaveCSS("visibility", "hidden");
  await expect(page.getByRole("button", { name: "Export PNG" })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("studio-820.png") });

  await page.setViewportSize({ width: 620, height: 800 });
  await expect(page.getByRole("button", { name: "Export PNG" })).toBeVisible();
  expect(
    await page.locator(".toolbar").evaluate((toolbar) => ({
      clientWidth: toolbar.clientWidth,
      scrollWidth: toolbar.scrollWidth,
    })),
  ).toEqual({ clientWidth: 620, scrollWidth: 620 });
  await page.screenshot({ path: testInfo.outputPath("studio-620.png") });
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.getByRole("button", { name: "Validate" }).focus();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Export PNG" })).toBeFocused();
  expect(
    await page
      .getByRole("button", { name: "Export PNG" })
      .evaluate((element) => {
        const style = getComputedStyle(element);
        return style.outlineStyle !== "none" || style.boxShadow !== "none";
      }),
  ).toBe(true);
  const toolbarTarget = await page
    .getByRole("button", { name: "Undo" })
    .boundingBox();
  expect(toolbarTarget?.width).toBeGreaterThanOrEqual(24);
  expect(toolbarTarget?.height).toBeGreaterThanOrEqual(24);
  const contrastRatios = await page.evaluate(() => {
    const styles = getComputedStyle(document.documentElement);
    const rgb = (value: string) => {
      const normalized = value.trim().replace("#", "");
      return [0, 2, 4].map((offset) =>
        Number.parseInt(normalized.slice(offset, offset + 2), 16),
      );
    };
    const luminance = (value: string) => {
      const channels = rgb(value).map((channel) => {
        const normalized = channel / 255;
        return normalized <= 0.04045
          ? normalized / 12.92
          : ((normalized + 0.055) / 1.055) ** 2.4;
      });
      return (
        0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!
      );
    };
    const ratio = (foreground: string, background: string) => {
      const bright = Math.max(luminance(foreground), luminance(background));
      const dark = Math.min(luminance(foreground), luminance(background));
      return (bright + 0.05) / (dark + 0.05);
    };
    return {
      primary: ratio(
        styles.getPropertyValue("--text"),
        styles.getPropertyValue("--bg"),
      ),
      muted: ratio(
        styles.getPropertyValue("--muted"),
        styles.getPropertyValue("--surface-0"),
      ),
      focus: ratio(
        styles.getPropertyValue("--cobalt-bright"),
        styles.getPropertyValue("--surface-toolbar"),
      ),
    };
  });
  expect(contrastRatios.primary).toBeGreaterThanOrEqual(4.5);
  expect(contrastRatios.muted).toBeGreaterThanOrEqual(4.5);
  expect(contrastRatios.focus).toBeGreaterThanOrEqual(3);

  await writeFile(testInfo.outputPath("frame-export.png"), exportedBytes);
  await page.screenshot({
    path: testInfo.outputPath("studio-release.png"),
    fullPage: true,
  });
  expect(await page.locator(".canvas-error").allTextContents()).toEqual([]);
  await expect
    .poll(
      () =>
        page.locator("canvas").evaluate((canvas) => ({
          width: canvas.width,
          height: canvas.height,
        })),
      { timeout: 10_000 },
    )
    .toEqual({ width: 1080, height: 1350 });
  const hierarchyTransactions = transactionRequests;
  const rectangleForReorder = page
    .getByRole("treeitem")
    .filter({ hasText: "Rectangle" });
  await rectangleForReorder.focus();
  await page.keyboard.press("Alt+ArrowDown");
  await expect.poll(() => transactionRequests).toBe(hierarchyTransactions + 1);
  await expect(page.getByRole("button", { name: /Portrait/ })).toContainText(
    "r7",
  );
  await expect(canvas).toHaveAttribute(
    "data-reconciliation-mode",
    "incremental",
  );
  await expect(canvas).toHaveAttribute(
    "data-reconciliation-dirty",
    "hierarchy",
  );
  await expect(canvas).toHaveAttribute("data-nodes-rebuilt", "0");
  await rectangleForReorder.click();
  await page
    .getByRole("treeitem")
    .filter({ hasText: "Ellipse" })
    .last()
    .click({ modifiers: ["Shift"] });
  await page.getByRole("button", { name: "Group selected layers" }).click();
  await expect(page.getByRole("button", { name: /Portrait/ })).toContainText(
    "r8",
  );
  const groupedResponse = await fetch(
    `${descriptor.baseUrl}/api/projects/${projectId}/frames/${frameId}`,
    {
      headers: {
        authorization: `Bearer ${descriptor.capabilityToken}`,
        "x-design-runtime-id": descriptor.runtimeId,
        "x-design-workspace-id": descriptor.workspaceId,
      },
    },
  );
  const groupedFrame = (await groupedResponse.json()) as {
    root: {
      children: Array<{
        id: string;
        type: string;
        children?: Array<{ id: string; type: string }>;
      }>;
    };
  };
  const isolatedGroup = groupedFrame.root.children.find(
    (node) => node.type === "group",
  )!;
  const groupedRectangle = isolatedGroup.children!.find(
    (node) => node.type === "rectangle",
  )!;
  await request("/api/transactions", {
    schemaVersion: 1,
    mode: "commit",
    runtimeId: descriptor.runtimeId,
    workspaceId: descriptor.workspaceId,
    scope: { kind: "frame", projectId, frameId },
    baseRevision: 8,
    actor: { source: "system", id: "cache-e2e" },
    operations: [
      {
        kind: "updateNode",
        nodeId: isolatedGroup.id,
        propertyGroup: "compositing",
        value: { opacity: 0.8 },
      },
    ],
  });
  await expect(page.getByRole("button", { name: /Portrait/ })).toContainText(
    "r9",
  );
  await request("/api/transactions", {
    schemaVersion: 1,
    mode: "commit",
    runtimeId: descriptor.runtimeId,
    workspaceId: descriptor.workspaceId,
    scope: { kind: "frame", projectId, frameId },
    baseRevision: 9,
    actor: { source: "system", id: "cache-e2e" },
    operations: [
      {
        kind: "updateNode",
        nodeId: groupedRectangle.id,
        propertyGroup: "fill",
        value: {
          fill: { type: "solid", color: "#8B5CF6", opacity: 1 },
        },
      },
    ],
  });
  await expect(page.getByRole("button", { name: /Portrait/ })).toContainText(
    "r10",
  );
  await expect(canvas).toHaveAttribute(
    "data-reconciliation-mode",
    "incremental",
  );
  await expect(canvas).toHaveAttribute("data-reconciliation-dirty", "paint");
  await expect(canvas).toHaveAttribute("data-nodes-rebuilt", "1");
  await expect(canvas).toHaveAttribute("data-cache-invalidations", "1");
  const harnessSocketMessages = browserMessages.filter(
    (message) =>
      message.includes("WebSocket connection") &&
      message.includes("HTTP Authentication failed"),
  );
  expect(harnessSocketMessages).toHaveLength(0);
  const unexpectedBrowserMessages = browserMessages.filter(
    (message) =>
      !message.includes("GPU stall due to ReadPixels") &&
      !harnessSocketMessages.includes(message),
  );
  expect(unexpectedBrowserMessages).toEqual([]);
});

test("failed human drag restores visual state and retries one semantic change", async ({
  page,
}) => {
  await bootstrapStudio(page);
  const layer = page
    .getByRole("treeitem")
    .filter({ hasText: "Ellipse" })
    .last();
  await layer.click();
  const selectionBox = page.locator(".selection-box");
  const origin = await selectionBox.boundingBox();
  expect(origin).not.toBeNull();
  await page.route(
    "**/api/transactions",
    async (route) =>
      route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({
          error: { code: "SAVE_FAILED", message: "Temporary save failure" },
        }),
      }),
    { times: 1 },
  );
  const revision = await page
    .getByRole("button", { name: /Portrait/ })
    .textContent();
  await page.mouse.move(
    origin!.x + origin!.width / 2,
    origin!.y + origin!.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    origin!.x + origin!.width / 2 + 70,
    origin!.y + origin!.height / 2 + 40,
    {
      steps: 8,
    },
  );
  await page.mouse.up();
  await expect(
    page.getByRole("button", { name: "Retry change" }),
  ).toBeVisible();
  await expect
    .poll(async () => (await selectionBox.boundingBox())?.x)
    .toBeLessThan(origin!.x + 1);
  await expect(page.getByRole("button", { name: /Portrait/ })).toContainText(
    revision!.match(/r\d+/)![0],
  );
  await page.getByRole("button", { name: "Retry change" }).click();
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();
  await expect
    .poll(async () => (await selectionBox.boundingBox())?.x)
    .toBeGreaterThan(origin!.x + 50);
});

test("Studio previews color, scale, rotation, and marquee selection before one release commit", async ({
  page,
}) => {
  let transactionRequests = 0;
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      new URL(request.url()).pathname === "/api/transactions"
    )
      transactionRequests += 1;
  });
  await bootstrapStudio(page);
  await page.getByRole("button", { name: "New frame" }).click();
  const frameDialog = page.getByRole("dialog", {
    name: "Add an exact-size frame",
  });
  await frameDialog.getByLabel("Name").fill("Live manipulation");
  await frameDialog.getByRole("button", { name: "Create" }).click();
  await expect(
    page.getByRole("button", { name: /Live manipulation/ }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Add rectangle" }).click();
  await expect(page.getByRole("treeitem")).toHaveCount(1);
  await page.getByRole("button", { name: "Add ellipse" }).click();
  await expect(page.getByRole("treeitem")).toHaveCount(2);
  await page.getByRole("button", { name: "Add rectangle" }).click();
  await expect(page.getByRole("treeitem")).toHaveCount(3);
  const layer = page
    .getByRole("treeitem")
    .filter({ hasText: "Rectangle" })
    .last();
  await layer.click();
  const canvas = page.locator("canvas");
  const selectionBox = page.locator(".selection-box");
  await expect(selectionBox).toBeVisible();

  const colorButton = page.getByRole("button", { name: "Paint color" });
  await colorButton.click();
  const colorField = page.getByRole("slider", {
    name: "Saturation and brightness",
  });
  const colorBounds = await colorField.boundingBox();
  expect(colorBounds).not.toBeNull();
  const renderBeforeColor = await canvas.screenshot();
  const requestsBeforeColor = transactionRequests;
  await page.mouse.move(colorBounds!.x + 24, colorBounds!.y + 24);
  await page.mouse.down();
  await page.mouse.move(
    colorBounds!.x + colorBounds!.width - 28,
    colorBounds!.y + colorBounds!.height / 2,
    { steps: 8 },
  );
  await expect(page.getByText("Unsaved", { exact: true })).toBeVisible();
  await expect
    .poll(async () => (await canvas.screenshot()).equals(renderBeforeColor))
    .toBe(false);
  expect(transactionRequests).toBe(requestsBeforeColor);
  await page.mouse.up();
  await expect.poll(() => transactionRequests).toBe(requestsBeforeColor + 1);
  await expect(
    page.getByText("Revision conflict", { exact: true }),
  ).toHaveCount(0);

  const renderBeforeCancel = await canvas.screenshot();
  const requestsBeforeCancel = transactionRequests;
  await colorButton.click();
  const cancelField = page.getByRole("slider", {
    name: "Saturation and brightness",
  });
  const cancelBounds = await cancelField.boundingBox();
  expect(cancelBounds).not.toBeNull();
  await page.mouse.move(cancelBounds!.x + 20, cancelBounds!.y + 20);
  await page.mouse.down();
  await page.mouse.move(
    cancelBounds!.x + cancelBounds!.width / 2,
    cancelBounds!.y + cancelBounds!.height - 20,
    { steps: 6 },
  );
  await expect
    .poll(async () => (await canvas.screenshot()).equals(renderBeforeCancel))
    .toBe(false);
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await expect
    .poll(async () => (await canvas.screenshot()).equals(renderBeforeCancel))
    .toBe(true);
  expect(transactionRequests).toBe(requestsBeforeCancel);

  const scaleHandle = page.getByRole("button", {
    name: "Scale selected layer",
  });
  const scaleHandleBounds = await scaleHandle.boundingBox();
  const scaleOrigin = await selectionBox.boundingBox();
  expect(scaleHandleBounds).not.toBeNull();
  expect(scaleOrigin).not.toBeNull();
  const requestsBeforeScale = transactionRequests;
  await page.mouse.move(
    scaleHandleBounds!.x + scaleHandleBounds!.width / 2,
    scaleHandleBounds!.y + scaleHandleBounds!.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    scaleHandleBounds!.x + scaleHandleBounds!.width / 2 + 70,
    scaleHandleBounds!.y + scaleHandleBounds!.height / 2 + 40,
    { steps: 8 },
  );
  await expect
    .poll(async () => (await selectionBox.boundingBox())?.width)
    .toBeGreaterThan(scaleOrigin!.width + 50);
  expect(transactionRequests).toBe(requestsBeforeScale);
  await page.mouse.up();
  await expect.poll(() => transactionRequests).toBe(requestsBeforeScale + 1);

  const rotateHandle = page.getByRole("button", {
    name: "Rotate selected layer from SE corner",
  });
  await rotateHandle.hover();
  await expect(rotateHandle).toHaveCSS("opacity", "1");
  const rotateBounds = await rotateHandle.boundingBox();
  const rotationOrigin = await selectionBox.boundingBox();
  expect(rotateBounds).not.toBeNull();
  expect(rotationOrigin).not.toBeNull();
  const requestsBeforeRotation = transactionRequests;
  await page.mouse.move(
    rotateBounds!.x + rotateBounds!.width / 2,
    rotateBounds!.y + rotateBounds!.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    rotationOrigin!.x + rotationOrigin!.width + 30,
    rotationOrigin!.y + rotationOrigin!.height / 2,
    { steps: 8 },
  );
  await expect
    .poll(async () => (await selectionBox.boundingBox())?.height)
    .not.toBeCloseTo(rotationOrigin!.height, 0);
  expect(transactionRequests).toBe(requestsBeforeRotation);
  await page.mouse.up();
  await expect.poll(() => transactionRequests).toBe(requestsBeforeRotation + 1);

  const canvasBounds = await canvas.boundingBox();
  expect(canvasBounds).not.toBeNull();
  const requestsBeforeMarquee = transactionRequests;
  await page.mouse.move(canvasBounds!.x + 4, canvasBounds!.y + 4);
  await page.mouse.down();
  await page.mouse.move(
    canvasBounds!.x + canvasBounds!.width - 4,
    canvasBounds!.y + canvasBounds!.height - 4,
    { steps: 8 },
  );
  await expect(page.locator(".marquee-box")).toBeVisible();
  expect(transactionRequests).toBe(requestsBeforeMarquee);
  await page.mouse.up();
  await expect(page.locator(".marquee-box")).toHaveCount(0);
  await expect(
    page.locator('[role="treeitem"][aria-selected="true"]'),
  ).toHaveCount(3);
  await expect(
    page.getByLabel("3 selected layers transform bounds"),
  ).toBeVisible();
  expect(transactionRequests).toBe(requestsBeforeMarquee);
});

test("Brand Library pins exact revisions and applies concrete frame changes", async ({
  page,
}) => {
  const componentSourceId = "c1000000-0000-4000-8000-000000000001";
  const componentNodeId = "c1000000-0000-4000-8000-000000000002";
  const componentInstanceId = "c1000000-0000-4000-8000-000000000003";
  const componentDefinition = {
    key: "signal-tile",
    kind: "component",
    name: "Signal tile",
    includes: [],
    variant: { groupKey: "signal-tile", key: "compact", name: "Compact" },
    allowedOverrides: [
      { sourceNodeId: componentSourceId, properties: ["fill", "transform"] },
    ],
    nodes: [
      {
        id: componentSourceId,
        type: "rectangle",
        name: "Signal component",
        visible: true,
        locked: false,
        transform: {
          x: 80,
          y: 80,
          width: 240,
          height: 140,
          rotation: 0,
          scaleX: 1,
          scaleY: 1,
          skewX: 0,
          skewY: 0,
          anchorX: 0,
          anchorY: 0,
        },
        opacity: 1,
        blendMode: "normal",
        fill: { type: "solid", color: "#315BFF", opacity: 1 },
        cornerRadius: {
          topLeft: 16,
          topRight: 16,
          bottomRight: 16,
          bottomLeft: 16,
        },
      },
    ],
  };
  const expandedComponentDefinition = {
    ...structuredClone(componentDefinition),
    key: "signal-tile-expanded",
    name: "Signal tile expanded",
    variant: {
      groupKey: "signal-tile",
      key: "expanded",
      name: "Expanded",
    },
    nodes: [
      {
        ...structuredClone(componentDefinition.nodes[0]),
        name: "Signal component expanded",
        transform: {
          ...structuredClone(componentDefinition.nodes[0]!.transform),
          width: 360,
        },
        fill: { type: "solid", color: "#FF6B35", opacity: 1 },
      },
    ],
  };
  const headers = {
    authorization: `Bearer ${descriptor.capabilityToken}`,
    "content-type": "application/json",
    "x-design-runtime-id": descriptor.runtimeId,
    "x-design-workspace-id": descriptor.workspaceId,
  };
  const projectResponse = await fetch(
    `${descriptor.baseUrl}/api/projects/${projectId}`,
    { headers },
  );
  const project = (await projectResponse.json()) as { revision: number };
  const kit = (await request("/api/brand-kits", {
    name: "E2E Brand System",
    sourceProjectId: projectId,
    provenance: "Verified E2E project",
    licenseNotes: "Internal E2E fixture",
    palette: [{ key: "signal", name: "Signal", color: "#315BFF" }],
    typeRoles: [],
    logos: [],
    definitions: [componentDefinition, expandedComponentDefinition],
    actor: { source: "http", id: "e2e-brand" },
  })) as { id: string; revision: number; contentHash: string };
  const pinPreview = (await request(
    `/api/projects/${projectId}/brand-kit/pin`,
    {
      kitId: kit.id,
      revision: kit.revision,
      baseRevision: project.revision,
      mode: "preview",
      actor: { source: "http", id: "e2e-brand" },
    },
  )) as { previewId: string };
  expect(pinPreview.previewId).toBeTruthy();
  const stillUnpinned = (await (
    await fetch(`${descriptor.baseUrl}/api/projects/${projectId}`, { headers })
  ).json()) as { revision: number; brandKitPin?: unknown };
  expect(stillUnpinned).toMatchObject({ revision: project.revision });
  expect(stillUnpinned.brandKitPin).toBeUndefined();
  await request(`/api/projects/${projectId}/brand-kit/pin`, {
    kitId: kit.id,
    revision: kit.revision,
    baseRevision: project.revision,
    mode: "commit",
    actor: { source: "http", id: "e2e-brand" },
  });
  const pinned = (await (
    await fetch(`${descriptor.baseUrl}/api/projects/${projectId}`, { headers })
  ).json()) as {
    revision: number;
    brandKitPin: { kitId: string; revision: number; contentHash: string };
  };
  expect(pinned.brandKitPin).toEqual({
    kitId: kit.id,
    revision: kit.revision,
    contentHash: kit.contentHash,
    resourceMap: {},
  });
  const newerKit = (await request("/api/brand-kits", {
    kitId: kit.id,
    name: "E2E Brand System",
    sourceProjectId: projectId,
    provenance: "Verified E2E project",
    licenseNotes: "Internal E2E fixture",
    palette: [{ key: "signal", name: "Signal", color: "#FF6B35" }],
    typeRoles: [],
    logos: [],
    definitions: [componentDefinition, expandedComponentDefinition],
    actor: { source: "http", id: "e2e-brand" },
  })) as { revision: number };
  expect(newerKit.revision).toBe(kit.revision + 1);
  const paletteTargetId = "c1000000-0000-4000-8000-000000000004";
  const emptyFrame = (await (
    await fetch(
      `${descriptor.baseUrl}/api/projects/${projectId}/frames/${frameId}`,
      { headers },
    )
  ).json()) as { revision: number };
  await request("/api/transactions", {
    schemaVersion: 1,
    mode: "commit",
    runtimeId: descriptor.runtimeId,
    workspaceId: descriptor.workspaceId,
    scope: { kind: "frame", projectId, frameId },
    baseRevision: emptyFrame.revision,
    actor: { source: "http", id: "e2e-brand-target" },
    operations: [
      {
        kind: "createNode",
        parentId: "root",
        node: {
          ...componentDefinition.nodes[0],
          id: paletteTargetId,
          name: "Palette target",
        },
      },
    ],
  });
  const before = (await (
    await fetch(
      `${descriptor.baseUrl}/api/projects/${projectId}/frames/${frameId}`,
      { headers },
    )
  ).json()) as {
    revision: number;
    root: { children: Array<{ id: string; type: string }> };
  };
  const target = before.root.children.find(
    (candidate) =>
      candidate.type === "rectangle" || candidate.type === "ellipse",
  );
  expect(target).toBeTruthy();
  const applyPreview = (await request(
    `/api/projects/${projectId}/frames/${frameId}/brand/apply`,
    {
      baseRevision: before.revision,
      mode: "preview",
      actor: { source: "http", id: "e2e-brand" },
      palette: [{ nodeId: target!.id, token: "signal", property: "fill" }],
    },
  )) as { previewId: string };
  await request(`/api/previews/${applyPreview.previewId}/commit`, {});
  const branded = (await (
    await fetch(
      `${descriptor.baseUrl}/api/projects/${projectId}/frames/${frameId}`,
      { headers },
    )
  ).json()) as {
    revision: number;
    root: { children: Array<{ id: string; fill?: { color: string } }> };
  };
  expect(branded.revision).toBe(before.revision + 1);
  expect(
    branded.root.children.find((candidate) => candidate.id === target!.id)?.fill
      ?.color,
  ).toBe("#315BFF");

  await request(`/api/projects/${projectId}/frames/${frameId}/brand/apply`, {
    baseRevision: branded.revision,
    mode: "commit",
    actor: { source: "http", id: "e2e-brand-component" },
    definition: {
      key: "signal-tile",
      parentId: "root",
      idMap: { [componentSourceId]: componentNodeId },
      instanceId: componentInstanceId,
    },
  });
  const componentFrame = (await (
    await fetch(
      `${descriptor.baseUrl}/api/projects/${projectId}/frames/${frameId}`,
      { headers },
    )
  ).json()) as {
    root: {
      children: Array<{
        id: string;
        brandComponent?: {
          instanceId: string;
          definitionKey: string;
          overrides: string[];
        };
      }>;
    };
  };
  expect(
    componentFrame.root.children.find(
      (candidate) => candidate.id === componentNodeId,
    )?.brandComponent,
  ).toEqual(
    expect.objectContaining({
      instanceId: componentInstanceId,
      definitionKey: "signal-tile",
      overrides: [],
    }),
  );

  const liveBindingId = "c1000000-0000-4000-8000-000000000005";
  const beforeLiveBinding = (await (
    await fetch(
      `${descriptor.baseUrl}/api/projects/${projectId}/frames/${frameId}`,
      { headers },
    )
  ).json()) as { revision: number };
  await request(
    `/api/projects/${projectId}/frames/${frameId}/brand-bindings/palette`,
    {
      baseRevision: beforeLiveBinding.revision,
      mode: "commit",
      actor: { source: "http", id: "e2e-brand-live" },
      bindingId: liveBindingId,
      nodeId: paletteTargetId,
      property: "fill",
      tokenKey: "signal",
    },
  );
  const beforeMigration = (await (
    await fetch(`${descriptor.baseUrl}/api/projects/${projectId}`, { headers })
  ).json()) as { revision: number };
  const migrationPreview = (await request(
    `/api/projects/${projectId}/brand-kit/migrate`,
    {
      kitId: kit.id,
      revision: newerKit.revision,
      baseRevision: beforeMigration.revision,
      mode: "preview",
      actor: { source: "http", id: "e2e-brand-migration" },
    },
  )) as { previewId: string; diff: Array<{ path: string }> };
  expect(
    migrationPreview.diff.some((entry) => entry.path.includes("brandKitPin")),
  ).toBe(true);
  expect(
    migrationPreview.diff.some((entry) =>
      entry.path.startsWith(`/frames/${frameId}/`),
    ),
  ).toBe(true);
  await request(`/api/previews/${migrationPreview.previewId}/commit`, {});
  const migratedProject = (await (
    await fetch(`${descriptor.baseUrl}/api/projects/${projectId}`, { headers })
  ).json()) as { revision: number; brandKitPin: { revision: number } };
  const migratedFrame = (await (
    await fetch(
      `${descriptor.baseUrl}/api/projects/${projectId}/frames/${frameId}`,
      { headers },
    )
  ).json()) as {
    root: {
      children: Array<{
        id: string;
        fill?: { color: string };
        brandBindings?: Array<{ id: string; kitRevision: number }>;
        brandComponent?: { kitRevision: number };
      }>;
    };
  };
  expect(migratedProject.brandKitPin.revision).toBe(2);
  expect(
    migratedFrame.root.children.find(
      (candidate) => candidate.id === paletteTargetId,
    ),
  ).toMatchObject({
    fill: { color: "#FF6B35" },
    brandBindings: [{ id: liveBindingId, kitRevision: 2 }],
  });
  expect(
    migratedFrame.root.children.find(
      (candidate) => candidate.id === componentNodeId,
    )?.brandComponent?.kitRevision,
  ).toBe(2);
  const rollbackPreview = (await request(
    `/api/projects/${projectId}/brand-kit/migration/rollback`,
    {
      baseRevision: migratedProject.revision,
      mode: "preview",
      actor: { source: "http", id: "e2e-brand-migration" },
    },
  )) as { previewId: string };
  await request(`/api/previews/${rollbackPreview.previewId}/commit`, {});
  const rolledBackFrame = (await (
    await fetch(
      `${descriptor.baseUrl}/api/projects/${projectId}/frames/${frameId}`,
      { headers },
    )
  ).json()) as typeof migratedFrame;
  expect(
    rolledBackFrame.root.children.find(
      (candidate) => candidate.id === paletteTargetId,
    ),
  ).toMatchObject({
    fill: { color: "#315BFF" },
    brandBindings: [{ id: liveBindingId, kitRevision: 1 }],
  });
  expect(
    rolledBackFrame.root.children.find(
      (candidate) => candidate.id === componentNodeId,
    )?.brandComponent?.kitRevision,
  ).toBe(1);

  await bootstrapStudio(page);
  await expect(page.getByRole("tab", { name: "Brand" })).toBeVisible();
  await page.getByRole("tab", { name: "Brand" }).click();
  await expect(
    page.getByRole("button", { name: "E2E Brand System r1" }),
  ).toHaveClass(/is-selected/);
  await expect(
    page.getByRole("button", { name: "E2E Brand System r2" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "E2E Brand System r2" }).click();
  await expect(
    page.getByRole("button", { name: "Commit Brand migration" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Commit Brand migration" }).click();
  await expect(
    page.getByRole("button", { name: "E2E Brand System r2" }),
  ).toHaveClass(/is-selected/);
  await page
    .getByRole("button", { name: "Preview last migration rollback" })
    .click();
  await expect(
    page.getByRole("button", { name: "Commit Brand migration" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Commit Brand migration" }).click();
  await expect(
    page.getByRole("button", { name: "E2E Brand System r1" }),
  ).toHaveClass(/is-selected/);
  await page.getByRole("button", { name: "Audit exact Brand system" }).click();
  await expect(
    page.getByText(/0 errors · 0 warnings · [1-9]\d* notes/),
  ).toBeVisible();
  await expect(
    page.getByRole("listitem").filter({
      hasText: "Palette target fill matches Signal but is not live-bound.",
    }),
  ).toHaveCount(0);
  await page.getByRole("treeitem", { name: /Signal component/ }).click();
  await page.locator("summary").filter({ hasText: "Reusable" }).click();
  await expect(page.getByText(/Component signal-tile/)).toBeVisible();
  await page.getByRole("button", { name: "Expanded", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Commit component variant" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Commit component variant" }).click();
  await page
    .getByRole("treeitem", { name: /Signal component expanded/ })
    .click();
  await expect(page.getByText(/Component signal-tile-expanded/)).toBeVisible();
  const expandedFrame = (await (
    await fetch(
      `${descriptor.baseUrl}/api/projects/${projectId}/frames/${frameId}`,
      { headers },
    )
  ).json()) as {
    root: {
      children: Array<{
        id: string;
        fill?: { color: string };
        transform?: { width: number };
        brandComponent?: { definitionKey: string; variantKey?: string };
      }>;
    };
  };
  expect(
    expandedFrame.root.children.find(
      (candidate) => candidate.id === componentNodeId,
    ),
  ).toMatchObject({
    id: componentNodeId,
    fill: { color: "#FF6B35" },
    transform: { width: 360 },
    brandComponent: {
      definitionKey: "signal-tile-expanded",
      variantKey: "expanded",
    },
  });
  await page.getByRole("button", { name: "Detach component" }).click();
  await expect(page.getByText(/Component signal-tile/)).toBeHidden();
  const detachedFrame = (await (
    await fetch(
      `${descriptor.baseUrl}/api/projects/${projectId}/frames/${frameId}`,
      { headers },
    )
  ).json()) as {
    root: { children: Array<{ id: string; brandComponent?: unknown }> };
  };
  expect(
    detachedFrame.root.children.find(
      (candidate) => candidate.id === componentNodeId,
    )?.brandComponent,
  ).toBeUndefined();

  await page
    .locator("summary")
    .filter({ hasText: "New immutable revision" })
    .click();
  await page.getByLabel("Provenance").fill("Named Studio organization E2E");
  await page.getByLabel("License notes").fill("Internal E2E fixture");
  await page
    .getByLabel("Palette names · detected-order")
    .fill("Campaign Primary, Campaign Accent");
  await page
    .getByLabel("Type role names · font-order")
    .fill("Campaign Display, Campaign Body");
  await page
    .getByLabel("Reusable names · definition-order")
    .fill("Campaign Tile, Campaign Expanded");
  await page.getByRole("button", { name: "Create next revision" }).click();
  await expect(page.getByText(/Created Brand Kit/)).toBeVisible();
  const organizedKit = (await (
    await fetch(`${descriptor.baseUrl}/api/brand-kits/${kit.id}`, { headers })
  ).json()) as {
    revision: number;
    palette: Array<{ key: string; name: string }>;
    definitions: Array<{ key: string; name: string; kind: string }>;
  };
  expect(organizedKit.revision).toBe(3);
  expect(organizedKit.palette.slice(0, 2)).toMatchObject([
    { key: "campaign-primary", name: "Campaign Primary" },
    { key: "campaign-accent", name: "Campaign Accent" },
  ]);
  expect(organizedKit.definitions).toMatchObject([
    { key: "signal-tile", name: "Campaign Tile", kind: "component" },
    {
      key: "signal-tile-expanded",
      name: "Campaign Expanded",
      kind: "component",
    },
  ]);
});

test("MCP stdio inspection, preview, and commit match the HTTP runtime", async () => {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["apps/mcp/dist/cli.js", "--descriptor", descriptorPath],
    cwd: process.cwd(),
    stderr: "pipe",
  });
  const client = new Client({ name: "agentic-design-e2e", version: "1.0.0" });
  await client.connect(transport);
  try {
    const tools = await client.listTools();
    expect(tools.tools.map((tool) => tool.name)).toEqual(
      expect.arrayContaining([
        "runtime_status",
        "get_frame",
        "preview_batch",
        "commit_batch",
        "list_brand_kits",
        "create_brand_kit",
        "pin_brand_kit",
        "apply_brand",
        "detach_brand_component",
        "switch_brand_component_variant",
        "audit_brand_system",
        "migrate_brand_kit_revision",
        "rollback_brand_kit_migration",
        "update_check",
        "update_fetch",
        "update_apply",
        "update_rollback",
      ]),
    );
    const status = await client.callTool({ name: "runtime_status" });
    expect(status.isError).not.toBe(true);
    expect(status.structuredContent).toMatchObject({
      runtimeId: descriptor.runtimeId,
      workspaceId: descriptor.workspaceId,
    });
    const brands = await client.callTool({ name: "list_brand_kits" });
    expect(brands.isError).not.toBe(true);
    expect(brands.structuredContent).toHaveProperty("kits");
    const update = await client.callTool({ name: "update_check" });
    expect(update.isError).toBe(true);
    expect(JSON.stringify(update.content)).toContain("UPDATE_NOT_CONFIGURED");

    const inspected = await client.callTool({
      name: "get_frame",
      arguments: { projectId, frameId },
    });
    expect(inspected.isError).not.toBe(true);
    const frame = inspected.structuredContent as {
      revision: number;
      root: { children: Array<{ id: string; transform: { x: number } }> };
    };
    expect(frame.revision).toBeGreaterThanOrEqual(5);
    const node = frame.root.children[0]!;
    const operation = {
      kind: "updateNode",
      nodeId: node.id,
      propertyGroup: "transform",
      value: { x: node.transform.x + 24 },
    };
    const preview = await client.callTool({
      name: "preview_batch",
      arguments: {
        scope: "frame",
        projectId,
        frameId,
        baseRevision: frame.revision,
        operations: [operation],
        actorId: "mcp-e2e",
      },
    });
    expect(preview.isError).not.toBe(true);
    expect(preview.structuredContent).toMatchObject({
      baseRevision: frame.revision,
      affectedNodes: [node.id],
    });
    expect(preview.structuredContent?.operationHash).toMatch(
      /^sha256:[a-f0-9]{64}$/,
    );

    const committed = await client.callTool({
      name: "commit_batch",
      arguments: {
        scope: "frame",
        projectId,
        frameId,
        baseRevision: frame.revision,
        operations: [operation],
        actorId: "mcp-e2e",
      },
    });
    expect(committed.isError).not.toBe(true);
    expect(committed.structuredContent).toMatchObject({
      revision: frame.revision + 1,
    });

    const response = await fetch(
      `${descriptor.baseUrl}/api/projects/${projectId}/frames/${frameId}`,
      {
        headers: {
          authorization: `Bearer ${descriptor.capabilityToken}`,
          "x-design-runtime-id": descriptor.runtimeId,
          "x-design-workspace-id": descriptor.workspaceId,
        },
      },
    );
    expect(response.status).toBe(200);
    const canonical = (await response.json()) as typeof frame;
    expect(canonical.revision).toBe(frame.revision + 1);
    expect(canonical.root.children[0]!.transform.x).toBe(operation.value.x);
  } finally {
    await client.close();
  }
});

test("agent plugin MCP requires and resolves the explicit workspace", async () => {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [
      "apps/mcp/dist/agent-cli.js",
      "--plugin-root",
      "plugins/agentic-design-runtime",
    ],
    cwd: process.cwd(),
    env: {
      ...process.env,
      ADR_DESCRIPTOR_DIRECTORY: path.dirname(descriptorPath),
      ADR_SKIP_BROWSER_INSTALL: "1",
    },
    stderr: "pipe",
  });
  const client = new Client({
    name: "agentic-design-plugin-e2e",
    version: "1.0.0",
  });
  await client.connect(transport);
  try {
    const tools = await client.listTools();
    expect(tools.tools.map((tool) => tool.name)).toEqual(
      expect.arrayContaining([
        "ensure_design_workspace",
        "list_active_workspaces",
        "open_studio",
        "render_preview",
        "wait_for_frame_change",
        "audit_brand_system",
        "migrate_brand_kit_revision",
        "rollback_brand_kit_migration",
        "stop_runtime",
        "update_check",
        "update_fetch",
        "update_apply",
        "update_rollback",
      ]),
    );

    const active = await client.callTool({
      name: "list_active_workspaces",
    });
    expect(active.isError).not.toBe(true);
    expect(active.structuredContent?.workspaces).toEqual([
      expect.objectContaining({
        runtimeId: descriptor.runtimeId,
        workspaceId: descriptor.workspaceId,
        workspacePath: await realpath(root),
      }),
    ]);
    expect(JSON.stringify(active.structuredContent)).not.toContain(
      descriptor.capabilityToken,
    );

    const projects = await client.callTool({
      name: "list_projects",
      arguments: { workspacePath: root },
    });
    expect(projects.isError).not.toBe(true);
    expect(projects.structuredContent?.projects).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: projectId })]),
    );

    const wrongWorkspace = await client.callTool({
      name: "list_projects",
      arguments: { workspacePath: path.dirname(root) },
    });
    expect(wrongWorkspace.isError).toBe(true);
    expect(JSON.stringify(wrongWorkspace.content)).toContain(
      "No active runtime matches this workspace",
    );
  } finally {
    await client.close();
  }
});

test("renderer handles gradients, masks, and adjustments in one canonical scene", async () => {
  const frameResponse = await fetch(
    `${descriptor.baseUrl}/api/projects/${projectId}/frames/${frameId}`,
    {
      headers: {
        authorization: `Bearer ${descriptor.capabilityToken}`,
        "x-design-runtime-id": descriptor.runtimeId,
        "x-design-workspace-id": descriptor.workspaceId,
      },
    },
  );
  const frame = (await frameResponse.json()) as {
    revision: number;
    root: {
      children: Array<{
        id: string;
        type: string;
        transform: { width: number; height: number };
      }>;
    };
  };
  const gradientTarget = {
    id: crypto.randomUUID(),
    transform: { width: 260, height: 180 },
  };
  const maskTarget = {
    id: crypto.randomUUID(),
    transform: { width: 220, height: 220 },
  };
  const seeded = (await request("/api/transactions", {
    schemaVersion: 1,
    mode: "commit",
    runtimeId: descriptor.runtimeId,
    workspaceId: descriptor.workspaceId,
    scope: { kind: "frame", projectId, frameId },
    baseRevision: frame.revision,
    actor: { source: "system", id: "representative-render-seed" },
    operations: [
      {
        kind: "createNode",
        parentId: "root",
        node: {
          id: gradientTarget.id,
          type: "rectangle",
          name: "Gradient target",
          visible: true,
          locked: false,
          transform: {
            x: 80,
            y: 80,
            ...gradientTarget.transform,
            rotation: 0,
            scaleX: 1,
            scaleY: 1,
            skewX: 0,
            skewY: 0,
            anchorX: 0,
            anchorY: 0,
          },
          opacity: 1,
          blendMode: "normal",
          fill: { type: "solid", color: "#315CF5", opacity: 1 },
          cornerRadius: {
            topLeft: 0,
            topRight: 0,
            bottomRight: 0,
            bottomLeft: 0,
          },
        },
      },
      {
        kind: "createNode",
        parentId: "root",
        node: {
          id: maskTarget.id,
          type: "rectangle",
          name: "Mask target",
          visible: true,
          locked: false,
          transform: {
            x: 400,
            y: 120,
            ...maskTarget.transform,
            rotation: 0,
            scaleX: 1,
            scaleY: 1,
            skewX: 0,
            skewY: 0,
            anchorX: 0,
            anchorY: 0,
          },
          opacity: 1,
          blendMode: "normal",
          fill: { type: "solid", color: "#F0A24A", opacity: 1 },
          cornerRadius: {
            topLeft: 0,
            topRight: 0,
            bottomRight: 0,
            bottomLeft: 0,
          },
        },
      },
    ],
  })) as { revision: number };
  const committed = (await request("/api/transactions", {
    schemaVersion: 1,
    mode: "commit",
    runtimeId: descriptor.runtimeId,
    workspaceId: descriptor.workspaceId,
    scope: { kind: "frame", projectId, frameId },
    baseRevision: seeded.revision,
    actor: { source: "system", id: "representative-render-e2e" },
    operations: [
      {
        kind: "updateNode",
        nodeId: gradientTarget.id,
        propertyGroup: "fill",
        value: {
          fill: {
            type: "linearGradient",
            start: { x: 0, y: 0 },
            end: { x: 1, y: 1 },
            stops: [
              {
                id: crypto.randomUUID(),
                offset: 0,
                color: "#315CF5",
                opacity: 1,
              },
              {
                id: crypto.randomUUID(),
                offset: 1,
                color: "#F0A24A",
                opacity: 1,
              },
            ],
            interpolation: "linear-srgb",
            spread: "pad",
            dither: true,
          },
        },
      },
      {
        kind: "applyMask",
        maskId: crypto.randomUUID(),
        name: "Representative mask",
        mode: "alpha",
        inverted: false,
        maskSource: {
          id: crypto.randomUUID(),
          type: "ellipse",
          name: "Mask source",
          visible: true,
          locked: false,
          transform: {
            x: 0,
            y: 0,
            width: maskTarget.transform.width,
            height: maskTarget.transform.height,
            rotation: 0,
            scaleX: 1,
            scaleY: 1,
            skewX: 0,
            skewY: 0,
            anchorX: 0,
            anchorY: 0,
          },
          opacity: 1,
          blendMode: "normal",
          fill: { type: "solid", color: "#FFFFFF", opacity: 1 },
        },
        nodeIds: [maskTarget.id],
      },
      {
        kind: "addAdjustment",
        adjustment: {
          id: crypto.randomUUID(),
          type: "adjustment",
          name: "Representative tone",
          visible: true,
          locked: false,
          transform: {
            x: 0,
            y: 0,
            width: 1,
            height: 1,
            rotation: 0,
            scaleX: 1,
            scaleY: 1,
            skewX: 0,
            skewY: 0,
            anchorX: 0,
            anchorY: 0,
          },
          enabled: true,
          targetId: "root",
          values: {
            brightness: 0.04,
            contrast: 0.08,
            saturation: 0.05,
            hue: 0,
            blur: 0,
          },
        },
      },
    ],
  })) as { revision: number };
  expect(committed.revision).toBe(seeded.revision + 1);

  const validation = await fetch(
    `${descriptor.baseUrl}/api/projects/${projectId}/frames/${frameId}/validate`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${descriptor.capabilityToken}`,
        "x-design-runtime-id": descriptor.runtimeId,
        "x-design-workspace-id": descriptor.workspaceId,
      },
    },
  );
  expect(validation.status).toBe(200);
  expect(await validation.json()).toMatchObject({ valid: true });
  const rendered = await fetch(
    `${descriptor.baseUrl}/api/projects/${projectId}/frames/${frameId}/render-preview`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${descriptor.capabilityToken}`,
        "x-design-runtime-id": descriptor.runtimeId,
        "x-design-workspace-id": descriptor.workspaceId,
      },
    },
  );
  const renderedBytes = Buffer.from(await rendered.arrayBuffer());
  expect(
    rendered.status,
    rendered.ok ? undefined : renderedBytes.toString("utf8"),
  ).toBe(200);
  expect(rendered.headers.get("content-type")).toContain("image/png");
  expect(renderedBytes.byteLength).toBeGreaterThan(1_000);

  const runtimeHeaders = {
    authorization: `Bearer ${descriptor.capabilityToken}`,
    "x-design-runtime-id": descriptor.runtimeId,
    "x-design-workspace-id": descriptor.workspaceId,
  };
  const concurrent = await Promise.all([
    fetch(
      `${descriptor.baseUrl}/api/projects/${projectId}/frames/${frameId}/validate`,
      { method: "POST", headers: runtimeHeaders },
    ),
    fetch(
      `${descriptor.baseUrl}/api/projects/${projectId}/frames/${frameId}/render-preview`,
      { method: "POST", headers: runtimeHeaders },
    ),
    fetch(
      `${descriptor.baseUrl}/api/projects/${projectId}/frames/${frameId}/export`,
      { method: "POST", headers: runtimeHeaders },
    ),
  ]);
  expect(concurrent.map((response) => response.status)).toEqual([
    200, 200, 200,
  ]);
  const concurrentPreview = Buffer.from(await concurrent[1].arrayBuffer());
  const exportResult = (await concurrent[2].json()) as { path: string };
  const exportedBytes = await readFile(
    path.join(root, "projects", "e2e", exportResult.path),
  );
  expect(exportedBytes).toEqual(concurrentPreview);
  expect(exportedBytes).toEqual(renderedBytes);
});

test("renderer keeps every supported blend mode on a deterministic golden", async () => {
  const blendProjectId = "48484848-4848-4484-8484-484848484848";
  const blendFrameId = "59595959-5959-4595-8595-595959595959";
  const columns = 7;
  const cellWidth = 120;
  const cellHeight = 100;
  const stableNodeId = (index: number): string =>
    `60606060-6060-4606-8606-${String(index + 1).padStart(12, "0")}`;
  await request("/api/transactions", {
    schemaVersion: 1,
    mode: "commit",
    runtimeId: descriptor.runtimeId,
    workspaceId: descriptor.workspaceId,
    scope: { kind: "workspace" },
    baseRevision: null,
    actor: { source: "system", id: "blend-golden-e2e" },
    operations: [
      {
        kind: "createProject",
        projectId: blendProjectId,
        slug: "blend-golden-e2e",
        name: "Blend Golden E2E",
      },
    ],
  });
  await request("/api/transactions", {
    schemaVersion: 1,
    mode: "commit",
    runtimeId: descriptor.runtimeId,
    workspaceId: descriptor.workspaceId,
    scope: { kind: "project", projectId: blendProjectId },
    baseRevision: 0,
    actor: { source: "system", id: "blend-golden-e2e" },
    operations: [
      {
        kind: "createFrame",
        frameId: blendFrameId,
        slug: "supported-blends",
        name: "Supported blends",
        width: columns * cellWidth,
        height: Math.ceil(SUPPORTED_BLEND_MODES.length / columns) * cellHeight,
      },
    ],
  });
  const operations = SUPPORTED_BLEND_MODES.flatMap((blendMode, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const x = column * cellWidth + 10;
    const y = row * cellHeight + 10;
    const common = {
      visible: true,
      locked: false,
      opacity: 1,
      cornerRadius: {
        topLeft: 0,
        topRight: 0,
        bottomRight: 0,
        bottomLeft: 0,
      },
    };
    const transform = (offsetX: number, offsetY: number) => ({
      x: x + offsetX,
      y: y + offsetY,
      width: 72,
      height: 72,
      rotation: 0,
      scaleX: 1,
      scaleY: 1,
      skewX: 0,
      skewY: 0,
      anchorX: 0,
      anchorY: 0,
    });
    return [
      {
        kind: "createNode",
        parentId: "root",
        node: {
          ...common,
          id: stableNodeId(index * 2),
          type: "rectangle",
          name: `${blendMode} base`,
          transform: transform(0, 0),
          blendMode: "normal",
          fill: { type: "solid", color: "#315CF5", opacity: 1 },
        },
      },
      {
        kind: "createNode",
        parentId: "root",
        node: {
          ...common,
          id: stableNodeId(index * 2 + 1),
          type: "rectangle",
          name: blendMode,
          transform: transform(28, 18),
          opacity: 0.82,
          blendMode,
          fill: { type: "solid", color: "#F0A24A", opacity: 1 },
        },
      },
    ];
  });
  await request("/api/transactions", {
    schemaVersion: 1,
    mode: "commit",
    runtimeId: descriptor.runtimeId,
    workspaceId: descriptor.workspaceId,
    scope: {
      kind: "frame",
      projectId: blendProjectId,
      frameId: blendFrameId,
    },
    baseRevision: 0,
    actor: { source: "system", id: "blend-golden-e2e" },
    operations,
  });
  const headers = {
    authorization: `Bearer ${descriptor.capabilityToken}`,
    "x-design-runtime-id": descriptor.runtimeId,
    "x-design-workspace-id": descriptor.workspaceId,
  };
  const previewResponse = await fetch(
    `${descriptor.baseUrl}/api/projects/${blendProjectId}/frames/${blendFrameId}/render-preview`,
    { method: "POST", headers },
  );
  const preview = Buffer.from(await previewResponse.arrayBuffer());
  expect(previewResponse.status).toBe(200);
  expect(preview.readUInt32BE(16)).toBe(columns * cellWidth);
  expect(preview.readUInt32BE(20)).toBe(
    Math.ceil(SUPPORTED_BLEND_MODES.length / columns) * cellHeight,
  );
  const previewHash = createHash("sha256").update(preview).digest("hex");
  expect(previewHash).toBe(
    "73672c9f6000297a8b6566d1a73acbe33c4330a550e67b294a34672dcef75ff9",
  );

  const repeatedResponse = await fetch(
    `${descriptor.baseUrl}/api/projects/${blendProjectId}/frames/${blendFrameId}/render-preview`,
    { method: "POST", headers },
  );
  expect(Buffer.from(await repeatedResponse.arrayBuffer())).toEqual(preview);
  const exportResponse = await fetch(
    `${descriptor.baseUrl}/api/projects/${blendProjectId}/frames/${blendFrameId}/export`,
    { method: "POST", headers },
  );
  const exportResult = (await exportResponse.json()) as { path: string };
  expect(exportResponse.status).toBe(200);
  expect(
    await readFile(
      path.join(root, "projects", "blend-golden-e2e", exportResult.path),
    ),
  ).toEqual(preview);
});

test("renderer pins alpha, luminance, inverted masks, and transparency", async () => {
  const maskProjectId = "71717171-7171-4717-8717-717171717171";
  const maskFrameId = "72727272-7272-4727-8727-727272727272";
  const stableId = (index: number): string =>
    `73737373-7373-4737-8737-${String(index + 1).padStart(12, "0")}`;
  await request("/api/transactions", {
    schemaVersion: 1,
    mode: "commit",
    runtimeId: descriptor.runtimeId,
    workspaceId: descriptor.workspaceId,
    scope: { kind: "workspace" },
    baseRevision: null,
    actor: { source: "system", id: "mask-golden-e2e" },
    operations: [
      {
        kind: "createProject",
        projectId: maskProjectId,
        slug: "mask-golden-e2e",
        name: "Mask Golden E2E",
      },
    ],
  });
  await request("/api/transactions", {
    schemaVersion: 1,
    mode: "commit",
    runtimeId: descriptor.runtimeId,
    workspaceId: descriptor.workspaceId,
    scope: { kind: "project", projectId: maskProjectId },
    baseRevision: 0,
    actor: { source: "system", id: "mask-golden-e2e" },
    operations: [
      {
        kind: "createFrame",
        frameId: maskFrameId,
        slug: "mask-modes",
        name: "Mask modes",
        width: 640,
        height: 180,
      },
    ],
  });
  const maskModes = [
    { mode: "alpha", inverted: false },
    { mode: "alpha", inverted: true },
    { mode: "luminance", inverted: false },
    { mode: "luminance", inverted: true },
  ] as const;
  const operations = maskModes.flatMap(({ mode, inverted }, index) => {
    const nodeId = stableId(index * 3);
    const sourceId = stableId(index * 3 + 1);
    const maskId = stableId(index * 3 + 2);
    return [
      {
        kind: "createNode",
        parentId: "root",
        node: {
          id: nodeId,
          type: "rectangle",
          name: `${mode}${inverted ? " inverted" : ""} content`,
          visible: true,
          locked: false,
          transform: {
            x: 20 + index * 155,
            y: 20,
            width: 140,
            height: 140,
            rotation: 0,
            scaleX: 1,
            scaleY: 1,
            skewX: 0,
            skewY: 0,
            anchorX: 0,
            anchorY: 0,
          },
          opacity: 1,
          blendMode: "normal",
          fill: {
            type: "linearGradient",
            start: { x: 0, y: 0 },
            end: { x: 1, y: 1 },
            stops: [
              {
                id: stableId(20 + index * 2),
                offset: 0,
                color: "#315CF5",
                opacity: 1,
              },
              {
                id: stableId(21 + index * 2),
                offset: 1,
                color: "#F0A24A",
                opacity: 1,
              },
            ],
            interpolation: "linear-srgb",
            spread: "pad",
            dither: true,
          },
          cornerRadius: {
            topLeft: 0,
            topRight: 0,
            bottomRight: 0,
            bottomLeft: 0,
          },
        },
      },
      {
        kind: "applyMask",
        maskId,
        name: `${mode}${inverted ? " inverted" : ""}`,
        mode,
        inverted,
        maskSource: {
          id: sourceId,
          type: mode === "alpha" ? "ellipse" : "rectangle",
          name: `${mode} source`,
          visible: true,
          locked: false,
          transform: {
            x: 0,
            y: 0,
            width: 140,
            height: 140,
            rotation: 0,
            scaleX: 1,
            scaleY: 1,
            skewX: 0,
            skewY: 0,
            anchorX: 0,
            anchorY: 0,
          },
          opacity: 1,
          blendMode: "normal",
          fill:
            mode === "alpha"
              ? { type: "solid", color: "#FFFFFF", opacity: 0.7 }
              : {
                  type: "linearGradient",
                  start: { x: 0, y: 0 },
                  end: { x: 1, y: 0 },
                  stops: [
                    {
                      id: stableId(40 + index * 2),
                      offset: 0,
                      color: "#000000",
                      opacity: 1,
                    },
                    {
                      id: stableId(41 + index * 2),
                      offset: 1,
                      color: "#FFFFFF",
                      opacity: 1,
                    },
                  ],
                  interpolation: "linear-srgb",
                  spread: "pad",
                  dither: true,
                },
          ...(mode === "luminance"
            ? {
                cornerRadius: {
                  topLeft: 0,
                  topRight: 0,
                  bottomRight: 0,
                  bottomLeft: 0,
                },
              }
            : {}),
        },
        nodeIds: [nodeId],
      },
    ];
  });
  await request("/api/transactions", {
    schemaVersion: 1,
    mode: "commit",
    runtimeId: descriptor.runtimeId,
    workspaceId: descriptor.workspaceId,
    scope: { kind: "frame", projectId: maskProjectId, frameId: maskFrameId },
    baseRevision: 0,
    actor: { source: "system", id: "mask-golden-e2e" },
    operations: [
      {
        kind: "setCanvas",
        value: { background: { type: "transparent" } },
      },
      ...operations,
    ],
  });
  const headers = {
    authorization: `Bearer ${descriptor.capabilityToken}`,
    "x-design-runtime-id": descriptor.runtimeId,
    "x-design-workspace-id": descriptor.workspaceId,
  };
  const render = async (): Promise<Buffer> => {
    const response = await fetch(
      `${descriptor.baseUrl}/api/projects/${maskProjectId}/frames/${maskFrameId}/render-preview`,
      { method: "POST", headers },
    );
    const bytes = Buffer.from(await response.arrayBuffer());
    expect(
      response.status,
      response.ok ? undefined : bytes.toString("utf8"),
    ).toBe(200);
    return bytes;
  };
  const preview = await render();
  expect(preview.readUInt32BE(16)).toBe(640);
  expect(preview.readUInt32BE(20)).toBe(180);
  expect(preview[25]).toBe(6);
  expect(createHash("sha256").update(preview).digest("hex")).toBe(
    "6474e133302521940d0226e7aef86d23ba2fec0a385eb0b3f2daf978f1a4dc8c",
  );
  expect(await render()).toEqual(preview);
  const exportResponse = await fetch(
    `${descriptor.baseUrl}/api/projects/${maskProjectId}/frames/${maskFrameId}/export`,
    { method: "POST", headers },
  );
  const exportResult = (await exportResponse.json()) as { path: string };
  expect(exportResponse.status).toBe(200);
  expect(
    await readFile(
      path.join(root, "projects", "mask-golden-e2e", exportResult.path),
    ),
  ).toEqual(preview);
});

test("renderer pins professional static-design primitives in one golden", async () => {
  const goldenProjectId = "81818181-8181-4818-8818-818181818181";
  const goldenFrameId = "82828282-8282-4828-8828-828282828282";
  const stableId = (index: number): string =>
    `83838383-8383-4838-8838-${String(index).padStart(12, "0")}`;
  const runtimeHeaders = {
    authorization: `Bearer ${descriptor.capabilityToken}`,
    "x-design-runtime-id": descriptor.runtimeId,
    "x-design-workspace-id": descriptor.workspaceId,
  };
  await request("/api/transactions", {
    schemaVersion: 1,
    mode: "commit",
    runtimeId: descriptor.runtimeId,
    workspaceId: descriptor.workspaceId,
    scope: { kind: "workspace" },
    baseRevision: null,
    actor: { source: "system", id: "professional-golden-e2e" },
    operations: [
      {
        kind: "createProject",
        projectId: goldenProjectId,
        slug: "professional-golden-e2e",
        name: "Professional Golden E2E",
      },
    ],
  });

  const importFile = async (
    baseRevision: number,
    name: string,
    type: string,
    bytes: Buffer,
  ): Promise<{ id: string; width: number; height: number }> => {
    const form = new FormData();
    form.set("baseRevision", String(baseRevision));
    form.set("file", new File([bytes], name, { type }));
    const response = await fetch(
      `${descriptor.baseUrl}/api/projects/${goldenProjectId}/assets/import`,
      { method: "POST", headers: runtimeHeaders, body: form },
    );
    const body = Buffer.from(await response.arrayBuffer());
    expect(
      response.status,
      response.ok ? undefined : body.toString("utf8"),
    ).toBe(200);
    return (
      JSON.parse(body.toString("utf8")) as {
        asset: { id: string; width: number; height: number };
      }
    ).asset;
  };
  const raster = await importFile(
    0,
    "golden-raster.png",
    "image/png",
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAgAAAAECAYAAACzzX7wAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAI0lEQVQImWP4sMjrPzI2XPQVBTMQVhDj9R8ZG8Z8RcEEFQAAoO5VwdYPUBsAAAAASUVORK5CYII=",
      "base64",
    ),
  );
  const vector = await importFile(
    1,
    "golden-vector.svg",
    "image/svg+xml",
    Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="160" height="100"><path d="M8 92 L80 8 L152 92 Z" fill="#f0a24a"/><circle cx="80" cy="62" r="18" fill="#315cf5"/></svg>',
    ),
  );
  const fontForm = new FormData();
  fontForm.set("baseRevision", "2");
  fontForm.set("licenseNotes", "SIL Open Font License test fixture.");
  fontForm.set(
    "file",
    new File(
      [
        await readFile(
          path.join(
            process.cwd(),
            "apps/studio/node_modules/@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-600-normal.woff2",
          ),
        ),
      ],
      "ibm-plex-sans-600.woff2",
      { type: "font/woff2" },
    ),
  );
  const fontResponse = await fetch(
    `${descriptor.baseUrl}/api/projects/${goldenProjectId}/fonts/import`,
    { method: "POST", headers: runtimeHeaders, body: fontForm },
  );
  const fontBody = Buffer.from(await fontResponse.arrayBuffer());
  expect(
    fontResponse.status,
    fontResponse.ok ? undefined : fontBody.toString("utf8"),
  ).toBe(200);
  const font = (
    JSON.parse(fontBody.toString("utf8")) as {
      font: { id: string };
    }
  ).font;

  await request("/api/transactions", {
    schemaVersion: 1,
    mode: "commit",
    runtimeId: descriptor.runtimeId,
    workspaceId: descriptor.workspaceId,
    scope: { kind: "project", projectId: goldenProjectId },
    baseRevision: 3,
    actor: { source: "system", id: "professional-golden-e2e" },
    operations: [
      {
        kind: "createFrame",
        frameId: goldenFrameId,
        slug: "professional-primitives",
        name: "Professional primitives",
        width: 720,
        height: 540,
      },
    ],
  });

  const transform = (
    x: number,
    y: number,
    width: number,
    height: number,
    extras: Partial<{
      rotation: number;
      scaleX: number;
      scaleY: number;
      skewX: number;
      skewY: number;
    }> = {},
  ) => ({
    x,
    y,
    width,
    height,
    rotation: extras.rotation ?? 0,
    scaleX: extras.scaleX ?? 1,
    scaleY: extras.scaleY ?? 1,
    skewX: extras.skewX ?? 0,
    skewY: extras.skewY ?? 0,
    anchorX: 0,
    anchorY: 0,
  });
  const common = {
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: "normal" as const,
  };
  const cornerRadius = {
    topLeft: 18,
    topRight: 18,
    bottomRight: 18,
    bottomLeft: 18,
  };
  const radial = {
    type: "radialGradient" as const,
    center: { x: 0.48, y: 0.45 },
    radius: { x: 0.78, y: 0.9 },
    focalPoint: { x: 0.28, y: 0.22 },
    stops: [
      { id: stableId(1), offset: 0, color: "#315CF5", opacity: 0.92 },
      { id: stableId(2), offset: 0.55, color: "#18224A", opacity: 0.8 },
      { id: stableId(3), offset: 1, color: "#090B12", opacity: 1 },
    ],
    interpolation: "linear-srgb" as const,
    spread: "pad" as const,
    dither: true as const,
  };
  const gradientStroke = {
    type: "linearGradient" as const,
    start: { x: 0, y: 0 },
    end: { x: 1, y: 1 },
    stops: [
      { id: stableId(4), offset: 0, color: "#F0A24A", opacity: 1 },
      { id: stableId(5), offset: 1, color: "#8BB8FF", opacity: 0.62 },
    ],
    interpolation: "linear-srgb" as const,
    spread: "pad" as const,
    dither: true as const,
  };
  const textNode = (
    id: string,
    name: string,
    text: string,
    y: number,
    alignment: "left" | "center" | "right",
    verticalAlignment: "top" | "middle" | "bottom",
  ) => ({
    ...common,
    id,
    type: "text" as const,
    name,
    transform: transform(378, y, 300, 74),
    text,
    typography: {
      fontId: font.id,
      fontSize: 22,
      fontWeight: 600,
      fontStyle: "normal" as const,
      lineHeight: 27,
      letterSpacing: 0.4,
      alignment,
      verticalAlignment,
      color: "#F4F7FF",
      opacity: 0.94,
    },
    textBox: {
      mode: "fixed" as const,
      width: 300,
      height: 74,
      wrapping: "word" as const,
      overflow: "clip" as const,
      overflowAccepted: false,
    },
  });
  const nestedContentId = stableId(30);
  const firstMaskId = stableId(31);
  const outerMaskId = stableId(32);
  await request("/api/transactions", {
    schemaVersion: 1,
    mode: "commit",
    runtimeId: descriptor.runtimeId,
    workspaceId: descriptor.workspaceId,
    scope: {
      kind: "frame",
      projectId: goldenProjectId,
      frameId: goldenFrameId,
    },
    baseRevision: 0,
    actor: { source: "system", id: "professional-golden-e2e" },
    operations: [
      { kind: "setCanvas", value: { background: radial } },
      {
        kind: "createNode",
        parentId: "root",
        node: {
          ...common,
          id: stableId(10),
          type: "group",
          name: "Isolated campaign card",
          transform: transform(34, 38, 320, 250, {
            rotation: -2,
            skewX: 1.5,
          }),
          opacity: 0.94,
          blendMode: "multiply",
          effects: {
            outerShadow: {
              enabled: true,
              offsetX: 12,
              offsetY: 16,
              blur: 10,
              spread: 3,
              color: "#000000",
              opacity: 0.48,
            },
          },
          children: [
            {
              ...common,
              id: stableId(11),
              type: "rectangle",
              name: "Gradient stroke card",
              transform: transform(8, 8, 304, 234),
              fill: { type: "solid", color: "#121827", opacity: 0.96 },
              stroke: {
                enabled: true,
                width: 8,
                alignment: "inside",
                opacity: 0.9,
                paint: gradientStroke,
              },
              cornerRadius,
            },
            {
              ...common,
              id: stableId(12),
              type: "group",
              name: "Nested transform",
              transform: transform(44, 48, 220, 130, {
                rotation: 8,
                scaleX: 0.94,
                scaleY: 1.06,
                skewY: -3,
              }),
              blendMode: "pass-through",
              children: [
                {
                  ...common,
                  id: stableId(13),
                  type: "ellipse",
                  name: "Dashed ellipse",
                  transform: transform(14, 12, 188, 100),
                  fill: { type: "solid", color: "#315CF5", opacity: 0.24 },
                  stroke: {
                    enabled: true,
                    width: 7,
                    alignment: "center",
                    opacity: 0.88,
                    paint: gradientStroke,
                    dash: {
                      values: [18, 9, 4, 9],
                      offset: 7,
                      cap: "round",
                    },
                  },
                },
              ],
            },
          ],
        },
      },
      {
        kind: "createNode",
        parentId: "root",
        node: {
          ...common,
          id: stableId(20),
          type: "group",
          name: "Pass-through assets",
          transform: transform(44, 318, 300, 172, { rotation: 1.5 }),
          blendMode: "pass-through",
          children: [
            {
              ...common,
              id: stableId(21),
              type: "rasterImage",
              name: "Fill raster",
              transform: transform(0, 0, 60, 70),
              assetId: raster.id,
              fit: "fill",
            },
            {
              ...common,
              id: stableId(26),
              type: "rasterImage",
              name: "Contain raster",
              transform: transform(72, 0, 60, 70),
              assetId: raster.id,
              fit: "contain",
            },
            {
              ...common,
              id: stableId(27),
              type: "rasterImage",
              name: "Cropped cover raster",
              transform: transform(144, 0, 60, 70),
              assetId: raster.id,
              fit: "cover",
              crop: { x: 0.25, y: 0, width: 0.5, height: 1 },
            },
            {
              ...common,
              id: stableId(28),
              type: "rasterImage",
              name: "Natural-size raster",
              transform: transform(216, 0, 60, 70),
              assetId: raster.id,
              fit: "none",
            },
            {
              ...common,
              id: stableId(22),
              type: "svg",
              name: "Editable-source SVG asset",
              transform: transform(82, 82, 132, 76, { rotation: -5 }),
              assetId: vector.id,
              intrinsicSize: { width: vector.width, height: vector.height },
            },
          ],
        },
      },
      {
        kind: "createNode",
        parentId: "root",
        node: textNode(
          stableId(23),
          "Top aligned text",
          "Static campaign graphics with controlled wrapping.",
          44,
          "left",
          "top",
        ),
      },
      {
        kind: "createNode",
        parentId: "root",
        node: textNode(
          stableId(24),
          "Middle aligned text",
          "Agent and human continuity",
          144,
          "center",
          "middle",
        ),
      },
      {
        kind: "createNode",
        parentId: "root",
        node: textNode(
          stableId(25),
          "Bottom aligned text",
          "Stable IDs. Exact exports.",
          244,
          "right",
          "bottom",
        ),
      },
      {
        kind: "createNode",
        parentId: "root",
        node: {
          ...common,
          id: nestedContentId,
          type: "rectangle",
          name: "Nested mask content",
          transform: transform(408, 354, 222, 138),
          fill: gradientStroke,
          cornerRadius: {
            topLeft: 0,
            topRight: 0,
            bottomRight: 0,
            bottomLeft: 0,
          },
        },
      },
      {
        kind: "applyMask",
        maskId: firstMaskId,
        name: "Inner alpha mask",
        mode: "alpha",
        inverted: false,
        maskSource: {
          ...common,
          id: stableId(33),
          type: "ellipse",
          name: "Inner mask source",
          transform: transform(0, 0, 222, 138),
          fill: { type: "solid", color: "#FFFFFF", opacity: 0.78 },
        },
        nodeIds: [nestedContentId],
      },
      {
        kind: "applyMask",
        maskId: outerMaskId,
        name: "Outer luminance mask",
        mode: "luminance",
        inverted: true,
        maskSource: {
          ...common,
          id: stableId(34),
          type: "rectangle",
          name: "Outer mask source",
          transform: transform(0, 0, 222, 138),
          fill: radial,
          cornerRadius: {
            topLeft: 24,
            topRight: 24,
            bottomRight: 24,
            bottomLeft: 24,
          },
        },
        nodeIds: [firstMaskId],
      },
    ],
  });

  const validationResponse = await fetch(
    `${descriptor.baseUrl}/api/projects/${goldenProjectId}/frames/${goldenFrameId}/validate`,
    { method: "POST", headers: runtimeHeaders },
  );
  expect(validationResponse.status).toBe(200);
  expect(await validationResponse.json()).toMatchObject({ valid: true });
  const render = async (): Promise<Buffer> => {
    const response = await fetch(
      `${descriptor.baseUrl}/api/projects/${goldenProjectId}/frames/${goldenFrameId}/render-preview`,
      { method: "POST", headers: runtimeHeaders },
    );
    const bytes = Buffer.from(await response.arrayBuffer());
    expect(
      response.status,
      response.ok ? undefined : bytes.toString("utf8"),
    ).toBe(200);
    return bytes;
  };
  const preview = await render();
  expect(preview.readUInt32BE(16)).toBe(720);
  expect(preview.readUInt32BE(20)).toBe(540);
  await writeFile(
    test.info().outputPath("professional-renderer-golden.png"),
    preview,
  );
  expect([
    "b04234aaf0f6060628929dab06731b2b3b09f473bee8be610f3e3cc5d1a10024",
    "63be05c9581a4d80c6e6a2b6ed10c5bc587a56d8cac6551d53228737084590be",
  ]).toContain(createHash("sha256").update(preview).digest("hex"));
  await test.info().attach("professional-renderer-golden.png", {
    body: preview,
    contentType: "image/png",
  });
  expect(await render()).toEqual(preview);
  const exportResponse = await fetch(
    `${descriptor.baseUrl}/api/projects/${goldenProjectId}/frames/${goldenFrameId}/export`,
    { method: "POST", headers: runtimeHeaders },
  );
  const exportResult = (await exportResponse.json()) as { path: string };
  expect(exportResponse.status).toBe(200);
  expect(
    await readFile(
      path.join(root, "projects", "professional-golden-e2e", exportResult.path),
    ),
  ).toEqual(preview);
});

test("renderer initializes extensionless runtime asset textures from the manifest", async () => {
  const projectResponse = await fetch(
    `${descriptor.baseUrl}/api/projects/${projectId}`,
    {
      headers: {
        authorization: `Bearer ${descriptor.capabilityToken}`,
        "x-design-runtime-id": descriptor.runtimeId,
        "x-design-workspace-id": descriptor.workspaceId,
      },
    },
  );
  const project = (await projectResponse.json()) as { revision: number };
  const form = new FormData();
  form.set("baseRevision", String(project.revision));
  form.set(
    "file",
    new File(
      [
        Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEUlEQVQImWMwjPn6H4QZYAwAVDAKBRgVHI4AAAAASUVORK5CYII=",
          "base64",
        ),
      ],
      "extensionless-loader.png",
      { type: "image/png" },
    ),
  );
  const importedResponse = await fetch(
    `${descriptor.baseUrl}/api/projects/${projectId}/assets/import`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${descriptor.capabilityToken}`,
        "x-design-runtime-id": descriptor.runtimeId,
        "x-design-workspace-id": descriptor.workspaceId,
      },
      body: form,
    },
  );
  const importedBody = Buffer.from(await importedResponse.arrayBuffer());
  expect(
    importedResponse.status,
    importedResponse.ok ? undefined : importedBody.toString("utf8"),
  ).toBe(200);
  const imported = JSON.parse(importedBody.toString("utf8")) as {
    asset: { id: string };
  };

  const frameResponse = await fetch(
    `${descriptor.baseUrl}/api/projects/${projectId}/frames/${frameId}`,
    {
      headers: {
        authorization: `Bearer ${descriptor.capabilityToken}`,
        "x-design-runtime-id": descriptor.runtimeId,
        "x-design-workspace-id": descriptor.workspaceId,
      },
    },
  );
  const frame = (await frameResponse.json()) as { revision: number };
  await request("/api/transactions", {
    schemaVersion: 1,
    mode: "commit",
    runtimeId: descriptor.runtimeId,
    workspaceId: descriptor.workspaceId,
    scope: { kind: "frame", projectId, frameId },
    baseRevision: frame.revision,
    actor: { source: "system", id: "asset-render-e2e" },
    operations: [
      {
        kind: "createNode",
        parentId: "root",
        node: {
          id: crypto.randomUUID(),
          type: "rasterImage",
          name: "Extensionless asset texture",
          visible: true,
          locked: false,
          transform: {
            x: 900,
            y: 1170,
            width: 64,
            height: 64,
            rotation: 0,
            scaleX: 1,
            scaleY: 1,
            skewX: 0,
            skewY: 0,
            anchorX: 0,
            anchorY: 0,
          },
          opacity: 1,
          blendMode: "normal",
          assetId: imported.asset.id,
          fit: "cover",
        },
      },
    ],
  });

  const rendered = await fetch(
    `${descriptor.baseUrl}/api/projects/${projectId}/frames/${frameId}/render-preview`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${descriptor.capabilityToken}`,
        "x-design-runtime-id": descriptor.runtimeId,
        "x-design-workspace-id": descriptor.workspaceId,
      },
    },
  );
  const renderedBytes = Buffer.from(await rendered.arrayBuffer());
  expect(
    rendered.status,
    rendered.ok ? undefined : renderedBytes.toString("utf8"),
  ).toBe(200);
  expect(rendered.headers.get("content-type")).toContain("image/png");
  expect(renderedBytes.byteLength).toBeGreaterThan(1_000);
});

test("production Studio and renderer activate imported project fonts", async ({
  page,
}) => {
  const projectResponse = await fetch(
    `${descriptor.baseUrl}/api/projects/${projectId}`,
    {
      headers: {
        authorization: `Bearer ${descriptor.capabilityToken}`,
        "x-design-runtime-id": descriptor.runtimeId,
        "x-design-workspace-id": descriptor.workspaceId,
      },
    },
  );
  const project = (await projectResponse.json()) as { revision: number };
  const fontBytes = await readFile(
    path.join(
      process.cwd(),
      "apps/studio/node_modules/@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-600-normal.woff2",
    ),
  );
  const form = new FormData();
  form.set("baseRevision", String(project.revision));
  form.set("licenseNotes", "SIL Open Font License test fixture.");
  form.set(
    "file",
    new File([fontBytes], "ibm-plex-sans-600.woff2", {
      type: "font/woff2",
    }),
  );
  const importedResponse = await fetch(
    `${descriptor.baseUrl}/api/projects/${projectId}/fonts/import`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${descriptor.capabilityToken}`,
        "x-design-runtime-id": descriptor.runtimeId,
        "x-design-workspace-id": descriptor.workspaceId,
      },
      body: form,
    },
  );
  const importedBody = Buffer.from(await importedResponse.arrayBuffer());
  expect(
    importedResponse.status,
    importedResponse.ok ? undefined : importedBody.toString("utf8"),
  ).toBe(200);
  const imported = JSON.parse(importedBody.toString("utf8")) as {
    font: { id: string; weight: number };
  };
  expect(imported.font.weight).toBe(600);

  const frameResponse = await fetch(
    `${descriptor.baseUrl}/api/projects/${projectId}/frames/${frameId}`,
    {
      headers: {
        authorization: `Bearer ${descriptor.capabilityToken}`,
        "x-design-runtime-id": descriptor.runtimeId,
        "x-design-workspace-id": descriptor.workspaceId,
      },
    },
  );
  const frame = (await frameResponse.json()) as { revision: number };
  await request("/api/transactions", {
    schemaVersion: 1,
    mode: "commit",
    runtimeId: descriptor.runtimeId,
    workspaceId: descriptor.workspaceId,
    scope: { kind: "frame", projectId, frameId },
    baseRevision: frame.revision,
    actor: { source: "system", id: "font-render-e2e" },
    operations: [
      {
        kind: "createNode",
        parentId: "root",
        node: {
          id: crypto.randomUUID(),
          type: "text",
          name: "Imported project font",
          visible: true,
          locked: false,
          transform: {
            x: 640,
            y: 1120,
            width: 360,
            height: 90,
            rotation: 0,
            scaleX: 1,
            scaleY: 1,
            skewX: 0,
            skewY: 0,
            anchorX: 0,
            anchorY: 0,
          },
          opacity: 1,
          blendMode: "normal",
          text: "IMPORTED FONT ACTIVE",
          typography: {
            fontId: imported.font.id,
            fontSize: 32,
            fontWeight: imported.font.weight,
            fontStyle: "normal",
            lineHeight: 40,
            letterSpacing: 0,
            alignment: "left",
            verticalAlignment: "top",
            color: "#FFFFFF",
            opacity: 1,
          },
          textBox: {
            mode: "fixed",
            width: 360,
            height: 90,
            wrapping: "word",
            overflow: "clip",
            overflowAccepted: false,
          },
        },
      },
    ],
  });

  const rendered = await fetch(
    `${descriptor.baseUrl}/api/projects/${projectId}/frames/${frameId}/render-preview`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${descriptor.capabilityToken}`,
        "x-design-runtime-id": descriptor.runtimeId,
        "x-design-workspace-id": descriptor.workspaceId,
      },
    },
  );
  const renderedBytes = Buffer.from(await rendered.arrayBuffer());
  expect(
    rendered.status,
    rendered.ok ? undefined : renderedBytes.toString("utf8"),
  ).toBe(200);
  expect(renderedBytes.byteLength).toBeGreaterThan(1_000);

  await bootstrapStudio(page, `/project/${projectId}/frame/${frameId}`);
  await expect(page.locator("canvas")).toHaveAttribute(
    "data-renderer-state",
    "ready",
  );
  const family = `ADR_${imported.font.id.replaceAll("-", "_")}`;
  await expect
    .poll(() =>
      page.evaluate(
        (requestedFamily) =>
          [...document.fonts].find(
            (candidate) => candidate.family === requestedFamily,
          )?.status,
        family,
      ),
    )
    .toBe("loaded");
  const activation = await page.evaluate(
    ({ requestedFamily, weight }) => {
      const face = [...document.fonts].find(
        (candidate) => candidate.family === requestedFamily,
      );
      const context = document.createElement("canvas").getContext("2d")!;
      context.font = `${weight} 48px "${requestedFamily}"`;
      const projectWidth = context.measureText("Hamburgefontsiv").width;
      context.font = `${weight} 48px serif`;
      const fallbackWidth = context.measureText("Hamburgefontsiv").width;
      return {
        face: face
          ? {
              family: face.family,
              status: face.status,
              style: face.style,
              weight: face.weight,
            }
          : undefined,
        projectWidth,
        fallbackWidth,
      };
    },
    { requestedFamily: family, weight: imported.font.weight },
  );
  expect(activation.face).toEqual({
    family,
    status: "loaded",
    style: "normal",
    weight: String(imported.font.weight),
  });
  expect(
    Math.abs(activation.projectWidth - activation.fallbackWidth),
  ).toBeGreaterThan(1);
});

test("Studio imports, places, and renders PNG, SVG, and editable paths", async ({
  page,
}, testInfo) => {
  const importProjectId = "77777777-7777-4777-8777-777777777777";
  const importFrameId = "88888888-8888-4888-8888-888888888888";
  const browserMessages: string[] = [];
  await request("/api/transactions", {
    schemaVersion: 1,
    mode: "commit",
    runtimeId: descriptor.runtimeId,
    workspaceId: descriptor.workspaceId,
    scope: { kind: "workspace" },
    baseRevision: null,
    actor: { source: "system", id: "asset-import-e2e" },
    operations: [
      {
        kind: "createProject",
        projectId: importProjectId,
        slug: "asset-import-e2e",
        name: "Asset Import E2E",
      },
    ],
  });
  await request("/api/transactions", {
    schemaVersion: 1,
    mode: "commit",
    runtimeId: descriptor.runtimeId,
    workspaceId: descriptor.workspaceId,
    scope: { kind: "project", projectId: importProjectId },
    baseRevision: 0,
    actor: { source: "system", id: "asset-import-e2e" },
    operations: [
      {
        kind: "createFrame",
        frameId: importFrameId,
        slug: "asset-imports",
        name: "Asset Imports",
        width: 1080,
        height: 1350,
      },
    ],
  });
  await bootstrapStudio(
    page,
    `/project/${importProjectId}/frame/${importFrameId}`,
  );
  await expect(
    page.getByRole("button", { name: /Asset Imports/ }),
  ).toBeVisible();
  page.on("console", (message) => {
    if (message.type() === "error" || message.type() === "warning")
      browserMessages.push(`${message.type()}: ${message.text()}`);
  });
  page.on("pageerror", (error) => browserMessages.push(error.message));
  const canvas = page.locator("canvas");
  const blankCanvas = await canvas.screenshot();
  const assetInput = page.locator('input[type="file"]').first();
  const redPng = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAHgAAABQCAYAAADSm7GJAAAACXBIWXMAAAPoAAAD6AG1e1JrAAABjElEQVR4nO2VwRHAIADCnIb9B2IXO0UPaPPI3yNGj6UL+uwGJ30AEIK5BKJgLoF4ov3DL4E/WHkJCC4YyqNQsPISEFwwlEehYOUlILhgKI9CwcpLQHDBUB6FgpWXgOCCoTwKBSsvAcEFQ3kUClZeAoILhvIoFKy8BAQXDOVRKFh5CQguGMqjULDyEhBcMJRHoWDlJSC4YCiPQsHKS0BwwVAehYKVl4DggqE8CgUrLwHBBUN5FApWXgKCC4byKBSsvAQEFwzlUShYeQkILhjKo1Cw8hIQXDCUR6Fg5SUguGAoj0LByktAcMFQHoWClZeA4IKhPAoFKy8BwQVDeRQKVl4CgguG8igUrLwEBBcM5VEoWHkJCC4YyqNQsPISEFwwlEehYOUlILhgKI9CwcpLQHDBUB6FgpWXgOCCoTwKBSsvAcEFQ3kUClZeAoILhvIoFKy8BAQXDOVRKFh5CQguGMqjULDyEhBcMJRHoWDlJSC4YCiPQsHKS0BwwVAehYKVl4DggqE8CgUrL+FNHm0guzFwwB4SAAAAAElFTkSuQmCC",
    "base64",
  );
  await assetInput.setInputFiles({
    name: "brand-mark.png",
    mimeType: "image/png",
    buffer: redPng,
  });
  const rasterLayers = page
    .getByRole("treeitem")
    .filter({ hasText: "brand-mark" });
  await expect(rasterLayers).toHaveCount(1);
  await expect(rasterLayers.first()).toHaveAttribute("aria-selected", "true");
  await expect(page.locator(".feedback-toast")).toContainText(
    "brand-mark.png imported and placed.",
  );
  await expect
    .poll(async () => !(await canvas.screenshot()).equals(blankCanvas))
    .toBe(true);
  const rasterCanvas = await canvas.screenshot();

  await assetInput.setInputFiles({
    name: "brand-mark.png",
    mimeType: "image/png",
    buffer: redPng,
  });
  await expect(rasterLayers).toHaveCount(2);

  const blueSvg = Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100"><rect width="200" height="100" fill="#315cf5"/></svg>',
  );
  await assetInput.setInputFiles({
    name: "brand-vector.svg",
    mimeType: "image/svg+xml",
    buffer: blueSvg,
  });
  const vectorLayer = page
    .getByRole("treeitem")
    .filter({ hasText: "brand-vector" });
  await expect(vectorLayer).toHaveCount(1);
  await expect(vectorLayer).toHaveAttribute("aria-selected", "true");
  await expect
    .poll(async () => !(await canvas.screenshot()).equals(rasterCanvas))
    .toBe(true);

  const editableSvg = Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100"><path d="M10 85 C50 5 150 5 190 85 L100 95 Z" fill="#ff3366" stroke="#ffffff" stroke-width="3" stroke-dasharray="8 4"/></svg>',
  );
  await assetInput.setInputFiles({
    name: "campaign-swoop.svg",
    mimeType: "image/svg+xml",
    buffer: editableSvg,
  });
  const pathLayer = page
    .getByRole("treeitem")
    .filter({ hasText: "campaign-swoop" });
  await expect(pathLayer).toHaveCount(1);
  await expect(pathLayer).toHaveAttribute("aria-selected", "true");
  await expect(page.locator(".feedback-toast")).toContainText(
    "campaign-swoop.svg imported and placed as an editable vector path.",
  );
  await expect(page.getByText("Coordinates are normalized")).toBeVisible();
  const curveX = page
    .locator(".vector-command")
    .nth(1)
    .getByLabel("X", { exact: true });
  await curveX.fill("0.82");
  await curveX.press("Tab");
  await expect(
    page.getByRole("button", { name: /Asset Imports/ }),
  ).toContainText("r5");
  await pathLayer.click();
  await page.getByRole("button", { name: "Add curve point" }).click();
  await expect(
    page.getByRole("button", { name: /Asset Imports/ }),
  ).toContainText("r6");
  await pathLayer.click();
  await expect(
    page.getByRole("button", { name: "Add vector path" }),
  ).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("editable-vector-path-studio.png"),
    fullPage: true,
  });

  const headers = {
    authorization: `Bearer ${descriptor.capabilityToken}`,
    "x-design-runtime-id": descriptor.runtimeId,
    "x-design-workspace-id": descriptor.workspaceId,
  };
  const assetsResponse = await fetch(
    `${descriptor.baseUrl}/api/projects/${importProjectId}/assets`,
    { headers },
  );
  expect(assetsResponse.status).toBe(200);
  const assets = (await assetsResponse.json()) as {
    assets: Array<{ id: string; type: "raster" | "svg" }>;
  };
  expect(assets.assets.map((asset) => asset.type).sort()).toEqual([
    "raster",
    "svg",
    "svg",
  ]);
  const frameResponse = await fetch(
    `${descriptor.baseUrl}/api/projects/${importProjectId}/frames/${importFrameId}`,
    { headers },
  );
  const importedFrame = (await frameResponse.json()) as {
    revision: number;
    root: {
      children: Array<{
        type: string;
        transform: { x: number; y: number; width: number; height: number };
        commands?: Array<{
          kind: string;
          to?: { x: number; y: number };
        }>;
      }>;
    };
  };
  expect(importedFrame.revision).toBe(6);
  expect(importedFrame.root.children.map((node) => node.type)).toEqual([
    "rasterImage",
    "rasterImage",
    "svg",
    "vectorPath",
  ]);
  expect(importedFrame.root.children[0]?.transform).toMatchObject({
    x: 480,
    y: 635,
    width: 120,
    height: 80,
  });
  expect(importedFrame.root.children[2]?.transform).toMatchObject({
    x: 440,
    y: 625,
    width: 200,
    height: 100,
  });
  expect(importedFrame.root.children[3]).toMatchObject({
    type: "vectorPath",
    commands: expect.arrayContaining([
      expect.objectContaining({ kind: "cubic", to: { x: 0.82, y: 0.85 } }),
    ]),
  });

  const previewResponse = await fetch(
    `${descriptor.baseUrl}/api/projects/${importProjectId}/frames/${importFrameId}/render-preview`,
    { method: "POST", headers },
  );
  const previewBytes = Buffer.from(await previewResponse.arrayBuffer());
  expect(
    previewResponse.status,
    previewResponse.ok ? undefined : previewBytes.toString("utf8"),
  ).toBe(200);
  expect(previewBytes.byteLength).toBeGreaterThan(1_000);
  await writeFile(
    testInfo.outputPath("editable-vector-path-render.png"),
    previewBytes,
  );
  await page.getByRole("button", { name: "Export PNG" }).click();
  await expect(page.locator(".feedback-toast")).toContainText(
    "Exported 1080×1350",
  );
  const exportedPath = path.join(
    root,
    "projects",
    "asset-import-e2e",
    "exports",
    "asset-imports-r6.png",
  );
  expect((await stat(exportedPath)).size).toBeGreaterThan(1_000);
  const exportedBytes = await readFile(exportedPath);
  expect(createHash("sha256").update(exportedBytes).digest("hex")).toBe(
    createHash("sha256").update(previewBytes).digest("hex"),
  );
  expect(await page.locator(".canvas-error").allTextContents()).toEqual([]);
  const unexpectedBrowserMessages = browserMessages.filter(
    (message) =>
      !(
        message.includes("WebSocket connection to") &&
        message.includes("/api/events") &&
        message.includes("HTTP Authentication failed")
      ) &&
      !message.includes("GPU stall due to ReadPixels") &&
      !message.startsWith("warning:     at #"),
  );
  expect(unexpectedBrowserMessages).toEqual([]);
});

test("canonical export presets drive multi-format Studio, HTTP, and MCP exports", async ({
  page,
}, testInfo) => {
  test.setTimeout(90_000);
  const exportProjectId = "8a000000-0000-4000-8000-000000000001";
  const firstFrameId = "8a000000-0000-4000-8000-000000000002";
  const secondFrameId = "8a000000-0000-4000-8000-000000000003";
  const blockedFrameId = "8a000000-0000-4000-8000-000000000004";
  await request("/api/transactions", {
    schemaVersion: 1,
    mode: "commit",
    runtimeId: descriptor.runtimeId,
    workspaceId: descriptor.workspaceId,
    scope: { kind: "workspace" },
    baseRevision: null,
    actor: { source: "system", id: "export-e2e" },
    operations: [
      {
        kind: "createProject",
        projectId: exportProjectId,
        slug: "export-contract-e2e",
        name: "Export Contract E2E",
      },
    ],
  });
  await request("/api/transactions", {
    schemaVersion: 1,
    mode: "commit",
    runtimeId: descriptor.runtimeId,
    workspaceId: descriptor.workspaceId,
    scope: { kind: "project", projectId: exportProjectId },
    baseRevision: 0,
    actor: { source: "system", id: "export-e2e" },
    operations: [
      {
        kind: "createFrame",
        frameId: firstFrameId,
        slug: "transparent-story",
        name: "Transparent story",
        width: 1080,
        height: 1350,
      },
      {
        kind: "createFrame",
        frameId: secondFrameId,
        slug: "transparent-square",
        name: "Transparent square",
        width: 1080,
        height: 1080,
      },
      {
        kind: "createFrame",
        frameId: blockedFrameId,
        slug: "blocked-copy",
        name: "Blocked copy",
        width: 600,
        height: 600,
      },
    ],
  });
  const exportFont = await importProjectFont({
    projectId: exportProjectId,
    baseRevision: 1,
    path: path.join(
      process.cwd(),
      "apps/studio/node_modules/@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-600-normal.woff2",
    ),
    filename: "export-contract-ibm-plex-sans-600.woff2",
  });
  for (const [id, cardId, textId, width, height] of [
    [
      firstFrameId,
      "8a000000-0000-4000-8000-000000000010",
      "8a000000-0000-4000-8000-000000000011",
      1080,
      1350,
    ],
    [
      secondFrameId,
      "8a000000-0000-4000-8000-000000000012",
      "8a000000-0000-4000-8000-000000000013",
      1080,
      1080,
    ],
  ] as const)
    await request("/api/transactions", {
      schemaVersion: 1,
      mode: "commit",
      runtimeId: descriptor.runtimeId,
      workspaceId: descriptor.workspaceId,
      scope: { kind: "frame", projectId: exportProjectId, frameId: id },
      baseRevision: 0,
      actor: { source: "system", id: "export-e2e" },
      operations: [
        {
          kind: "setCanvas",
          value: { background: { type: "transparent" } },
        },
        {
          kind: "createNode",
          parentId: "root",
          node: {
            id: cardId,
            type: "rectangle",
            name: "Campaign card",
            visible: true,
            locked: false,
            transform: {
              x: 72,
              y: 72,
              width: width - 144,
              height: height - 144,
              rotation: 0,
              scaleX: 1,
              scaleY: 1,
              skewX: 0,
              skewY: 0,
              anchorX: 0,
              anchorY: 0,
            },
            opacity: 1,
            blendMode: "normal",
            fill: {
              type: "linearGradient",
              start: { x: 0, y: 0 },
              end: { x: 1, y: 1 },
              stops: [
                {
                  id: crypto.randomUUID(),
                  offset: 0,
                  color: "#1D2E6F",
                  opacity: 1,
                },
                {
                  id: crypto.randomUUID(),
                  offset: 1,
                  color: "#315CF5",
                  opacity: 1,
                },
              ],
              interpolation: "linear-srgb",
              spread: "pad",
              dither: true,
            },
            cornerRadius: {
              topLeft: 48,
              topRight: 48,
              bottomRight: 48,
              bottomLeft: 48,
            },
          },
        },
        {
          kind: "createNode",
          parentId: "root",
          node: {
            id: textId,
            type: "text",
            name: "Campaign headline",
            visible: true,
            locked: false,
            transform: {
              x: 140,
              y: height / 2 - 70,
              width: width - 280,
              height: 140,
              rotation: 0,
              scaleX: 1,
              scaleY: 1,
              skewX: 0,
              skewY: 0,
              anchorX: 0,
              anchorY: 0,
            },
            opacity: 1,
            blendMode: "normal",
            text:
              id === firstFrameId
                ? "MAKE THE SYSTEM VISIBLE"
                : "ONE IDEA. EVERY FORMAT.",
            typography: {
              fontId: exportFont.id,
              fontSize: 58,
              fontWeight: 600,
              fontStyle: "normal",
              lineHeight: 70,
              letterSpacing: 0.5,
              alignment: "center",
              verticalAlignment: "middle",
              color: "#FFFFFF",
              opacity: 1,
            },
            textBox: {
              mode: "fixed",
              width: width - 280,
              height: 140,
              wrapping: "word",
              overflow: "clip",
              overflowAccepted: false,
            },
          },
        },
      ],
    });
  await request("/api/transactions", {
    schemaVersion: 1,
    mode: "commit",
    runtimeId: descriptor.runtimeId,
    workspaceId: descriptor.workspaceId,
    scope: {
      kind: "frame",
      projectId: exportProjectId,
      frameId: blockedFrameId,
    },
    baseRevision: 0,
    actor: { source: "system", id: "export-e2e" },
    operations: [
      {
        kind: "createNode",
        parentId: "root",
        node: {
          id: "8a000000-0000-4000-8000-000000000005",
          type: "text",
          name: "Unresolved type",
          visible: true,
          locked: false,
          transform: {
            x: 20,
            y: 20,
            width: 120,
            height: 20,
            rotation: 0,
            scaleX: 1,
            scaleY: 1,
            skewX: 0,
            skewY: 0,
            anchorX: 0,
            anchorY: 0,
          },
          opacity: 1,
          blendMode: "normal",
          text: "This deliberately overflowing campaign message cannot fit inside a single short line.",
          typography: {
            fontId: exportFont.id,
            fontSize: 24,
            fontWeight: 600,
            fontStyle: "normal",
            lineHeight: 28,
            letterSpacing: 0,
            alignment: "left",
            verticalAlignment: "top",
            color: "#000000",
            opacity: 1,
          },
          textBox: {
            mode: "fixed",
            width: 120,
            height: 20,
            wrapping: "word",
            overflow: "clip",
            overflowAccepted: false,
          },
        },
      },
    ],
  });

  await bootstrapStudio(
    page,
    `/project/${exportProjectId}/frame/${firstFrameId}`,
  );
  await expect(
    page.getByRole("button", { name: /Transparent story/ }),
  ).toContainText("r1");
  await page.getByRole("button", { name: "Export options" }).click();
  const dialog = page.getByRole("dialog", { name: "Export campaign frames" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Select all" }).click();
  await dialog.getByLabel("Blocked copy").uncheck();
  await dialog.getByLabel("Format").selectOption("webp");
  await dialog.getByLabel("Scale").selectOption("2");
  await dialog.getByLabel("Quality").fill("82");
  await expect(dialog.getByText("Alpha retained")).toBeVisible();
  await dialog.getByLabel("Preset name").fill("Campaign WebP 2x");
  await page.screenshot({
    path: testInfo.outputPath("phase3-export-studio.png"),
    fullPage: true,
  });
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.locator(".feedback-toast")).toContainText(
    "Saved export preset",
  );
  await dialog.getByRole("button", { name: "Export 2 frames" }).click();
  await expect(page.locator(".feedback-toast")).toContainText(
    "Exported 2 WEBP frames at 2×",
    { timeout: 20_000 },
  );
  await expect(dialog).not.toBeVisible();

  const projectResponse = await fetch(
    `${descriptor.baseUrl}/api/projects/${exportProjectId}`,
    { headers: runtimeHeaders() },
  );
  const projectDocument = (await projectResponse.json()) as {
    exportPresets: Array<{
      name: string;
      format: string;
      scale: number;
      quality: number;
    }>;
  };
  expect(projectDocument.exportPresets).toEqual([
    expect.objectContaining({
      name: "Campaign WebP 2x",
      format: "webp",
      scale: 2,
      quality: 82,
    }),
  ]);
  for (const [slug, dimensions] of [
    ["transparent-story", { width: 2160, height: 2700 }],
    ["transparent-square", { width: 2160, height: 2160 }],
  ] as const) {
    const artifact = path.join(
      root,
      "projects",
      "export-contract-e2e",
      "exports",
      `${slug}-r1-2x-q82.webp`,
    );
    const metadata = await sharp(await readFile(artifact)).metadata();
    expect(metadata).toMatchObject({
      format: "webp",
      ...dimensions,
      hasAlpha: true,
    });
    if (slug === "transparent-story")
      await writeFile(
        testInfo.outputPath("phase3-export-render.webp"),
        await readFile(artifact),
      );
  }

  const jpegResponse = await fetch(
    `${descriptor.baseUrl}/api/projects/${exportProjectId}/frames/${firstFrameId}/export`,
    {
      method: "POST",
      headers: { ...runtimeHeaders(), "content-type": "application/json" },
      body: JSON.stringify({
        format: "jpeg",
        scale: 0.5,
        quality: 70,
        matteColor: "#FF00FF",
      }),
    },
  );
  const jpegResult = (await jpegResponse.json()) as {
    path: string;
    width: number;
    height: number;
    transparent: boolean;
    resourceStats: {
      activeRenderers: number;
      completedRenders: number;
      maxActiveRenderers: number;
    };
  };
  expect(jpegResponse.status, JSON.stringify(jpegResult)).toBe(200);
  expect(jpegResult).toMatchObject({
    path: "exports/transparent-story-r1-0.5x-q70-mff00ff.jpg",
    width: 540,
    height: 675,
    transparent: false,
    resourceStats: {
      activeRenderers: 0,
      maxActiveRenderers: 1,
    },
  });
  const jpegPath = path.join(
    root,
    "projects",
    "export-contract-e2e",
    jpegResult.path,
  );
  const jpegMetadata = await sharp(await readFile(jpegPath)).metadata();
  expect(jpegMetadata).toMatchObject({
    format: "jpeg",
    width: 540,
    height: 675,
    hasAlpha: false,
  });
  const jpegPixel = await sharp(await readFile(jpegPath))
    .raw()
    .toBuffer();
  expect(jpegPixel[0]).toBeGreaterThan(245);
  expect(jpegPixel[1]).toBeLessThan(10);
  expect(jpegPixel[2]).toBeGreaterThan(245);

  const pngResponse = await fetch(
    `${descriptor.baseUrl}/api/projects/${exportProjectId}/frames/${firstFrameId}/export`,
    { method: "POST", headers: runtimeHeaders() },
  );
  const pngResult = (await pngResponse.json()) as { path: string };
  expect(pngResponse.status, JSON.stringify(pngResult)).toBe(200);
  expect(pngResult.path).toBe("exports/transparent-story-r1.png");
  const previewResponse = await fetch(
    `${descriptor.baseUrl}/api/projects/${exportProjectId}/frames/${firstFrameId}/render-preview`,
    { method: "POST", headers: runtimeHeaders() },
  );
  expect(
    await readFile(
      path.join(root, "projects", "export-contract-e2e", pngResult.path),
    ),
  ).toEqual(Buffer.from(await previewResponse.arrayBuffer()));

  const blockedArtifact = path.join(
    root,
    "projects",
    "export-contract-e2e",
    "exports",
    "transparent-story-r1-3x-q31.webp",
  );
  const blockedBatch = await fetch(
    `${descriptor.baseUrl}/api/projects/${exportProjectId}/export`,
    {
      method: "POST",
      headers: { ...runtimeHeaders(), "content-type": "application/json" },
      body: JSON.stringify({
        frameIds: [firstFrameId, blockedFrameId],
        settings: { format: "webp", scale: 3, quality: 31 },
      }),
    },
  );
  expect(blockedBatch.status).toBe(409);
  await expect(stat(blockedArtifact)).rejects.toMatchObject({ code: "ENOENT" });

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["apps/mcp/dist/cli.js", "--descriptor", descriptorPath],
    cwd: process.cwd(),
    stderr: "pipe",
  });
  const mcp = new Client({ name: "export-e2e", version: "1.0.0" });
  await mcp.connect(transport);
  try {
    const tools = await mcp.listTools();
    expect(tools.tools.map((tool) => tool.name)).toEqual(
      expect.arrayContaining(["export_frame", "export_project"]),
    );
    const exported = await mcp.callTool({
      name: "export_frame",
      arguments: {
        projectId: exportProjectId,
        frameId: secondFrameId,
        format: "webp",
        scale: 0.5,
        quality: 88,
      },
    });
    expect(exported.isError).not.toBe(true);
    expect(exported.structuredContent).toMatchObject({
      format: "webp",
      width: 540,
      height: 540,
      transparent: true,
      path: "exports/transparent-square-r1-0.5x-q88.webp",
    });
  } finally {
    await mcp.close();
  }
});

test("canonical semantic templates carry a 42-layer campaign from Studio to MCP and back", async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  const templateProjectId = "9b000000-0000-4000-8000-000000000001";
  const templateFrameId = "9b000000-0000-4000-8000-000000000002";
  const sourceGroupId = "9b000000-0000-4000-8000-000000000003";
  const transform = (x: number, y: number, width: number, height: number) => ({
    x,
    y,
    width,
    height,
    rotation: 0,
    scaleX: 1,
    scaleY: 1,
    skewX: 0,
    skewY: 0,
    anchorX: 0,
    anchorY: 0,
  });
  const rectangleNode = (
    name: string,
    x: number,
    y: number,
    width: number,
    height: number,
    color: string,
    id = crypto.randomUUID(),
  ) => ({
    id,
    type: "rectangle" as const,
    name,
    visible: true,
    locked: false,
    transform: transform(x, y, width, height),
    opacity: 1,
    blendMode: "normal" as const,
    fill: { type: "solid" as const, color, opacity: 1 },
    cornerRadius: {
      topLeft: 18,
      topRight: 18,
      bottomRight: 18,
      bottomLeft: 18,
    },
  });
  await request("/api/transactions", {
    schemaVersion: 1,
    mode: "commit",
    runtimeId: descriptor.runtimeId,
    workspaceId: descriptor.workspaceId,
    scope: { kind: "workspace" },
    baseRevision: null,
    actor: { source: "system", id: "template-e2e" },
    operations: [
      {
        kind: "createProject",
        projectId: templateProjectId,
        slug: "template-continuity-e2e",
        name: "Template Continuity E2E",
      },
    ],
  });
  await request("/api/transactions", {
    schemaVersion: 1,
    mode: "commit",
    runtimeId: descriptor.runtimeId,
    workspaceId: descriptor.workspaceId,
    scope: { kind: "project", projectId: templateProjectId },
    baseRevision: 0,
    actor: { source: "system", id: "template-e2e" },
    operations: [
      {
        kind: "createFrame",
        frameId: templateFrameId,
        slug: "campaign-template",
        name: "Campaign Template",
        width: 1080,
        height: 1350,
      },
    ],
  });
  const templateFont = await importProjectFont({
    projectId: templateProjectId,
    baseRevision: 1,
    path: path.join(
      process.cwd(),
      "apps/studio/node_modules/@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-600-normal.woff2",
    ),
    filename: "template-continuity-ibm-plex-sans-600.woff2",
  });
  const textNode = (
    name: string,
    text: string,
    x: number,
    y: number,
    width: number,
    height: number,
    fontSize: number,
    color = "#F7F9FF",
  ) => ({
    id: crypto.randomUUID(),
    type: "text" as const,
    name,
    visible: true,
    locked: false,
    transform: transform(x, y, width, height),
    opacity: 1,
    blendMode: "normal" as const,
    text,
    typography: {
      fontId: templateFont.id,
      fontSize,
      fontWeight: 600,
      fontStyle: "normal" as const,
      lineHeight: fontSize * 1.15,
      letterSpacing: 0,
      alignment: "left" as const,
      verticalAlignment: "middle" as const,
      color,
      opacity: 1,
    },
    textBox: {
      mode: "fixed" as const,
      width,
      height,
      wrapping: "word" as const,
      overflow: "clip" as const,
      overflowAccepted: false,
    },
  });
  const semanticNodes = [
    rectangleNode("Background", 0, 0, 1080, 1350, "#0B1020"),
    rectangleNode("Hero image", 72, 92, 936, 510, "#315CF5"),
    rectangleNode("Logo", 72, 56, 150, 42, "#F7F9FF"),
    rectangleNode("Badge", 760, 640, 248, 56, "#FFB000"),
    textNode(
      "Headline",
      "SYSTEMS THAT KEEP THEIR INTENT",
      72,
      720,
      936,
      160,
      66,
    ),
    textNode(
      "Supporting copy",
      "Agents propose. Humans refine. Canonical state stays editable.",
      72,
      896,
      820,
      100,
      30,
      "#C8D0EA",
    ),
    rectangleNode("CTA", 72, 1050, 360, 88, "#FF4F8B"),
    textNode(
      "Legal copy",
      "ADR campaign system · approved local proof",
      72,
      1230,
      700,
      44,
      18,
      "#8D97B4",
    ),
  ];
  const decorationNodes = Array.from({ length: 32 }, (_, index) =>
    rectangleNode(
      `Supporting graphic ${String(index + 1).padStart(2, "0")}`,
      92 + (index % 8) * 112,
      126 + Math.floor(index / 8) * 108,
      72,
      72,
      index % 2 === 0 ? "#8AA4FF" : "#152858",
    ),
  );
  const sourceChildren = [...semanticNodes, ...decorationNodes];
  expect(sourceChildren).toHaveLength(40);
  await request("/api/transactions", {
    schemaVersion: 1,
    mode: "commit",
    runtimeId: descriptor.runtimeId,
    workspaceId: descriptor.workspaceId,
    scope: {
      kind: "frame",
      projectId: templateProjectId,
      frameId: templateFrameId,
    },
    baseRevision: 0,
    actor: { source: "system", id: "template-e2e" },
    operations: [
      {
        kind: "createNode",
        parentId: "root",
        node: {
          id: sourceGroupId,
          type: "group",
          name: "Campaign source",
          visible: true,
          locked: false,
          transform: transform(0, 0, 1080, 1350),
          opacity: 1,
          blendMode: "pass-through",
          children: sourceChildren,
        },
      },
    ],
  });

  await bootstrapStudio(
    page,
    `/project/${templateProjectId}/frame/${templateFrameId}`,
  );
  const frameButton = page.getByRole("button", { name: /Campaign Template/ });
  await expect(frameButton).toContainText("r1");
  await page
    .getByRole("treeitem")
    .filter({ hasText: "Campaign source" })
    .click();
  await page.getByRole("tab", { name: "Brand" }).click();
  await page
    .getByRole("button", { name: "Save selection as template" })
    .click();
  const templateDialog = page.getByRole("dialog", {
    name: "Create canonical template",
  });
  await expect(templateDialog).toBeVisible();
  await templateDialog.getByLabel("Template name").fill("Campaign Continuity");
  await templateDialog
    .getByLabel("Description")
    .fill("A 42-layer agent-human campaign handoff proof.");
  const slotEditors = templateDialog.locator(".template-slot-list select");
  await expect(slotEditors).toHaveCount(41);
  for (const [name, role] of [
    ["Headline", "headline"],
    ["Supporting copy", "supportingCopy"],
    ["Hero image", "heroImage"],
    ["Logo", "logo"],
    ["CTA", "cta"],
    ["Background", "background"],
    ["Badge", "badge"],
    ["Legal copy", "legalCopy"],
  ] as const)
    await templateDialog
      .locator(`select[aria-label="${name} semantic slot"]`)
      .selectOption(role);
  await templateDialog.getByRole("button", { name: "Save template" }).click();
  await expect(page.locator(".feedback-toast")).toContainText(
    "Saved project template",
  );
  await expect(
    page.getByText("Campaign Continuity", { exact: true }),
  ).toBeVisible();

  const projectResponse = await fetch(
    `${descriptor.baseUrl}/api/projects/${templateProjectId}`,
    { headers: runtimeHeaders() },
  );
  const projectDocument = (await projectResponse.json()) as {
    revision: number;
    templates: Array<{
      id: string;
      name: string;
      nodes: Array<Record<string, unknown>>;
      slots: Array<{ role: string; nodeId: string }>;
    }>;
  };
  expect(projectDocument).toMatchObject({ revision: 3 });
  expect(projectDocument.templates).toHaveLength(1);
  expect(projectDocument.templates[0]).toMatchObject({
    name: "Campaign Continuity",
    slots: expect.arrayContaining([
      expect.objectContaining({ role: "headline" }),
      expect.objectContaining({ role: "heroImage" }),
      expect.objectContaining({ role: "legalCopy" }),
    ]),
  });
  expect(projectDocument.templates[0]!.slots).toHaveLength(8);

  await request("/api/transactions", {
    schemaVersion: 1,
    mode: "commit",
    runtimeId: descriptor.runtimeId,
    workspaceId: descriptor.workspaceId,
    scope: {
      kind: "frame",
      projectId: templateProjectId,
      frameId: templateFrameId,
    },
    baseRevision: 1,
    actor: { source: "http", id: "remove-capture-source" },
    operations: [{ kind: "deleteNode", nodeId: sourceGroupId }],
  });
  await expect(frameButton).toContainText("r2");

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["apps/mcp/dist/cli.js", "--descriptor", descriptorPath],
    cwd: process.cwd(),
    stderr: "pipe",
  });
  const mcp = new Client({ name: "template-e2e", version: "1.0.0" });
  await mcp.connect(transport);
  try {
    const tools = await mcp.listTools();
    expect(tools.tools.map((tool) => tool.name)).toEqual(
      expect.arrayContaining([
        "list_project_templates",
        "apply_project_template",
        "detach_project_template",
      ]),
    );
    const listed = await mcp.callTool({
      name: "list_project_templates",
      arguments: { projectId: templateProjectId },
    });
    expect(listed.isError).not.toBe(true);
    expect(listed.structuredContent).toMatchObject({
      result: [expect.objectContaining({ name: "Campaign Continuity" })],
    });
    const preview = await mcp.callTool({
      name: "apply_project_template",
      arguments: {
        projectId: templateProjectId,
        frameId: templateFrameId,
        templateId: projectDocument.templates[0]!.id,
        baseRevision: 2,
        actorId: "campaign-template-agent",
      },
    });
    expect(preview.isError, JSON.stringify(preview.content)).not.toBe(true);
    expect(preview.structuredContent).toMatchObject({ baseRevision: 2 });
    const previewId = String(preview.structuredContent?.previewId);
    expect(previewId).toMatch(/^[0-9a-f-]{36}$/);
    await expect(frameButton).toContainText("r2");
    const committed = await mcp.callTool({
      name: "commit_preview",
      arguments: { previewId },
    });
    expect(committed.isError, JSON.stringify(committed.content)).not.toBe(true);
    expect(committed.structuredContent).toMatchObject({ revision: 3 });
  } finally {
    await mcp.close();
  }
  await expect(frameButton).toContainText("r3");

  type CanonicalNode = {
    id: string;
    name: string;
    type: string;
    text?: string;
    templateInstance?: {
      templateId: string;
      instanceId: string;
      sourceNodeId?: string;
    };
    templateSlot?: { role: string; key: string };
    children?: CanonicalNode[];
  };
  const readCanonical = async (): Promise<{
    revision: number;
    root: { children: CanonicalNode[] };
  }> => {
    const response = await fetch(
      `${descriptor.baseUrl}/api/projects/${templateProjectId}/frames/${templateFrameId}`,
      { headers: runtimeHeaders() },
    );
    expect(response.status).toBe(200);
    return response.json();
  };
  const flatten = (nodes: CanonicalNode[]): CanonicalNode[] =>
    nodes.flatMap((node) => [
      node,
      ...(node.children ? flatten(node.children) : []),
    ]);
  let canonical = await readCanonical();
  let appliedNodes = flatten(canonical.root.children);
  expect(appliedNodes).toHaveLength(42);
  expect(canonical.root.children).toHaveLength(1);
  const headlineBeforeEdit = appliedNodes.find(
    (node) => node.name === "Headline",
  )!;
  expect(headlineBeforeEdit).toMatchObject({
    templateInstance: { templateId: projectDocument.templates[0]!.id },
    templateSlot: { role: "headline", key: "headline" },
  });

  await page.getByRole("treeitem").filter({ hasText: "Headline" }).click();
  await page.getByRole("tab", { name: "Properties" }).click();
  await page.locator("canvas").focus();
  await page.keyboard.press("F2");
  const editor = page.getByRole("textbox", { name: "Text content" });
  await editor.fill("SYSTEMS THAT PRESERVE HUMAN INTENT");
  await page.getByRole("button", { name: "Save text" }).click();
  await expect(frameButton).toContainText("r4");
  canonical = await readCanonical();
  appliedNodes = flatten(canonical.root.children);
  const editedHeadline = appliedNodes.find((node) => node.name === "Headline")!;
  expect(editedHeadline).toMatchObject({
    id: headlineBeforeEdit.id,
    text: "SYSTEMS THAT PRESERVE HUMAN INTENT",
    templateSlot: { role: "headline" },
  });

  await page.getByRole("tab", { name: "Brand" }).click();
  await expect(page.getByText("Semantic slot")).toBeVisible();
  await expect(
    page.getByText("Headline", { exact: true }).last(),
  ).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("phase3-template-studio.png"),
    fullPage: true,
  });
  const previewBeforeDetachResponse = await fetch(
    `${descriptor.baseUrl}/api/projects/${templateProjectId}/frames/${templateFrameId}/render-preview`,
    { method: "POST", headers: runtimeHeaders() },
  );
  expect(previewBeforeDetachResponse.status).toBe(200);
  const previewBeforeDetach = Buffer.from(
    await previewBeforeDetachResponse.arrayBuffer(),
  );
  expect(previewBeforeDetach.length).toBeGreaterThan(10_000);
  await writeFile(
    testInfo.outputPath("phase3-template-render.png"),
    previewBeforeDetach,
  );

  await page.getByRole("button", { name: "Detach instance metadata" }).click();
  await expect(frameButton).toContainText("r5");
  await expect(page.locator(".feedback-toast")).toContainText(
    "Detached template metadata",
  );
  canonical = await readCanonical();
  appliedNodes = flatten(canonical.root.children);
  expect(appliedNodes).toHaveLength(42);
  expect(appliedNodes.map((node) => node.id)).toContain(headlineBeforeEdit.id);
  expect(
    appliedNodes.some((node) => node.templateInstance || node.templateSlot),
  ).toBe(false);
  const previewAfterDetachResponse = await fetch(
    `${descriptor.baseUrl}/api/projects/${templateProjectId}/frames/${templateFrameId}/render-preview`,
    { method: "POST", headers: runtimeHeaders() },
  );
  expect(previewAfterDetachResponse.status).toBe(200);
  expect(Buffer.from(await previewAfterDetachResponse.arrayBuffer())).toEqual(
    previewBeforeDetach,
  );
  const exported = await fetch(
    `${descriptor.baseUrl}/api/projects/${templateProjectId}/frames/${templateFrameId}/export`,
    { method: "POST", headers: runtimeHeaders() },
  );
  const exportResult = (await exported.json()) as {
    path: string;
    width: number;
    height: number;
  };
  expect(exported.status, JSON.stringify(exportResult)).toBe(200);
  expect(exportResult).toMatchObject({ width: 1080, height: 1350 });
  expect(
    await readFile(
      path.join(root, "projects", "template-continuity-e2e", exportResult.path),
    ),
  ).toEqual(previewBeforeDetach);

  await page.reload();
  await expect(frameButton).toContainText("r5");
  await expect(
    page.getByRole("treeitem").filter({ hasText: "Headline" }),
  ).toBeVisible();
  const historyResponse = await fetch(
    `${descriptor.baseUrl}/api/projects/${templateProjectId}/frames/${templateFrameId}/history`,
    { headers: runtimeHeaders() },
  );
  const history = (await historyResponse.json()) as Array<{
    revision: number;
    actor: { source: string; id: string };
    operations: Array<{ kind: string; propertyGroup?: string }>;
  }>;
  expect(
    history
      .filter((entry) => entry.revision >= 2)
      .map((entry) => entry.actor.source),
  ).toEqual(["http", "mcp", "studio", "studio"]);
  expect(
    history
      .find((entry) => entry.revision === 5)
      ?.operations.every(
        (operation) =>
          operation.kind === "updateNode" &&
          operation.propertyGroup === "templateMetadata",
      ),
  ).toBe(true);
});

test("DesignBrief, DesignPlan, reviewed intent compilation, and deterministic visual QA remain canonical and reversible", async ({
  page,
}, testInfo) => {
  test.setTimeout(90_000);
  const briefProjectId = "9c000000-0000-4000-8000-000000000001";
  const briefFrameId = "9c000000-0000-4000-8000-000000000002";
  const headlineNodeId = "9c000000-0000-4000-8000-000000000003";
  const heroNodeId = "9c000000-0000-4000-8000-000000000004";
  const badgeNodeId = "9c000000-0000-4000-8000-000000000005";
  await request("/api/transactions", {
    schemaVersion: 1,
    mode: "commit",
    runtimeId: descriptor.runtimeId,
    workspaceId: descriptor.workspaceId,
    scope: { kind: "workspace" },
    baseRevision: null,
    actor: { source: "system", id: "design-brief-e2e" },
    operations: [
      {
        kind: "createProject",
        projectId: briefProjectId,
        slug: "design-brief-e2e",
        name: "Design Brief E2E",
      },
    ],
  });
  await request("/api/transactions", {
    schemaVersion: 1,
    mode: "commit",
    runtimeId: descriptor.runtimeId,
    workspaceId: descriptor.workspaceId,
    scope: { kind: "project", projectId: briefProjectId },
    baseRevision: 0,
    actor: { source: "system", id: "design-brief-e2e" },
    operations: [
      {
        kind: "createFrame",
        frameId: briefFrameId,
        slug: "campaign-intent",
        name: "Campaign Intent",
        width: 1080,
        height: 1350,
      },
    ],
  });
  await request("/api/transactions", {
    schemaVersion: 1,
    mode: "commit",
    runtimeId: descriptor.runtimeId,
    workspaceId: descriptor.workspaceId,
    scope: {
      kind: "frame",
      projectId: briefProjectId,
      frameId: briefFrameId,
    },
    baseRevision: 0,
    actor: { source: "system", id: "design-plan-fixture" },
    operations: [
      {
        kind: "createNode",
        parentId: "root",
        node: {
          id: headlineNodeId,
          type: "rectangle",
          name: "Approved headline panel",
          visible: true,
          locked: false,
          transform: {
            x: 120,
            y: 180,
            width: 640,
            height: 180,
            rotation: 0,
            scaleX: 1,
            scaleY: 1,
            skewX: 0,
            skewY: 0,
            anchorX: 0,
            anchorY: 0,
          },
          opacity: 1,
          blendMode: "normal",
          fill: { type: "solid", color: "#1F2937", opacity: 1 },
          cornerRadius: {
            topLeft: 24,
            topRight: 24,
            bottomRight: 24,
            bottomLeft: 24,
          },
        },
      },
      {
        kind: "createNode",
        parentId: "root",
        node: {
          id: badgeNodeId,
          type: "rectangle",
          name: "Badge panel",
          visible: true,
          locked: false,
          transform: {
            x: 820,
            y: 180,
            width: 140,
            height: 80,
            rotation: 0,
            scaleX: 1,
            scaleY: 1,
            skewX: 0,
            skewY: 0,
            anchorX: 0,
            anchorY: 0,
          },
          opacity: 1,
          blendMode: "normal",
          fill: { type: "solid", color: "#F0A24A", opacity: 1 },
          cornerRadius: {
            topLeft: 40,
            topRight: 40,
            bottomRight: 40,
            bottomLeft: 40,
          },
        },
      },
      {
        kind: "createNode",
        parentId: "root",
        node: {
          id: heroNodeId,
          type: "rectangle",
          name: "Hero subject panel",
          visible: true,
          locked: false,
          transform: {
            x: 240,
            y: 520,
            width: 600,
            height: 520,
            rotation: 0,
            scaleX: 1,
            scaleY: 1,
            skewX: 0,
            skewY: 0,
            anchorX: 0,
            anchorY: 0,
          },
          opacity: 1,
          blendMode: "normal",
          fill: { type: "solid", color: "#315CF5", opacity: 1 },
          cornerRadius: {
            topLeft: 36,
            topRight: 36,
            bottomRight: 36,
            bottomLeft: 36,
          },
        },
      },
    ],
  });
  const render = async (): Promise<Buffer> => {
    const response = await fetch(
      `${descriptor.baseUrl}/api/projects/${briefProjectId}/frames/${briefFrameId}/render-preview`,
      { method: "POST", headers: runtimeHeaders() },
    );
    expect(response.status).toBe(200);
    return Buffer.from(await response.arrayBuffer());
  };
  const renderBefore = await render();
  await bootstrapStudio(
    page,
    `/project/${briefProjectId}/frame/${briefFrameId}`,
  );
  const frameButton = page.getByRole("button", { name: /Campaign Intent/ });
  await expect(frameButton).toContainText("r1");
  await page.getByRole("tab", { name: "Brand" }).click();
  await expect(
    page.getByText("No agent-authored design briefs yet."),
  ).toBeVisible();

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["apps/mcp/dist/cli.js", "--descriptor", descriptorPath],
    cwd: process.cwd(),
    stderr: "pipe",
  });
  const mcp = new Client({ name: "design-brief-e2e", version: "1.0.0" });
  await mcp.connect(transport);
  let briefId: string;
  try {
    const tools = await mcp.listTools();
    expect(tools.tools.map((tool) => tool.name)).toEqual(
      expect.arrayContaining([
        "list_design_briefs",
        "create_design_brief",
        "remove_design_brief",
      ]),
    );
    const briefInput = {
      name: "Canonical Campaign Launch",
      objective:
        "Explain trustworthy agent-human continuity to design leaders.",
      audience: {
        primary: "Design leaders",
        secondary: ["Creative operations teams"],
        locale: "en-US",
        context: "Fast-scrolling professional social feed",
      },
      format: {
        width: 1080,
        height: 1350,
        unit: "px",
        channel: "socialPost",
      },
      requiredCopy: [
        {
          id: "9c000000-0000-4000-8000-000000000010",
          role: "headline",
          text: "Preserve human intent",
        },
      ],
      optionalCopy: [
        {
          id: "9c000000-0000-4000-8000-000000000011",
          role: "body",
          text: "Agents propose. Humans refine.",
        },
      ],
      brandContext: {
        description: "Use the pinned graphite and cobalt identity.",
        requiredTokenKeys: ["brand.graphite", "brand.cobalt"],
        prohibitedUses: ["Unapproved logo distortion"],
      },
      assetRequirements: [
        {
          id: "9c000000-0000-4000-8000-000000000012",
          role: "heroSubject",
          description: "A clear collaborative-system visual.",
          required: true,
        },
      ],
      hierarchyRequirements: [
        {
          id: "9c000000-0000-4000-8000-000000000013",
          role: "headline",
          priority: 1,
          description: "Headline is the first read.",
        },
      ],
      mood: {
        keywords: ["precise", "trustworthy", "editorial"],
        avoid: ["generic AI glow"],
        notes: "Calm authority with visible structure.",
      },
      constraints: [
        {
          id: "9c000000-0000-4000-8000-000000000014",
          priority: "must",
          description: "Preserve approved copy exactly.",
        },
      ],
      accessibilityRequirements: {
        minimumContrastRatio: 4.5,
        requirements: ["Keep important content outside the edge safety zone"],
        readingOrder: ["headline", "body", "cta", "legalCopy"],
      },
      exportRequirements: [
        {
          id: "9c000000-0000-4000-8000-000000000015",
          name: "Campaign PNG",
          format: "png",
          scale: 1,
          transparentBackground: "forbidden",
        },
      ],
    };
    const preview = await mcp.callTool({
      name: "create_design_brief",
      arguments: {
        projectId: briefProjectId,
        baseRevision: 1,
        actorId: "campaign-brief-agent",
        ...briefInput,
      },
    });
    expect(preview.isError, JSON.stringify(preview.content)).not.toBe(true);
    const previewContent = preview.structuredContent as {
      brief: { id: string; name: string };
      transaction: { previewId: string; baseRevision: number };
    };
    briefId = previewContent.brief.id;
    expect(previewContent).toMatchObject({
      brief: { name: "Canonical Campaign Launch" },
      transaction: { baseRevision: 1 },
    });
    let projectResponse = await fetch(
      `${descriptor.baseUrl}/api/projects/${briefProjectId}`,
      { headers: runtimeHeaders() },
    );
    let projectDocument = (await projectResponse.json()) as {
      revision: number;
      designBriefs?: Array<{ id: string }>;
    };
    expect(projectDocument).toMatchObject({ revision: 1, designBriefs: [] });
    const committed = await mcp.callTool({
      name: "commit_preview",
      arguments: { previewId: previewContent.transaction.previewId },
    });
    expect(committed.isError, JSON.stringify(committed.content)).not.toBe(true);
    expect(committed.structuredContent).toMatchObject({
      revision: 2,
      actor: { source: "mcp" },
    });
    await expect(
      page.getByText("Canonical Campaign Launch", { exact: true }),
    ).toBeVisible();
    expect(await render()).toEqual(renderBefore);

    const invalid = await mcp.callTool({
      name: "create_design_brief",
      arguments: {
        projectId: briefProjectId,
        baseRevision: 2,
        ...briefInput,
        name: "Impossible JPEG",
        exportRequirements: [
          {
            id: "9c000000-0000-4000-8000-000000000016",
            name: "Impossible JPEG",
            format: "jpeg",
            scale: 1,
            transparentBackground: "required",
          },
        ],
      },
    });
    expect(invalid.isError).toBe(true);
    expect(JSON.stringify(invalid.content)).toContain(
      "JPEG cannot require a transparent background",
    );
    projectResponse = await fetch(
      `${descriptor.baseUrl}/api/projects/${briefProjectId}`,
      { headers: runtimeHeaders() },
    );
    projectDocument = await projectResponse.json();
    expect(projectDocument.revision).toBe(2);

    const listed = await mcp.callTool({
      name: "list_design_briefs",
      arguments: { projectId: briefProjectId },
    });
    expect(listed.isError).not.toBe(true);
    expect(listed.structuredContent).toMatchObject({
      result: [
        expect.objectContaining({
          id: briefId,
          name: "Canonical Campaign Launch",
        }),
      ],
    });
    const removePreview = await mcp.callTool({
      name: "remove_design_brief",
      arguments: {
        projectId: briefProjectId,
        briefId,
        baseRevision: 2,
        actorId: "campaign-brief-agent",
      },
    });
    expect(removePreview.isError).not.toBe(true);
    expect(removePreview.structuredContent).toMatchObject({ baseRevision: 2 });
    const removed = await mcp.callTool({
      name: "commit_preview",
      arguments: {
        previewId: String(removePreview.structuredContent?.previewId),
      },
    });
    expect(removed.isError).not.toBe(true);
    expect(removed.structuredContent).toMatchObject({ revision: 3 });
  } finally {
    await mcp.close();
  }

  await expect(
    page.getByText("No agent-authored design briefs yet."),
  ).toBeVisible();
  await request("/api/transactions", {
    schemaVersion: 1,
    mode: "commit",
    runtimeId: descriptor.runtimeId,
    workspaceId: descriptor.workspaceId,
    scope: { kind: "project", projectId: briefProjectId },
    baseRevision: 3,
    actor: { source: "http", id: "brief-reviewer" },
    operations: [{ kind: "undo" }],
  });
  await expect(
    page.getByText("Canonical Campaign Launch", { exact: true }),
  ).toBeVisible();
  await page.getByText("Canonical Campaign Launch", { exact: true }).click();
  await expect(page.getByText("Preserve human intent")).toBeVisible();
  await expect(page.getByText("Agents propose. Humans refine.")).toBeVisible();
  await expect(page.getByText(/Required tokens: brand.graphite/)).toBeVisible();
  await expect(
    page.getByText("A clear collaborative-system visual."),
  ).toBeVisible();
  await expect(page.getByText(/Reading order: headline → body/)).toBeVisible();
  await expect(page.getByText(/transparency forbidden/)).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("phase4-design-brief-studio.png"),
    fullPage: true,
  });
  expect(await render()).toEqual(renderBefore);
  const projectResponse = await fetch(
    `${descriptor.baseUrl}/api/projects/${briefProjectId}`,
    { headers: runtimeHeaders() },
  );
  const projectDocument = (await projectResponse.json()) as {
    revision: number;
    designBriefs: Array<{ id: string; objective: string }>;
  };
  expect(projectDocument).toMatchObject({
    revision: 4,
    designBriefs: [
      {
        id: briefId,
        objective:
          "Explain trustworthy agent-human continuity to design leaders.",
      },
    ],
  });
  const planTransport = new StdioClientTransport({
    command: process.execPath,
    args: ["apps/mcp/dist/cli.js", "--descriptor", descriptorPath],
    cwd: process.cwd(),
    stderr: "pipe",
  });
  const planMcp = new Client({ name: "design-plan-e2e", version: "1.0.0" });
  await planMcp.connect(planTransport);
  let planId: string;
  const headlineRoleId = "9c000000-0000-4000-8000-000000000020";
  const heroRoleId = "9c000000-0000-4000-8000-000000000021";
  const badgeRoleId = "9c000000-0000-4000-8000-000000000034";
  const regionId = "9c000000-0000-4000-8000-000000000022";
  try {
    const tools = await planMcp.listTools();
    expect(tools.tools.map((tool) => tool.name)).toEqual(
      expect.arrayContaining([
        "list_design_plans",
        "create_design_plan",
        "remove_design_plan",
        "preview_design_plan",
        "audit_visual_quality",
        "inspect_design_plan",
        "inspect_design_roles",
        "assign_semantic_role",
        "apply_layout_system",
        "reflow_content",
      ]),
    );
    const planInput = {
      name: "Canonical Campaign Plan",
      briefId,
      targetFrameId: briefFrameId,
      objectiveSummary:
        "Translate approved campaign intent into an inspectable role and layout system.",
      semanticRoles: [
        {
          id: headlineRoleId,
          key: "headline",
          name: "Approved headline",
          role: "headline",
          required: true,
          nodeId: headlineNodeId,
          copyItemId: "9c000000-0000-4000-8000-000000000010",
        },
        {
          id: heroRoleId,
          key: "heroSubject",
          name: "Hero subject",
          role: "heroSubject",
          required: true,
          nodeId: heroNodeId,
        },
        {
          id: badgeRoleId,
          key: "badge",
          name: "Campaign badge",
          role: "badge",
          required: false,
        },
      ],
      contentHierarchy: [
        {
          id: "9c000000-0000-4000-8000-000000000023",
          roleId: headlineRoleId,
          priority: 1,
        },
        {
          id: "9c000000-0000-4000-8000-000000000024",
          roleId: heroRoleId,
          parentRoleId: headlineRoleId,
          priority: 2,
        },
      ],
      layoutRegions: [
        {
          id: regionId,
          key: "primary",
          name: "Primary content",
          x: 0.08,
          y: 0.08,
          width: 0.84,
          height: 0.84,
        },
      ],
      anchors: [
        {
          id: "9c000000-0000-4000-8000-000000000025",
          roleId: headlineRoleId,
          regionId,
          horizontal: "start",
          vertical: "end",
          offsetX: 0,
          offsetY: -0.04,
        },
        {
          id: "9c000000-0000-4000-8000-000000000033",
          roleId: heroRoleId,
          regionId,
          horizontal: "end",
          vertical: "start",
          offsetX: -0.02,
          offsetY: 0.02,
        },
      ],
      constraints: [
        {
          id: "9c000000-0000-4000-8000-000000000026",
          kind: "preserve",
          priority: "must",
          description: "Preserve approved headline copy exactly.",
          roleId: headlineRoleId,
        },
      ],
      safeAreas: [
        {
          id: "9c000000-0000-4000-8000-000000000027",
          name: "Platform safety",
          top: 0.05,
          right: 0.05,
          bottom: 0.05,
          left: 0.05,
          regionId,
        },
      ],
      brandBindings: [
        {
          id: "9c000000-0000-4000-8000-000000000028",
          roleId: headlineRoleId,
          property: "textColor",
          tokenKey: "brand.cobalt",
        },
      ],
      assetAssignments: [],
      effectIntentions: [
        {
          id: "9c000000-0000-4000-8000-000000000029",
          roleId: headlineRoleId,
          effectType: "outerShadow",
          enabled: true,
          description: "Use a restrained depth cue.",
        },
      ],
      variantRules: [
        {
          id: "9c000000-0000-4000-8000-000000000030",
          name: "Thumbnail variant",
          description: "Reflow the headline and resize the hero for 16:9.",
          format: {
            width: 1280,
            height: 720,
            channel: "youtubeThumbnail",
          },
          roleBehaviors: [
            { roleId: headlineRoleId, behavior: "reflow" },
            { roleId: heroRoleId, behavior: "resize" },
          ],
        },
      ],
      protectedDecisions: [
        {
          id: "9c000000-0000-4000-8000-000000000031",
          kind: "position",
          description: "Human-approved headline position cannot be changed.",
          roleId: headlineRoleId,
        },
      ],
      approval: {
        state: "proposed",
        notes: ["Ready for human planning review."],
      },
    };
    const preview = await planMcp.callTool({
      name: "create_design_plan",
      arguments: {
        projectId: briefProjectId,
        baseRevision: 4,
        actorId: "campaign-plan-agent",
        ...planInput,
      },
    });
    expect(preview.isError, JSON.stringify(preview.content)).not.toBe(true);
    const previewContent = preview.structuredContent as {
      plan: { id: string; name: string };
      transaction: { previewId: string; baseRevision: number };
    };
    planId = previewContent.plan.id;
    expect(previewContent).toMatchObject({
      plan: { name: "Canonical Campaign Plan" },
      transaction: { baseRevision: 4 },
    });
    const beforeCommit = await fetch(
      `${descriptor.baseUrl}/api/projects/${briefProjectId}`,
      { headers: runtimeHeaders() },
    );
    expect(await beforeCommit.json()).toMatchObject({
      revision: 4,
      designPlans: [],
    });
    const committed = await planMcp.callTool({
      name: "commit_preview",
      arguments: { previewId: previewContent.transaction.previewId },
    });
    expect(committed.isError).not.toBe(true);
    expect(committed.structuredContent).toMatchObject({
      revision: 5,
      actor: { source: "mcp" },
    });
    await expect(
      page.getByText("Canonical Campaign Plan", { exact: true }),
    ).toBeVisible();
    expect(await render()).toEqual(renderBefore);

    const invalid = await planMcp.callTool({
      name: "create_design_plan",
      arguments: {
        projectId: briefProjectId,
        baseRevision: 5,
        ...planInput,
        name: "Broken plan",
        anchors: [
          {
            ...planInput.anchors[0],
            id: "9c000000-0000-4000-8000-000000000032",
            roleId: "9c000000-0000-4000-8000-000000000099",
          },
        ],
      },
    });
    expect(invalid.isError).toBe(true);
    expect(JSON.stringify(invalid.content)).toContain("missing semantic role");
    const afterInvalid = await fetch(
      `${descriptor.baseUrl}/api/projects/${briefProjectId}`,
      { headers: runtimeHeaders() },
    );
    expect(await afterInvalid.json()).toMatchObject({ revision: 5 });

    const listed = await planMcp.callTool({
      name: "list_design_plans",
      arguments: { projectId: briefProjectId },
    });
    expect(listed.isError).not.toBe(true);
    expect(listed.structuredContent).toMatchObject({
      result: [
        expect.objectContaining({
          id: planId,
          name: "Canonical Campaign Plan",
        }),
      ],
    });
    const inspectedPlan = await planMcp.callTool({
      name: "inspect_design_plan",
      arguments: { projectId: briefProjectId, planId },
    });
    expect(inspectedPlan.isError).not.toBe(true);
    expect(inspectedPlan.structuredContent).toMatchObject({
      id: planId,
      name: "Canonical Campaign Plan",
      semanticRoles: expect.arrayContaining([
        expect.objectContaining({ id: badgeRoleId, key: "badge" }),
      ]),
    });
    const inspectedRoles = await planMcp.callTool({
      name: "inspect_design_roles",
      arguments: { projectId: briefProjectId, planId },
    });
    expect(inspectedRoles.isError).not.toBe(true);
    expect(inspectedRoles.structuredContent).toMatchObject({
      planId,
      targetFrameId: briefFrameId,
      targetFrameRevision: 1,
      summary: {
        total: 3,
        bound: 2,
        unbound: 1,
        missing: 0,
        requiredMissing: 0,
      },
      roles: expect.arrayContaining([
        expect.objectContaining({
          id: badgeRoleId,
          bindingStatus: "unbound",
        }),
      ]),
    });
    const layoutPreview = await planMcp.callTool({
      name: "apply_layout_system",
      arguments: {
        projectId: briefProjectId,
        frameId: briefFrameId,
        planId,
        baseRevision: 1,
        actorId: "layout-system-agent",
      },
    });
    expect(
      layoutPreview.isError,
      JSON.stringify(layoutPreview.content),
    ).not.toBe(true);
    expect(layoutPreview.structuredContent).toMatchObject({
      compilation: {
        planId,
        frameId: briefFrameId,
        baseRevision: 1,
        selectedRoleIds: [headlineRoleId, heroRoleId, badgeRoleId],
        operations: [
          {
            kind: "updateNode",
            nodeId: heroNodeId,
            propertyGroup: "transform",
            value: { x: 372, y: 135 },
          },
        ],
        warnings: expect.arrayContaining([
          expect.objectContaining({ code: "PLAN_NOT_APPROVED" }),
          expect.objectContaining({ code: "PROTECTED_DECISION" }),
          expect.objectContaining({ code: "UNSUPPORTED_INTENT" }),
        ]),
      },
      preview: { baseRevision: 1 },
    });
    const reflowPreview = await planMcp.callTool({
      name: "reflow_content",
      arguments: {
        projectId: briefProjectId,
        frameId: briefFrameId,
        planId,
        baseRevision: 1,
        roleIds: [heroRoleId],
        actorId: "content-reflow-agent",
      },
    });
    expect(
      reflowPreview.isError,
      JSON.stringify(reflowPreview.content),
    ).not.toBe(true);
    expect(reflowPreview.structuredContent).toMatchObject({
      compilation: {
        selectedRoleIds: [heroRoleId],
        operations: [
          {
            kind: "updateNode",
            nodeId: heroNodeId,
            propertyGroup: "transform",
            value: { x: 372, y: 135 },
          },
        ],
      },
      preview: { baseRevision: 1 },
    });
    expect(await render()).toEqual(renderBefore);
    const assignmentPreview = await planMcp.callTool({
      name: "assign_semantic_role",
      arguments: {
        projectId: briefProjectId,
        planId,
        roleId: badgeRoleId,
        nodeId: badgeNodeId,
        baseRevision: 5,
        actorId: "semantic-role-agent",
      },
    });
    expect(
      assignmentPreview.isError,
      JSON.stringify(assignmentPreview.content),
    ).not.toBe(true);
    expect(assignmentPreview.structuredContent).toMatchObject({
      plan: {
        id: planId,
        approval: { state: "draft" },
        semanticRoles: expect.arrayContaining([
          expect.objectContaining({ id: badgeRoleId, nodeId: badgeNodeId }),
        ]),
      },
      inspection: {
        summary: { total: 3, bound: 3, unbound: 0 },
      },
      transaction: { baseRevision: 5 },
    });
    const projectAfterAssignmentPreview = (await (
      await fetch(`${descriptor.baseUrl}/api/projects/${briefProjectId}`, {
        headers: runtimeHeaders(),
      })
    ).json()) as {
      revision: number;
      designPlans: Array<{
        id: string;
        approval: { state: string };
        semanticRoles: Array<{ id: string; nodeId?: string }>;
      }>;
    };
    expect(projectAfterAssignmentPreview.revision).toBe(5);
    const persistedPlan = projectAfterAssignmentPreview.designPlans.find(
      (candidate) => candidate.id === planId,
    );
    expect(persistedPlan?.approval.state).toBe("proposed");
    expect(
      persistedPlan?.semanticRoles.find((role) => role.id === badgeRoleId),
    ).not.toHaveProperty("nodeId");
    const auditRenderBefore = await render();
    const audited = await planMcp.callTool({
      name: "audit_visual_quality",
      arguments: {
        projectId: briefProjectId,
        frameId: briefFrameId,
        planId,
      },
    });
    expect(audited.isError, JSON.stringify(audited.content)).not.toBe(true);
    expect(audited.structuredContent).toMatchObject({
      schemaVersion: 1,
      projectId: briefProjectId,
      frameId: briefFrameId,
      frameRevision: 1,
      planId,
      briefId,
      classification: "deterministic",
      summary: { errors: 1 },
      findings: [
        expect.objectContaining({
          classification: "deterministic",
          code: "MISSING_REQUIRED_COPY",
          severity: "error",
          nodeIds: [headlineNodeId],
          roleIds: [headlineRoleId],
        }),
      ],
      unevaluated: [
        expect.objectContaining({ category: "heuristic" }),
        expect.objectContaining({ category: "modelJudged" }),
      ],
    });
    expect(await render()).toEqual(auditRenderBefore);
    expect(
      await (
        await fetch(
          `${descriptor.baseUrl}/api/projects/${briefProjectId}/frames/${briefFrameId}`,
          { headers: runtimeHeaders() },
        )
      ).json(),
    ).toMatchObject({ revision: 1 });
    expect(
      await (
        await fetch(`${descriptor.baseUrl}/api/projects/${briefProjectId}`, {
          headers: runtimeHeaders(),
        })
      ).json(),
    ).toMatchObject({ revision: 5 });
    const compiled = await planMcp.callTool({
      name: "preview_design_plan",
      arguments: {
        projectId: briefProjectId,
        frameId: briefFrameId,
        planId,
        baseRevision: 1,
        roleIds: [headlineRoleId, heroRoleId],
        actorId: "campaign-plan-agent",
      },
    });
    expect(compiled.isError, JSON.stringify(compiled.content)).not.toBe(true);
    expect(compiled.structuredContent).toMatchObject({
      compilation: {
        planId,
        frameId: briefFrameId,
        baseRevision: 1,
        selectedRoleIds: [headlineRoleId, heroRoleId],
        operations: [
          {
            kind: "updateNode",
            nodeId: heroNodeId,
            propertyGroup: "transform",
            value: { x: 372, y: 135 },
          },
        ],
        warnings: expect.arrayContaining([
          expect.objectContaining({ code: "PLAN_NOT_APPROVED" }),
          expect.objectContaining({ code: "PROTECTED_DECISION" }),
          expect.objectContaining({ code: "BRAND_KIT_UNAVAILABLE" }),
          expect.objectContaining({ code: "UNSUPPORTED_INTENT" }),
        ]),
      },
      preview: {
        baseRevision: 1,
      },
    });
    expect(await render()).toEqual(renderBefore);
    const removePreview = await planMcp.callTool({
      name: "remove_design_plan",
      arguments: {
        projectId: briefProjectId,
        planId,
        baseRevision: 5,
        actorId: "campaign-plan-agent",
      },
    });
    expect(removePreview.isError).not.toBe(true);
    const removed = await planMcp.callTool({
      name: "commit_preview",
      arguments: {
        previewId: String(removePreview.structuredContent?.previewId),
      },
    });
    expect(removed.isError).not.toBe(true);
    expect(removed.structuredContent).toMatchObject({ revision: 6 });
  } finally {
    await planMcp.close();
  }
  await expect(
    page.getByText("No agent-authored design plans yet."),
  ).toBeVisible();
  await request("/api/transactions", {
    schemaVersion: 1,
    mode: "commit",
    runtimeId: descriptor.runtimeId,
    workspaceId: descriptor.workspaceId,
    scope: { kind: "project", projectId: briefProjectId },
    baseRevision: 6,
    actor: { source: "http", id: "plan-reviewer" },
    operations: [{ kind: "undo" }],
  });
  await expect(
    page.getByText("Canonical Campaign Plan", { exact: true }),
  ).toBeVisible();
  await page.getByText("Canonical Campaign Plan", { exact: true }).click();
  await expect(
    page.getByText("Approved headline", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText(/Primary content · x 0.08/)).toBeVisible();
  await expect(page.getByText(/textColor →/)).toBeVisible();
  await expect(
    page.getByText("Human-approved headline position cannot be changed."),
  ).toBeVisible();
  await expect(
    page.getByText("proposed", { exact: true }).last(),
  ).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("phase4-design-plan-studio.png"),
    fullPage: true,
  });
  expect(await render()).toEqual(renderBefore);
  await page.getByRole("button", { name: "Inspect role bindings" }).click();
  await expect(page.getByText("2/3 bound")).toBeVisible();
  await expect(page.getByText(/badge unbound/)).toBeVisible();
  await page.getByRole("treeitem", { name: /Badge panel/ }).click();
  const assignBadge = page.getByRole("button", {
    name: "Assign selected node to Campaign badge",
  });
  await assignBadge.click();
  await expect(page.getByText("Review role assignment")).toBeVisible();
  await expect(page.getByText(/Approval returns to draft/)).toBeVisible();
  expect(await render()).toEqual(renderBefore);
  await page.getByRole("button", { name: "Discard role assignment" }).click();
  await assignBadge.click();
  await page.getByRole("button", { name: "Commit role assignment" }).click();
  await expect(
    page.getByText("Canonical Campaign Plan", { exact: true }),
  ).toBeVisible();
  await expect
    .poll(async () => {
      const response = await fetch(
        `${descriptor.baseUrl}/api/projects/${briefProjectId}`,
        { headers: runtimeHeaders() },
      );
      return ((await response.json()) as { revision: number }).revision;
    })
    .toBe(8);
  const assignedProjectResponse = await fetch(
    `${descriptor.baseUrl}/api/projects/${briefProjectId}`,
    { headers: runtimeHeaders() },
  );
  expect(await assignedProjectResponse.json()).toMatchObject({
    revision: 8,
    designPlans: [
      {
        id: planId,
        approval: { state: "draft" },
        semanticRoles: expect.arrayContaining([
          expect.objectContaining({ id: badgeRoleId, nodeId: badgeNodeId }),
        ]),
      },
    ],
  });
  expect(await render()).toEqual(renderBefore);
  const planSummary = page.getByText("Canonical Campaign Plan", {
    exact: true,
  });
  const layoutButton = page.getByRole("button", {
    name: "Preview layout system",
  });
  if (!(await layoutButton.isVisible())) await planSummary.click();
  await page
    .getByRole("button", { name: "Run deterministic visual QA" })
    .click();
  await expect(
    page.getByText("Deterministic visual QA", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("MISSING_REQUIRED_COPY")).toBeVisible();
  await expect(
    page.getByText(
      /Heuristic and model-judged checks are listed as unevaluated/,
    ),
  ).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("phase4-deterministic-visual-qa.png"),
    fullPage: true,
  });
  expect(await render()).toEqual(renderBefore);
  await layoutButton.click();
  await expect(page.getByText("1 ordinary operation")).toBeVisible();
  await expect(
    page.getByText(/Applied anchor for “Hero subject”/),
  ).toBeVisible();
  await expect(page.getByText("PLAN_NOT_APPROVED")).toBeVisible();
  await expect(page.getByText("PROTECTED_DECISION")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Commit reviewed preview" }),
  ).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("phase4-layout-system-preview.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "Discard preview" }).click();
  expect(await render()).toEqual(renderBefore);
  await page.getByRole("treeitem", { name: /Hero subject panel/ }).click();
  const reflowButton = page.getByRole("button", {
    name: "Reflow selected roles",
  });
  await reflowButton.click();
  await expect(page.getByText("1 ordinary operation")).toBeVisible();
  await expect(
    page.getByText(/Applied anchor for “Hero subject”/),
  ).toBeVisible();
  await page.getByRole("button", { name: "Discard preview" }).click();
  expect(await render()).toEqual(renderBefore);
  await reflowButton.click();
  await page.getByRole("button", { name: "Commit reviewed preview" }).click();
  await expect(frameButton).toContainText("r2");
  const renderAfterCompilation = await render();
  expect(renderAfterCompilation).not.toEqual(renderBefore);
  const compiledFrameResponse = await fetch(
    `${descriptor.baseUrl}/api/projects/${briefProjectId}/frames/${briefFrameId}`,
    { headers: runtimeHeaders() },
  );
  const compiledFrame = (await compiledFrameResponse.json()) as {
    revision: number;
    root: {
      children: Array<{
        id: string;
        transform: { x: number; y: number };
      }>;
    };
  };
  expect(compiledFrame).toMatchObject({
    revision: 2,
    root: {
      children: expect.arrayContaining([
        expect.objectContaining({
          id: headlineNodeId,
          transform: expect.objectContaining({ x: 120, y: 180 }),
        }),
        expect.objectContaining({
          id: heroNodeId,
          transform: expect.objectContaining({ x: 372, y: 135 }),
        }),
      ]),
    },
  });
  const staleCompilation = await fetch(
    `${descriptor.baseUrl}/api/projects/${briefProjectId}/frames/${briefFrameId}/design-plans/${planId}/reflow/preview`,
    {
      method: "POST",
      headers: { ...runtimeHeaders(), "content-type": "application/json" },
      body: JSON.stringify({
        baseRevision: 1,
        actor: { source: "studio", id: "spoofed-studio" },
        roleIds: [heroRoleId],
      }),
    },
  );
  expect(staleCompilation.status).toBe(409);
  expect(await staleCompilation.json()).toMatchObject({
    error: { code: "STALE_REVISION" },
  });
  const afterPlanUndo = await fetch(
    `${descriptor.baseUrl}/api/projects/${briefProjectId}`,
    { headers: runtimeHeaders() },
  );
  expect(await afterPlanUndo.json()).toMatchObject({
    revision: 8,
    designPlans: [
      {
        id: planId,
        name: "Canonical Campaign Plan",
        approval: { state: "draft" },
      },
    ],
  });
  const historyLines = (
    await readFile(
      path.join(
        root,
        "projects",
        "design-brief-e2e",
        "history",
        "operations.jsonl",
      ),
      "utf8",
    )
  )
    .trim()
    .split("\n")
    .map(
      (line) =>
        JSON.parse(line) as {
          scope: string;
          revision: number;
          actor: { source: string };
          operations: Array<{ kind: string }>;
          inverseOperations: Array<{ kind: string }>;
        },
    )
    .filter((entry) => entry.scope === "project" && entry.revision >= 2);
  expect(historyLines.map((entry) => entry.actor.source)).toEqual([
    "mcp",
    "mcp",
    "http",
    "mcp",
    "mcp",
    "http",
    "studio",
  ]);
  expect(historyLines[0]).toMatchObject({
    operations: [{ kind: "setDesignBrief" }],
    inverseOperations: [{ kind: "removeDesignBrief" }],
  });
  expect(historyLines[1]).toMatchObject({
    operations: [{ kind: "removeDesignBrief" }],
    inverseOperations: [{ kind: "setDesignBrief" }],
  });
  expect(historyLines[2]).toMatchObject({
    operations: [{ kind: "setDesignBrief" }],
  });
  expect(historyLines[3]).toMatchObject({
    operations: [{ kind: "setDesignPlan" }],
    inverseOperations: [{ kind: "removeDesignPlan" }],
  });
  expect(historyLines[4]).toMatchObject({
    operations: [{ kind: "removeDesignPlan" }],
    inverseOperations: [{ kind: "setDesignPlan" }],
  });
  expect(historyLines[5]).toMatchObject({
    operations: [{ kind: "setDesignPlan" }],
  });
  expect(historyLines[6]).toMatchObject({
    operations: [{ kind: "setDesignPlan" }],
    inverseOperations: [{ kind: "setDesignPlan" }],
  });
  const frameHistory = (
    await readFile(
      path.join(
        root,
        "projects",
        "design-brief-e2e",
        "history",
        "operations.jsonl",
      ),
      "utf8",
    )
  )
    .trim()
    .split("\n")
    .map(
      (line) =>
        JSON.parse(line) as {
          scope: string;
          frameId?: string;
          revision: number;
          actor: { source: string };
          operations: Array<{ kind: string; nodeId?: string }>;
        },
    )
    .filter(
      (entry) => entry.scope === "frame" && entry.frameId === briefFrameId,
    );
  expect(frameHistory.at(-1)).toMatchObject({
    revision: 2,
    actor: { source: "studio" },
    operations: [{ kind: "updateNode", nodeId: heroNodeId }],
  });
});

test("Plan-declared role asset replacement previews, commits, and reverses canonically", async ({
  page,
}) => {
  test.setTimeout(60_000);
  const assetProjectId = "9d000000-0000-4000-8000-000000000001";
  const assetFrameId = "9d000000-0000-4000-8000-000000000002";
  const assetNodeId = "9d000000-0000-4000-8000-000000000003";
  const unrelatedNodeId = "9d000000-0000-4000-8000-000000000004";
  const planId = "9d000000-0000-4000-8000-000000000005";
  const roleId = "9d000000-0000-4000-8000-000000000006";
  await request("/api/transactions", {
    schemaVersion: 1,
    mode: "commit",
    runtimeId: descriptor.runtimeId,
    workspaceId: descriptor.workspaceId,
    scope: { kind: "workspace" },
    baseRevision: null,
    actor: { source: "system", id: "role-asset-e2e" },
    operations: [
      {
        kind: "createProject",
        projectId: assetProjectId,
        slug: "role-asset-e2e",
        name: "Role Asset E2E",
      },
    ],
  });
  const assetSharp = runtimeRequire("sharp") as (input: Buffer) => {
    png: () => { toBuffer: () => Promise<Buffer> };
  };
  const sourceBytes = await assetSharp(
    Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480"><rect width="640" height="480" fill="#315cf5"/><circle cx="200" cy="240" r="120" fill="#ffffff"/></svg>',
    ),
  )
    .png()
    .toBuffer();
  const replacementBytes = await assetSharp(
    Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600"><rect width="800" height="600" fill="#101820"/><circle cx="560" cy="300" r="150" fill="#f0a24a"/></svg>',
    ),
  )
    .png()
    .toBuffer();
  const importAsset = async (
    baseRevision: number,
    filename: string,
    bytes: Buffer,
  ): Promise<{ id: string }> => {
    const form = new FormData();
    form.set("baseRevision", String(baseRevision));
    form.set("file", new File([bytes], filename, { type: "image/png" }));
    const response = await fetch(
      `${descriptor.baseUrl}/api/projects/${assetProjectId}/assets/import`,
      { method: "POST", headers: runtimeHeaders(), body: form },
    );
    const result = (await response.json()) as { asset: { id: string } };
    expect(response.status, JSON.stringify(result)).toBe(200);
    return result.asset;
  };
  const sourceAsset = await importAsset(0, "role-source.png", sourceBytes);
  const replacementAsset = await importAsset(
    1,
    "role-replacement.png",
    replacementBytes,
  );
  await request("/api/transactions", {
    schemaVersion: 1,
    mode: "commit",
    runtimeId: descriptor.runtimeId,
    workspaceId: descriptor.workspaceId,
    scope: { kind: "project", projectId: assetProjectId },
    baseRevision: 2,
    actor: { source: "http", id: "role-asset-fixture" },
    operations: [
      {
        kind: "createFrame",
        frameId: assetFrameId,
        slug: "role-asset",
        name: "Role Asset",
        width: 1080,
        height: 1350,
      },
    ],
  });
  await request("/api/transactions", {
    schemaVersion: 1,
    mode: "commit",
    runtimeId: descriptor.runtimeId,
    workspaceId: descriptor.workspaceId,
    scope: {
      kind: "frame",
      projectId: assetProjectId,
      frameId: assetFrameId,
    },
    baseRevision: 0,
    actor: { source: "http", id: "role-asset-fixture" },
    operations: [
      {
        kind: "createNode",
        parentId: "root",
        node: {
          id: assetNodeId,
          type: "rasterImage",
          name: "Hero image",
          visible: true,
          locked: false,
          transform: {
            x: 140,
            y: 180,
            width: 800,
            height: 700,
            rotation: 0,
            scaleX: 1,
            scaleY: 1,
            skewX: 0,
            skewY: 0,
            anchorX: 0,
            anchorY: 0,
          },
          opacity: 1,
          blendMode: "normal",
          assetId: sourceAsset.id,
          fit: "contain",
          crop: { x: 0.1, y: 0.1, width: 0.8, height: 0.8 },
        },
      },
      {
        kind: "createNode",
        parentId: "root",
        node: {
          id: unrelatedNodeId,
          type: "rectangle",
          name: "Unrelated panel",
          visible: true,
          locked: false,
          transform: {
            x: 60,
            y: 1080,
            width: 960,
            height: 120,
            rotation: 0,
            scaleX: 1,
            scaleY: 1,
            skewX: 0,
            skewY: 0,
            anchorX: 0,
            anchorY: 0,
          },
          opacity: 1,
          blendMode: "normal",
          fill: { type: "solid", color: "#f4f5f8", opacity: 1 },
          cornerRadius: {
            topLeft: 24,
            topRight: 24,
            bottomRight: 24,
            bottomLeft: 24,
          },
        },
      },
    ],
  });
  await request("/api/transactions", {
    schemaVersion: 1,
    mode: "commit",
    runtimeId: descriptor.runtimeId,
    workspaceId: descriptor.workspaceId,
    scope: { kind: "project", projectId: assetProjectId },
    baseRevision: 3,
    actor: { source: "http", id: "role-asset-planner" },
    operations: [
      {
        kind: "setDesignPlan",
        plan: {
          id: planId,
          name: "Hero Replacement Plan",
          targetFrameId: assetFrameId,
          objectiveSummary: "Apply the exact approved hero replacement.",
          semanticRoles: [
            {
              id: roleId,
              key: "hero",
              name: "Hero subject",
              role: "heroSubject",
              required: true,
              nodeId: assetNodeId,
            },
          ],
          contentHierarchy: [],
          layoutRegions: [],
          anchors: [],
          constraints: [],
          safeAreas: [],
          brandBindings: [],
          assetAssignments: [
            {
              id: "9d000000-0000-4000-8000-000000000007",
              roleId,
              assetId: replacementAsset.id,
              fit: "cover",
              preserveCrop: false,
            },
          ],
          effectIntentions: [],
          variantRules: [],
          protectedDecisions: [],
          approval: {
            state: "approved",
            notes: ["Replacement approved."],
            decidedBy: "human-reviewer",
            decidedAt: "2026-08-10T23:30:00.000Z",
          },
          createdAt: "2026-08-10T23:30:00.000Z",
          updatedAt: "2026-08-10T23:30:00.000Z",
        },
      },
    ],
  });
  const render = async (): Promise<Buffer> => {
    const response = await fetch(
      `${descriptor.baseUrl}/api/projects/${assetProjectId}/frames/${assetFrameId}/render-preview`,
      { method: "POST", headers: runtimeHeaders() },
    );
    expect(response.status).toBe(200);
    return Buffer.from(await response.arrayBuffer());
  };
  const before = await render();
  await bootstrapStudio(
    page,
    `/project/${assetProjectId}/frame/${assetFrameId}`,
  );
  await page.getByRole("tab", { name: "Brand" }).click();
  await page.getByText("Hero Replacement Plan", { exact: true }).click();

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["apps/mcp/dist/cli.js", "--descriptor", descriptorPath],
    cwd: process.cwd(),
    stderr: "pipe",
  });
  const mcp = new Client({ name: "role-asset-e2e", version: "1.0.0" });
  await mcp.connect(transport);
  try {
    expect((await mcp.listTools()).tools.map((tool) => tool.name)).toContain(
      "replace_role_asset",
    );
    const preview = await mcp.callTool({
      name: "replace_role_asset",
      arguments: {
        projectId: assetProjectId,
        frameId: assetFrameId,
        planId,
        roleId,
        baseRevision: 1,
        actorId: "role-asset-agent",
      },
    });
    expect(preview.isError, JSON.stringify(preview.content)).not.toBe(true);
    expect(preview.structuredContent).toMatchObject({
      compilation: {
        selectedRoleIds: [roleId],
        operations: [
          {
            kind: "replaceAsset",
            nodeId: assetNodeId,
            assetId: replacementAsset.id,
            fit: "cover",
          },
          {
            kind: "updateNode",
            nodeId: assetNodeId,
            propertyGroup: "crop",
            value: { crop: null },
          },
        ],
      },
      preview: { baseRevision: 1 },
    });
    expect(await render()).toEqual(before);
  } finally {
    await mcp.close();
  }

  const studioAction = page.getByRole("button", {
    name: "Preview declared asset for Hero subject",
  });
  await studioAction.click();
  await expect(page.getByText("2 ordinary operations")).toBeVisible();
  await expect(
    page.getByText(/Applied declared asset assignment/),
  ).toBeVisible();
  await expect(page.getByText(/Reset crop/)).toBeVisible();
  await page.getByRole("button", { name: "Discard preview" }).click();
  expect(await render()).toEqual(before);
  await studioAction.click();
  await page.getByRole("button", { name: "Commit reviewed preview" }).click();
  await expect(page.getByRole("button", { name: /Role Asset/ })).toContainText(
    "r2",
  );
  const after = await render();
  expect(after).not.toEqual(before);
  const frame = (await (
    await fetch(
      `${descriptor.baseUrl}/api/projects/${assetProjectId}/frames/${assetFrameId}`,
      { headers: runtimeHeaders() },
    )
  ).json()) as {
    revision: number;
    root: { children: Array<Record<string, unknown>> };
  };
  expect(frame).toMatchObject({
    revision: 2,
    root: {
      children: expect.arrayContaining([
        expect.objectContaining({
          id: assetNodeId,
          assetId: replacementAsset.id,
          fit: "cover",
        }),
        expect.objectContaining({
          id: unrelatedNodeId,
          name: "Unrelated panel",
        }),
      ]),
    },
  });
  expect(
    frame.root.children.find((node) => node.id === assetNodeId),
  ).not.toHaveProperty("crop");
  const stale = await fetch(
    `${descriptor.baseUrl}/api/projects/${assetProjectId}/frames/${assetFrameId}/design-plans/${planId}/roles/${roleId}/asset/preview`,
    {
      method: "POST",
      headers: { ...runtimeHeaders(), "content-type": "application/json" },
      body: JSON.stringify({
        baseRevision: 1,
        actor: { source: "http", id: "stale-role-asset" },
      }),
    },
  );
  expect(stale.status).toBe(409);
  await request("/api/transactions", {
    schemaVersion: 1,
    mode: "commit",
    runtimeId: descriptor.runtimeId,
    workspaceId: descriptor.workspaceId,
    scope: {
      kind: "frame",
      projectId: assetProjectId,
      frameId: assetFrameId,
    },
    baseRevision: 2,
    actor: { source: "http", id: "role-asset-reviewer" },
    operations: [{ kind: "undo" }],
  });
  expect(await render()).toEqual(before);
});

test("Plan-declared Brand bindings use the exact pinned revision and reverse canonically", async ({
  page,
}) => {
  test.setTimeout(60_000);
  const brandProjectId = "9e000000-0000-4000-8000-000000000001";
  const brandFrameId = "9e000000-0000-4000-8000-000000000002";
  const brandNodeId = "9e000000-0000-4000-8000-000000000003";
  const unrelatedNodeId = "9e000000-0000-4000-8000-000000000004";
  const planId = "9e000000-0000-4000-8000-000000000005";
  const roleId = "9e000000-0000-4000-8000-000000000006";
  await request("/api/transactions", {
    schemaVersion: 1,
    mode: "commit",
    runtimeId: descriptor.runtimeId,
    workspaceId: descriptor.workspaceId,
    scope: { kind: "workspace" },
    baseRevision: null,
    actor: { source: "system", id: "brand-binding-e2e" },
    operations: [
      {
        kind: "createProject",
        projectId: brandProjectId,
        slug: "brand-binding-e2e",
        name: "Brand Binding E2E",
      },
    ],
  });
  await request("/api/transactions", {
    schemaVersion: 1,
    mode: "commit",
    runtimeId: descriptor.runtimeId,
    workspaceId: descriptor.workspaceId,
    scope: { kind: "project", projectId: brandProjectId },
    baseRevision: 0,
    actor: { source: "http", id: "brand-binding-fixture" },
    operations: [
      {
        kind: "createFrame",
        frameId: brandFrameId,
        slug: "brand-binding",
        name: "Brand Binding",
        width: 1080,
        height: 1350,
      },
    ],
  });
  await request("/api/transactions", {
    schemaVersion: 1,
    mode: "commit",
    runtimeId: descriptor.runtimeId,
    workspaceId: descriptor.workspaceId,
    scope: {
      kind: "frame",
      projectId: brandProjectId,
      frameId: brandFrameId,
    },
    baseRevision: 0,
    actor: { source: "http", id: "brand-binding-fixture" },
    operations: [
      {
        kind: "createNode",
        parentId: "root",
        node: {
          id: brandNodeId,
          type: "rectangle",
          name: "Campaign panel",
          visible: true,
          locked: false,
          transform: {
            x: 140,
            y: 180,
            width: 800,
            height: 760,
            rotation: 0,
            scaleX: 1,
            scaleY: 1,
            skewX: 0,
            skewY: 0,
            anchorX: 0,
            anchorY: 0,
          },
          opacity: 1,
          blendMode: "normal",
          fill: { type: "solid", color: "#f4f5f8", opacity: 1 },
          stroke: {
            enabled: true,
            width: 18,
            alignment: "inside",
            opacity: 0.7,
            paint: { type: "solid", color: "#20242a", opacity: 0.8 },
          },
          cornerRadius: {
            topLeft: 48,
            topRight: 48,
            bottomRight: 48,
            bottomLeft: 48,
          },
        },
      },
      {
        kind: "createNode",
        parentId: "root",
        node: {
          id: unrelatedNodeId,
          type: "rectangle",
          name: "Unrelated footer",
          visible: true,
          locked: false,
          transform: {
            x: 140,
            y: 1040,
            width: 800,
            height: 120,
            rotation: 0,
            scaleX: 1,
            scaleY: 1,
            skewX: 0,
            skewY: 0,
            anchorX: 0,
            anchorY: 0,
          },
          opacity: 1,
          blendMode: "normal",
          fill: { type: "solid", color: "#101820", opacity: 1 },
          cornerRadius: {
            topLeft: 20,
            topRight: 20,
            bottomRight: 20,
            bottomLeft: 20,
          },
        },
      },
    ],
  });
  const pinnedKit = (await request("/api/brand-kits", {
    name: "Plan Brand System",
    sourceProjectId: brandProjectId,
    provenance: "Verified Brand-binding E2E fixture",
    licenseNotes: "Internal E2E fixture",
    palette: [{ key: "accent", name: "Accent", color: "#315CF5" }],
    typeRoles: [],
    logos: [],
    definitions: [],
    actor: { source: "http", id: "brand-binding-planner" },
  })) as { id: string; revision: number; contentHash: string };
  await request(`/api/projects/${brandProjectId}/brand-kit/pin`, {
    kitId: pinnedKit.id,
    revision: pinnedKit.revision,
    baseRevision: 1,
    mode: "commit",
    actor: { source: "http", id: "brand-binding-planner" },
  });
  const newerKit = (await request("/api/brand-kits", {
    kitId: pinnedKit.id,
    name: "Plan Brand System",
    sourceProjectId: brandProjectId,
    provenance: "Verified Brand-binding E2E fixture",
    licenseNotes: "Internal E2E fixture",
    palette: [{ key: "accent", name: "Accent", color: "#FF6B35" }],
    typeRoles: [],
    logos: [],
    definitions: [],
    actor: { source: "http", id: "brand-binding-planner" },
  })) as { revision: number };
  expect(newerKit.revision).toBe(pinnedKit.revision + 1);
  await request("/api/transactions", {
    schemaVersion: 1,
    mode: "commit",
    runtimeId: descriptor.runtimeId,
    workspaceId: descriptor.workspaceId,
    scope: { kind: "project", projectId: brandProjectId },
    baseRevision: 2,
    actor: { source: "http", id: "brand-binding-planner" },
    operations: [
      {
        kind: "setDesignPlan",
        plan: {
          id: planId,
          name: "Campaign Brand Plan",
          targetFrameId: brandFrameId,
          objectiveSummary: "Apply the exact pinned campaign palette.",
          semanticRoles: [
            {
              id: roleId,
              key: "background",
              name: "Campaign background",
              role: "background",
              required: true,
              nodeId: brandNodeId,
            },
          ],
          contentHierarchy: [],
          layoutRegions: [],
          anchors: [],
          constraints: [],
          safeAreas: [],
          brandBindings: [
            {
              id: "9e000000-0000-4000-8000-000000000007",
              roleId,
              property: "fill",
              tokenKey: "accent",
            },
            {
              id: "9e000000-0000-4000-8000-000000000008",
              roleId,
              property: "stroke",
              tokenKey: "accent",
            },
          ],
          assetAssignments: [],
          effectIntentions: [],
          variantRules: [],
          protectedDecisions: [],
          approval: {
            state: "approved",
            notes: ["Pinned palette approved."],
            decidedBy: "human-reviewer",
            decidedAt: "2026-08-10T23:50:00.000Z",
          },
          createdAt: "2026-08-10T23:50:00.000Z",
          updatedAt: "2026-08-10T23:50:00.000Z",
        },
      },
    ],
  });
  const render = async (): Promise<Buffer> => {
    const response = await fetch(
      `${descriptor.baseUrl}/api/projects/${brandProjectId}/frames/${brandFrameId}/render-preview`,
      { method: "POST", headers: runtimeHeaders() },
    );
    expect(response.status).toBe(200);
    return Buffer.from(await response.arrayBuffer());
  };
  const before = await render();
  await bootstrapStudio(
    page,
    `/project/${brandProjectId}/frame/${brandFrameId}`,
  );
  await page.getByRole("tab", { name: "Brand" }).click();
  await page.getByText("Campaign Brand Plan", { exact: true }).click();

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["apps/mcp/dist/cli.js", "--descriptor", descriptorPath],
    cwd: process.cwd(),
    stderr: "pipe",
  });
  const mcp = new Client({ name: "brand-binding-e2e", version: "1.0.0" });
  await mcp.connect(transport);
  try {
    expect((await mcp.listTools()).tools.map((tool) => tool.name)).toContain(
      "bind_brand_tokens",
    );
    const preview = await mcp.callTool({
      name: "bind_brand_tokens",
      arguments: {
        projectId: brandProjectId,
        frameId: brandFrameId,
        planId,
        baseRevision: 1,
        roleIds: [roleId],
        actorId: "brand-binding-agent",
      },
    });
    expect(preview.isError, JSON.stringify(preview.content)).not.toBe(true);
    expect(preview.structuredContent).toMatchObject({
      compilation: {
        selectedRoleIds: [roleId],
        operations: [
          {
            kind: "updateNode",
            nodeId: brandNodeId,
            propertyGroup: "fill",
            value: {
              fill: { type: "solid", color: "#315CF5", opacity: 1 },
            },
          },
          {
            kind: "updateNode",
            nodeId: brandNodeId,
            propertyGroup: "stroke",
            value: {
              stroke: {
                paint: { type: "solid", color: "#315CF5", opacity: 1 },
              },
            },
          },
        ],
      },
      preview: { baseRevision: 1 },
    });
    expect(await render()).toEqual(before);
  } finally {
    await mcp.close();
  }

  const studioAction = page.getByRole("button", {
    name: "Preview declared Brand bindings for Campaign Brand Plan",
  });
  await studioAction.click();
  await expect(page.getByText("2 ordinary operations")).toBeVisible();
  await expect(page.getByText(/Applied fill token accent/)).toBeVisible();
  await expect(page.getByText(/Applied stroke token accent/)).toBeVisible();
  await page.getByRole("button", { name: "Discard preview" }).click();
  expect(await render()).toEqual(before);
  await studioAction.click();
  await page.getByRole("button", { name: "Commit reviewed preview" }).click();
  await expect(
    page.getByRole("button", { name: /Brand Binding/ }),
  ).toContainText("r2");
  const after = await render();
  expect(after).not.toEqual(before);
  const frame = (await (
    await fetch(
      `${descriptor.baseUrl}/api/projects/${brandProjectId}/frames/${brandFrameId}`,
      { headers: runtimeHeaders() },
    )
  ).json()) as {
    revision: number;
    root: { children: Array<Record<string, unknown>> };
  };
  expect(frame.revision).toBe(2);
  expect(
    frame.root.children.find((node) => node.id === brandNodeId),
  ).toMatchObject({
    id: brandNodeId,
    fill: { type: "solid", color: "#315CF5", opacity: 1 },
    stroke: {
      width: 18,
      alignment: "inside",
      opacity: 0.7,
      paint: { type: "solid", color: "#315CF5", opacity: 1 },
    },
  });
  expect(
    frame.root.children.find((node) => node.id === unrelatedNodeId),
  ).toMatchObject({
    id: unrelatedNodeId,
    name: "Unrelated footer",
    fill: { type: "solid", color: "#101820", opacity: 1 },
  });
  const project = (await (
    await fetch(`${descriptor.baseUrl}/api/projects/${brandProjectId}`, {
      headers: runtimeHeaders(),
    })
  ).json()) as {
    brandKitPin: { kitId: string; revision: number; contentHash: string };
  };
  expect(project.brandKitPin).toMatchObject({
    kitId: pinnedKit.id,
    revision: pinnedKit.revision,
    contentHash: pinnedKit.contentHash,
  });
  const history = (await (
    await fetch(
      `${descriptor.baseUrl}/api/projects/${brandProjectId}/frames/${brandFrameId}/history`,
      { headers: runtimeHeaders() },
    )
  ).json()) as Array<{
    revision: number;
    actor: { source: string; id: string };
  }>;
  expect(history.find((entry) => entry.revision === 2)?.actor).toMatchObject({
    source: "studio",
  });
  const stale = await fetch(
    `${descriptor.baseUrl}/api/projects/${brandProjectId}/frames/${brandFrameId}/design-plans/${planId}/brand-bindings/preview`,
    {
      method: "POST",
      headers: { ...runtimeHeaders(), "content-type": "application/json" },
      body: JSON.stringify({
        baseRevision: 1,
        actor: { source: "http", id: "stale-brand-binding" },
      }),
    },
  );
  expect(stale.status).toBe(409);
  await request("/api/transactions", {
    schemaVersion: 1,
    mode: "commit",
    runtimeId: descriptor.runtimeId,
    workspaceId: descriptor.workspaceId,
    scope: {
      kind: "frame",
      projectId: brandProjectId,
      frameId: brandFrameId,
    },
    baseRevision: 2,
    actor: { source: "http", id: "brand-binding-reviewer" },
    operations: [{ kind: "undo" }],
  });
  expect(await render()).toEqual(before);
});

test("Plan-declared variants reflow, resize, and hide without partial format changes", async ({
  page,
}) => {
  test.setTimeout(60_000);
  const variantProjectId = "9f000000-0000-4000-8000-000000000001";
  const variantFrameId = "9f000000-0000-4000-8000-000000000002";
  const headlineNodeId = "9f000000-0000-4000-8000-000000000003";
  const badgeNodeId = "9f000000-0000-4000-8000-000000000004";
  const heroNodeId = "9f000000-0000-4000-8000-000000000005";
  const unrelatedNodeId = "9f000000-0000-4000-8000-000000000006";
  const planId = "9f000000-0000-4000-8000-000000000007";
  const headlineRoleId = "9f000000-0000-4000-8000-000000000008";
  const badgeRoleId = "9f000000-0000-4000-8000-000000000009";
  const heroRoleId = "9f000000-0000-4000-8000-00000000000a";
  const variantRuleId = "9f000000-0000-4000-8000-00000000000b";
  const formatVariantRuleId = "9f000000-0000-4000-8000-00000000000c";
  const regionId = "9f000000-0000-4000-8000-00000000000d";
  const rectangle = (
    id: string,
    name: string,
    x: number,
    y: number,
    width: number,
    height: number,
    color: string,
  ) => ({
    id,
    type: "rectangle",
    name,
    visible: true,
    locked: false,
    transform: {
      x,
      y,
      width,
      height,
      rotation: 0,
      scaleX: 1,
      scaleY: 1,
      skewX: 0,
      skewY: 0,
      anchorX: 0,
      anchorY: 0,
    },
    opacity: 1,
    blendMode: "normal",
    fill: { type: "solid", color, opacity: 1 },
    cornerRadius: {
      topLeft: 16,
      topRight: 16,
      bottomRight: 16,
      bottomLeft: 16,
    },
  });
  await request("/api/transactions", {
    schemaVersion: 1,
    mode: "commit",
    runtimeId: descriptor.runtimeId,
    workspaceId: descriptor.workspaceId,
    scope: { kind: "workspace" },
    baseRevision: null,
    actor: { source: "system", id: "variant-e2e" },
    operations: [
      {
        kind: "createProject",
        projectId: variantProjectId,
        slug: "variant-e2e",
        name: "Variant E2E",
      },
    ],
  });
  await request("/api/transactions", {
    schemaVersion: 1,
    mode: "commit",
    runtimeId: descriptor.runtimeId,
    workspaceId: descriptor.workspaceId,
    scope: { kind: "project", projectId: variantProjectId },
    baseRevision: 0,
    actor: { source: "http", id: "variant-fixture" },
    operations: [
      {
        kind: "createFrame",
        frameId: variantFrameId,
        slug: "variant",
        name: "Variant Frame",
        width: 1000,
        height: 800,
      },
    ],
  });
  await request("/api/transactions", {
    schemaVersion: 1,
    mode: "commit",
    runtimeId: descriptor.runtimeId,
    workspaceId: descriptor.workspaceId,
    scope: {
      kind: "frame",
      projectId: variantProjectId,
      frameId: variantFrameId,
    },
    baseRevision: 0,
    actor: { source: "http", id: "variant-fixture" },
    operations: [
      {
        kind: "createNode",
        parentId: "root",
        node: rectangle(
          headlineNodeId,
          "Headline block",
          50,
          40,
          300,
          100,
          "#315CF5",
        ),
      },
      {
        kind: "createNode",
        parentId: "root",
        node: rectangle(badgeNodeId, "Badge", 700, 600, 120, 80, "#F0A24A"),
      },
      {
        kind: "createNode",
        parentId: "root",
        node: rectangle(heroNodeId, "Hero", 200, 250, 600, 300, "#101820"),
      },
      {
        kind: "createNode",
        parentId: "root",
        node: rectangle(
          unrelatedNodeId,
          "Unrelated legal",
          800,
          740,
          160,
          40,
          "#E6E8EC",
        ),
      },
    ],
  });
  await request("/api/transactions", {
    schemaVersion: 1,
    mode: "commit",
    runtimeId: descriptor.runtimeId,
    workspaceId: descriptor.workspaceId,
    scope: { kind: "project", projectId: variantProjectId },
    baseRevision: 1,
    actor: { source: "http", id: "variant-planner" },
    operations: [
      {
        kind: "setDesignPlan",
        plan: {
          id: planId,
          name: "Campaign Variant Plan",
          targetFrameId: variantFrameId,
          objectiveSummary: "Apply exact same-format variant behavior.",
          semanticRoles: [
            {
              id: headlineRoleId,
              key: "headline",
              name: "Headline",
              role: "headline",
              required: true,
              nodeId: headlineNodeId,
            },
            {
              id: badgeRoleId,
              key: "badge",
              name: "Badge",
              role: "badge",
              required: false,
              nodeId: badgeNodeId,
            },
            {
              id: heroRoleId,
              key: "hero",
              name: "Hero",
              role: "heroSubject",
              required: true,
              nodeId: heroNodeId,
            },
          ],
          contentHierarchy: [],
          layoutRegions: [
            {
              id: regionId,
              key: "primary",
              name: "Primary",
              x: 0.1,
              y: 0.1,
              width: 0.6,
              height: 0.4,
            },
          ],
          anchors: [
            {
              id: "9f000000-0000-4000-8000-00000000000e",
              roleId: headlineRoleId,
              regionId,
              horizontal: "center",
              vertical: "center",
              offsetX: 0,
              offsetY: 0,
            },
            {
              id: "9f000000-0000-4000-8000-00000000000f",
              roleId: badgeRoleId,
              horizontal: "stretch",
              vertical: "end",
              offsetX: 0.1,
              offsetY: -0.05,
            },
          ],
          constraints: [],
          safeAreas: [],
          brandBindings: [],
          assetAssignments: [],
          effectIntentions: [],
          variantRules: [
            {
              id: variantRuleId,
              name: "Compact campaign",
              description: "Reflow headline, resize badge, hide hero.",
              format: {
                width: 1000,
                height: 800,
                channel: "promotionalCard",
              },
              roleBehaviors: [
                { roleId: headlineRoleId, behavior: "reflow" },
                { roleId: badgeRoleId, behavior: "resize" },
                { roleId: heroRoleId, behavior: "hide" },
              ],
            },
            {
              id: formatVariantRuleId,
              name: "Portrait campaign",
              description: "Requires explicit frame resize first.",
              format: {
                width: 1080,
                height: 1350,
                channel: "socialPost",
              },
              roleBehaviors: [{ roleId: heroRoleId, behavior: "hide" }],
            },
          ],
          protectedDecisions: [],
          approval: {
            state: "approved",
            notes: ["Same-format variant approved."],
            decidedBy: "human-reviewer",
            decidedAt: "2026-08-11T00:20:00.000Z",
          },
          createdAt: "2026-08-11T00:20:00.000Z",
          updatedAt: "2026-08-11T00:20:00.000Z",
        },
      },
    ],
  });
  const render = async (): Promise<Buffer> => {
    const response = await fetch(
      `${descriptor.baseUrl}/api/projects/${variantProjectId}/frames/${variantFrameId}/render-preview`,
      { method: "POST", headers: runtimeHeaders() },
    );
    expect(response.status).toBe(200);
    return Buffer.from(await response.arrayBuffer());
  };
  const before = await render();
  const formatPreview = await fetch(
    `${descriptor.baseUrl}/api/projects/${variantProjectId}/frames/${variantFrameId}/design-plans/${planId}/variants/${formatVariantRuleId}/preview`,
    {
      method: "POST",
      headers: { ...runtimeHeaders(), "content-type": "application/json" },
      body: JSON.stringify({
        baseRevision: 1,
        actor: { source: "http", id: "format-variant-review" },
      }),
    },
  );
  expect(formatPreview.status).toBe(200);
  expect(await formatPreview.json()).toMatchObject({
    compilation: {
      operations: [],
      warnings: [
        expect.objectContaining({
          code: "UNSUPPORTED_INTENT",
          message: expect.stringContaining("no partial variant"),
        }),
      ],
    },
    preview: null,
  });
  expect(await render()).toEqual(before);

  await bootstrapStudio(
    page,
    `/project/${variantProjectId}/frame/${variantFrameId}`,
  );
  await page.getByRole("tab", { name: "Brand" }).click();
  await page.getByText("Campaign Variant Plan", { exact: true }).click();
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["apps/mcp/dist/cli.js", "--descriptor", descriptorPath],
    cwd: process.cwd(),
    stderr: "pipe",
  });
  const mcp = new Client({ name: "variant-e2e", version: "1.0.0" });
  await mcp.connect(transport);
  try {
    expect((await mcp.listTools()).tools.map((tool) => tool.name)).toContain(
      "create_design_variants",
    );
    const preview = await mcp.callTool({
      name: "create_design_variants",
      arguments: {
        projectId: variantProjectId,
        frameId: variantFrameId,
        planId,
        variantRuleId,
        baseRevision: 1,
        actorId: "variant-agent",
      },
    });
    expect(preview.isError, JSON.stringify(preview.content)).not.toBe(true);
    expect(preview.structuredContent).toMatchObject({
      compilation: {
        selectedRoleIds: [headlineRoleId, badgeRoleId, heroRoleId],
        operations: [
          expect.objectContaining({
            kind: "updateNode",
            nodeId: headlineNodeId,
            propertyGroup: "transform",
          }),
          expect.objectContaining({
            kind: "updateNode",
            nodeId: badgeNodeId,
            propertyGroup: "transform",
          }),
          {
            kind: "updateNode",
            nodeId: heroNodeId,
            propertyGroup: "visibility",
            value: { visible: false },
          },
        ],
      },
      preview: { baseRevision: 1 },
    });
    expect(await render()).toEqual(before);
  } finally {
    await mcp.close();
  }

  const studioAction = page.getByRole("button", {
    name: "Preview variant Compact campaign",
  });
  await studioAction.click();
  await expect(page.getByText("3 ordinary operations")).toBeVisible();
  await expect(page.getByText(/Applied reflow behavior/)).toBeVisible();
  await expect(page.getByText(/Applied resize behavior/)).toBeVisible();
  await expect(page.getByText(/Hid “Hero”/)).toBeVisible();
  await page.getByRole("button", { name: "Discard preview" }).click();
  expect(await render()).toEqual(before);
  await studioAction.click();
  await page.getByRole("button", { name: "Commit reviewed preview" }).click();
  await expect(
    page.getByRole("button", { name: /Variant Frame/ }),
  ).toContainText("r2");
  const after = await render();
  expect(after).not.toEqual(before);
  const frame = (await (
    await fetch(
      `${descriptor.baseUrl}/api/projects/${variantProjectId}/frames/${variantFrameId}`,
      { headers: runtimeHeaders() },
    )
  ).json()) as {
    revision: number;
    root: {
      children: Array<{
        id: string;
        name: string;
        visible: boolean;
        transform: {
          x: number;
          y: number;
          width: number;
          height: number;
        };
      }>;
    };
  };
  expect(frame.revision).toBe(2);
  expect(
    frame.root.children.find((node) => node.id === headlineNodeId)?.transform,
  ).toMatchObject({ x: 250, y: 190, width: 300, height: 100 });
  expect(
    frame.root.children.find((node) => node.id === badgeNodeId)?.transform,
  ).toMatchObject({ x: 100, y: 680, width: 800, height: 80 });
  expect(
    frame.root.children.find((node) => node.id === heroNodeId),
  ).toMatchObject({ id: heroNodeId, visible: false });
  expect(
    frame.root.children.find((node) => node.id === unrelatedNodeId),
  ).toMatchObject({
    id: unrelatedNodeId,
    name: "Unrelated legal",
    transform: { x: 800, y: 740, width: 160, height: 40 },
  });
  const stale = await fetch(
    `${descriptor.baseUrl}/api/projects/${variantProjectId}/frames/${variantFrameId}/design-plans/${planId}/variants/${variantRuleId}/preview`,
    {
      method: "POST",
      headers: { ...runtimeHeaders(), "content-type": "application/json" },
      body: JSON.stringify({
        baseRevision: 1,
        actor: { source: "http", id: "stale-variant" },
      }),
    },
  );
  expect(stale.status).toBe(409);
  await request("/api/transactions", {
    schemaVersion: 1,
    mode: "commit",
    runtimeId: descriptor.runtimeId,
    workspaceId: descriptor.workspaceId,
    scope: {
      kind: "frame",
      projectId: variantProjectId,
      frameId: variantFrameId,
    },
    baseRevision: 2,
    actor: { source: "http", id: "variant-reviewer" },
    operations: [{ kind: "undo" }],
  });
  expect(await render()).toEqual(before);
});

test("proposal tools explain, render, and commit the exact canonical preview", async ({
  page,
}) => {
  test.setTimeout(60_000);
  const proposalProjectId = "a0000000-0000-4000-8000-000000000001";
  const proposalFrameId = "a0000000-0000-4000-8000-000000000002";
  const nodeId = "a0000000-0000-4000-8000-000000000003";
  const planId = "a0000000-0000-4000-8000-000000000004";
  const roleId = "a0000000-0000-4000-8000-000000000005";
  const regionId = "a0000000-0000-4000-8000-000000000006";
  await request("/api/transactions", {
    schemaVersion: 1,
    mode: "commit",
    runtimeId: descriptor.runtimeId,
    workspaceId: descriptor.workspaceId,
    scope: { kind: "workspace" },
    baseRevision: null,
    actor: { source: "system", id: "proposal-e2e" },
    operations: [
      {
        kind: "createProject",
        projectId: proposalProjectId,
        slug: "proposal-e2e",
        name: "Proposal E2E",
      },
    ],
  });
  await request("/api/transactions", {
    schemaVersion: 1,
    mode: "commit",
    runtimeId: descriptor.runtimeId,
    workspaceId: descriptor.workspaceId,
    scope: { kind: "project", projectId: proposalProjectId },
    baseRevision: 0,
    actor: { source: "http", id: "proposal-fixture" },
    operations: [
      {
        kind: "createFrame",
        frameId: proposalFrameId,
        slug: "proposal",
        name: "Proposal Frame",
        width: 600,
        height: 400,
      },
    ],
  });
  await request("/api/transactions", {
    schemaVersion: 1,
    mode: "commit",
    runtimeId: descriptor.runtimeId,
    workspaceId: descriptor.workspaceId,
    scope: {
      kind: "frame",
      projectId: proposalProjectId,
      frameId: proposalFrameId,
    },
    baseRevision: 0,
    actor: { source: "http", id: "proposal-fixture" },
    operations: [
      {
        kind: "createNode",
        parentId: "root",
        node: {
          id: nodeId,
          type: "rectangle",
          name: "Proposal subject",
          visible: true,
          locked: false,
          transform: {
            x: 40,
            y: 50,
            width: 100,
            height: 80,
            rotation: 0,
            scaleX: 1,
            scaleY: 1,
            skewX: 0,
            skewY: 0,
            anchorX: 0,
            anchorY: 0,
          },
          opacity: 1,
          blendMode: "normal",
          fill: { type: "solid", color: "#315CF5", opacity: 1 },
          cornerRadius: {
            topLeft: 12,
            topRight: 12,
            bottomRight: 12,
            bottomLeft: 12,
          },
        },
      },
    ],
  });
  await request("/api/transactions", {
    schemaVersion: 1,
    mode: "commit",
    runtimeId: descriptor.runtimeId,
    workspaceId: descriptor.workspaceId,
    scope: { kind: "project", projectId: proposalProjectId },
    baseRevision: 1,
    actor: { source: "http", id: "proposal-planner" },
    operations: [
      {
        kind: "setDesignPlan",
        plan: {
          id: planId,
          name: "Proposal Review Plan",
          targetFrameId: proposalFrameId,
          objectiveSummary: "Move the declared subject to its approved region.",
          semanticRoles: [
            {
              id: roleId,
              key: "subject",
              name: "Subject",
              role: "supportingGraphic",
              required: true,
              nodeId,
            },
          ],
          contentHierarchy: [],
          layoutRegions: [
            {
              id: regionId,
              key: "approved-region",
              name: "Approved region",
              x: 0.5,
              y: 0.25,
              width: 0.25,
              height: 0.25,
            },
          ],
          anchors: [
            {
              id: "a0000000-0000-4000-8000-000000000007",
              roleId,
              regionId,
              horizontal: "start",
              vertical: "start",
              offsetX: 0,
              offsetY: 0,
            },
          ],
          constraints: [],
          safeAreas: [],
          brandBindings: [],
          assetAssignments: [],
          effectIntentions: [],
          variantRules: [],
          protectedDecisions: [],
          approval: {
            state: "approved",
            notes: ["Layout reviewed."],
            decidedBy: "human-reviewer",
            decidedAt: "2026-08-11T01:00:00.000Z",
          },
          createdAt: "2026-08-11T01:00:00.000Z",
          updatedAt: "2026-08-11T01:00:00.000Z",
        },
      },
    ],
  });
  const render = async (): Promise<Buffer> => {
    const response = await fetch(
      `${descriptor.baseUrl}/api/projects/${proposalProjectId}/frames/${proposalFrameId}/render-preview`,
      { method: "POST", headers: runtimeHeaders() },
    );
    expect(response.status).toBe(200);
    return Buffer.from(await response.arrayBuffer());
  };
  const before = await render();
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["apps/mcp/dist/cli.js", "--descriptor", descriptorPath],
    cwd: process.cwd(),
    stderr: "pipe",
  });
  const mcp = new Client({ name: "proposal-e2e", version: "1.0.0" });
  await mcp.connect(transport);
  try {
    const names = (await mcp.listTools()).tools.map((tool) => tool.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "explain_proposed_changes",
        "preview_proposal",
        "commit_proposal",
      ]),
    );
    const compiled = await mcp.callTool({
      name: "preview_design_plan",
      arguments: {
        projectId: proposalProjectId,
        frameId: proposalFrameId,
        planId,
        baseRevision: 1,
        actorId: "proposal-agent",
      },
    });
    expect(compiled.isError, JSON.stringify(compiled.content)).not.toBe(true);
    const preview = compiled.structuredContent as {
      preview: { previewId: string; operationHash: string };
    };
    expect(await render()).toEqual(before);
    const explained = await mcp.callTool({
      name: "explain_proposed_changes",
      arguments: { previewId: preview.preview.previewId },
    });
    expect(explained.isError, JSON.stringify(explained.content)).not.toBe(true);
    expect(explained.structuredContent).toMatchObject({
      proposalId: preview.preview.previewId,
      previewId: preview.preview.previewId,
      operationHash: preview.preview.operationHash,
      author: { source: "mcp" },
      operations: [
        expect.objectContaining({
          kind: "updateNode",
          nodeId,
          propertyGroup: "transform",
        }),
      ],
      explanations: expect.arrayContaining([
        expect.stringContaining("/transform/x"),
      ]),
    });
    const reviewed = await mcp.callTool({
      name: "preview_proposal",
      arguments: { previewId: preview.preview.previewId },
    });
    expect(reviewed.structuredContent).toMatchObject({
      proposalId: preview.preview.previewId,
      operationHash: preview.preview.operationHash,
    });
    const review = reviewed.structuredContent as { previewImageUrl: string };
    const imageResponse = await fetch(
      `${descriptor.baseUrl}${review.previewImageUrl}`,
      { headers: runtimeHeaders() },
    );
    expect(imageResponse.status).toBe(200);
    const metadata = await sharp(
      Buffer.from(await imageResponse.arrayBuffer()),
    ).metadata();
    expect(metadata).toMatchObject({ width: 600, height: 400 });
    const committed = await mcp.callTool({
      name: "commit_proposal",
      arguments: { previewId: preview.preview.previewId },
    });
    expect(committed.isError, JSON.stringify(committed.content)).not.toBe(true);
    expect(committed.structuredContent).toMatchObject({
      revision: 2,
      actor: { source: "mcp" },
    });
    const consumed = await mcp.callTool({
      name: "explain_proposed_changes",
      arguments: { previewId: preview.preview.previewId },
    });
    expect(consumed.isError).toBe(true);
  } finally {
    await mcp.close();
  }
  const changed = await render();
  expect(changed).not.toEqual(before);
  await request("/api/transactions", {
    schemaVersion: 1,
    mode: "commit",
    runtimeId: descriptor.runtimeId,
    workspaceId: descriptor.workspaceId,
    scope: {
      kind: "frame",
      projectId: proposalProjectId,
      frameId: proposalFrameId,
    },
    baseRevision: 2,
    actor: { source: "http", id: "proposal-reviewer" },
    operations: [{ kind: "undo" }],
  });
  expect(await render()).toEqual(before);

  await bootstrapStudio(
    page,
    `/project/${proposalProjectId}/frame/${proposalFrameId}`,
  );
  await page.getByRole("tab", { name: "Brand" }).click();
  await page.getByText("Proposal Review Plan", { exact: true }).click();
  await page.getByRole("button", { name: "Preview actionable intent" }).click();
  await page.getByRole("button", { name: "Explain proposed changes" }).click();
  await expect(page.getByText("Canonical proposal review")).toBeVisible();
  await expect(page.getByText("1 stored operation · studio")).toBeVisible();
  await expect(page.getByText(/Changed .*transform\/x/)).toBeVisible();
  expect(await render()).toEqual(before);
  await page.getByRole("button", { name: "Commit reviewed preview" }).click();
  await expect(
    page.getByRole("button", { name: /Proposal Frame/ }),
  ).toContainText("r4");
  expect(await render()).toEqual(changed);
  const history = (await (
    await fetch(
      `${descriptor.baseUrl}/api/projects/${proposalProjectId}/frames/${proposalFrameId}/history`,
      { headers: runtimeHeaders() },
    )
  ).json()) as Array<{ revision: number; actor: { source: string } }>;
  expect(history.find((entry) => entry.revision === 2)?.actor.source).toBe(
    "mcp",
  );
  expect(history.find((entry) => entry.revision === 4)?.actor.source).toBe(
    "studio",
  );
  await request("/api/transactions", {
    schemaVersion: 1,
    mode: "commit",
    runtimeId: descriptor.runtimeId,
    workspaceId: descriptor.workspaceId,
    scope: {
      kind: "frame",
      projectId: proposalProjectId,
      frameId: proposalFrameId,
    },
    baseRevision: 4,
    actor: { source: "http", id: "proposal-reviewer" },
    operations: [{ kind: "undo" }],
  });
  expect(await render()).toEqual(before);
});

test("live palette bindings retain exact pins, detach on direct edits, and undo safely", async ({
  page,
}) => {
  test.setTimeout(60_000);
  const liveProjectId = "b0000000-0000-4000-8000-000000000001";
  const liveFrameId = "b0000000-0000-4000-8000-000000000002";
  const nodeId = "b0000000-0000-4000-8000-000000000003";
  const unrelatedId = "b0000000-0000-4000-8000-000000000004";
  await request("/api/transactions", {
    schemaVersion: 1,
    mode: "commit",
    runtimeId: descriptor.runtimeId,
    workspaceId: descriptor.workspaceId,
    scope: { kind: "workspace" },
    baseRevision: null,
    actor: { source: "system", id: "live-brand-e2e" },
    operations: [
      {
        kind: "createProject",
        projectId: liveProjectId,
        slug: "live-brand-e2e",
        name: "Live Brand E2E",
      },
    ],
  });
  await request("/api/transactions", {
    schemaVersion: 1,
    mode: "commit",
    runtimeId: descriptor.runtimeId,
    workspaceId: descriptor.workspaceId,
    scope: { kind: "project", projectId: liveProjectId },
    baseRevision: 0,
    actor: { source: "http", id: "live-brand-fixture" },
    operations: [
      {
        kind: "createFrame",
        frameId: liveFrameId,
        slug: "live-brand",
        name: "Live Brand Frame",
        width: 640,
        height: 480,
      },
    ],
  });
  const rectangle = (id: string, name: string, color: string, x: number) => ({
    id,
    type: "rectangle",
    name,
    visible: true,
    locked: false,
    transform: {
      x,
      y: 80,
      width: 220,
      height: 260,
      rotation: 0,
      scaleX: 1,
      scaleY: 1,
      skewX: 0,
      skewY: 0,
      anchorX: 0,
      anchorY: 0,
    },
    opacity: 1,
    blendMode: "normal",
    fill: { type: "solid", color, opacity: 1 },
    cornerRadius: {
      topLeft: 20,
      topRight: 20,
      bottomRight: 20,
      bottomLeft: 20,
    },
  });
  await request("/api/transactions", {
    schemaVersion: 1,
    mode: "commit",
    runtimeId: descriptor.runtimeId,
    workspaceId: descriptor.workspaceId,
    scope: {
      kind: "frame",
      projectId: liveProjectId,
      frameId: liveFrameId,
    },
    baseRevision: 0,
    actor: { source: "http", id: "live-brand-fixture" },
    operations: [
      {
        kind: "createNode",
        parentId: "root",
        node: rectangle(nodeId, "Bound panel", "#FFFFFF", 60),
      },
      {
        kind: "createNode",
        parentId: "root",
        node: rectangle(unrelatedId, "Unrelated panel", "#22AA88", 360),
      },
    ],
  });
  const kitR1 = (await request("/api/brand-kits", {
    name: "Live Campaign System",
    sourceProjectId: liveProjectId,
    provenance: "Verified live-binding E2E fixture.",
    licenseNotes: "Internal E2E fixture.",
    palette: [{ key: "signal", name: "Signal", color: "#315CF5" }],
    typeRoles: [],
    effectStyles: [
      {
        key: "lifted",
        name: "Lifted",
        effects: {
          items: [
            {
              id: "brand-shadow",
              type: "outerShadow",
              enabled: true,
              offsetX: 0,
              offsetY: 16,
              blur: 28,
              spread: 0,
              color: "#000000",
              opacity: 0.45,
            },
          ],
        },
      },
    ],
    radiusTokens: [{ key: "card", name: "Card", value: 36 }],
    spacingTokens: [{ key: "safe", name: "Safe", value: 48 }],
    variableModes: [
      {
        key: "dark",
        name: "Dark",
        palette: [{ tokenKey: "signal", color: "#90A8FF" }],
      },
    ],
    logos: [],
    definitions: [],
    actor: { source: "http", id: "live-brand-author" },
  })) as { id: string; revision: number; contentHash: string };
  await request(`/api/projects/${liveProjectId}/brand-kit/pin`, {
    kitId: kitR1.id,
    revision: kitR1.revision,
    baseRevision: 1,
    mode: "commit",
    actor: { source: "http", id: "live-brand-author" },
  });
  const kitR2 = (await request("/api/brand-kits", {
    kitId: kitR1.id,
    name: "Live Campaign System",
    sourceProjectId: liveProjectId,
    provenance: "Verified live-binding E2E fixture revision 2.",
    licenseNotes: "Internal E2E fixture.",
    palette: [{ key: "signal", name: "Signal", color: "#F0A24A" }],
    typeRoles: [],
    effectStyles: [
      {
        key: "lifted",
        name: "Lifted",
        effects: {
          items: [
            {
              id: "brand-shadow",
              type: "outerShadow",
              enabled: true,
              offsetX: 0,
              offsetY: 30,
              blur: 50,
              spread: 0,
              color: "#F0A24A",
              opacity: 0.8,
            },
          ],
        },
      },
    ],
    radiusTokens: [{ key: "card", name: "Card", value: 72 }],
    spacingTokens: [{ key: "safe", name: "Safe", value: 96 }],
    variableModes: [
      {
        key: "dark",
        name: "Dark",
        palette: [{ tokenKey: "signal", color: "#FFCC80" }],
      },
    ],
    logos: [],
    definitions: [],
    actor: { source: "http", id: "live-brand-author" },
  })) as { revision: number };
  expect(kitR2.revision).toBe(2);
  const render = async (): Promise<Buffer> => {
    const response = await fetch(
      `${descriptor.baseUrl}/api/projects/${liveProjectId}/frames/${liveFrameId}/render-preview`,
      { method: "POST", headers: runtimeHeaders() },
    );
    expect(response.status).toBe(200);
    return Buffer.from(await response.arrayBuffer());
  };
  const before = await render();
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["apps/mcp/dist/cli.js", "--descriptor", descriptorPath],
    cwd: process.cwd(),
    stderr: "pipe",
  });
  const mcp = new Client({ name: "live-brand-e2e", version: "1.0.0" });
  await mcp.connect(transport);
  try {
    expect((await mcp.listTools()).tools.map((tool) => tool.name)).toContain(
      "bind_live_palette_token",
    );
    const preview = await mcp.callTool({
      name: "bind_live_palette_token",
      arguments: {
        projectId: liveProjectId,
        frameId: liveFrameId,
        baseRevision: 1,
        bindingId: "b0000000-0000-4000-8000-000000000005",
        nodeId,
        property: "fill",
        tokenKey: "signal",
        actorId: "live-brand-agent",
      },
    });
    expect(preview.isError, JSON.stringify(preview.content)).not.toBe(true);
    expect(preview.structuredContent).toMatchObject({ baseRevision: 1 });
    expect(await render()).toEqual(before);
    const previewId = (preview.structuredContent as { previewId: string })
      .previewId;
    const committed = await mcp.callTool({
      name: "commit_preview",
      arguments: { previewId },
    });
    expect(committed.isError, JSON.stringify(committed.content)).not.toBe(true);
    expect(committed.structuredContent).toMatchObject({
      revision: 2,
      actor: { source: "mcp" },
    });
  } finally {
    await mcp.close();
  }
  const blue = await render();
  expect(blue).not.toEqual(before);
  const bound = (await (
    await fetch(
      `${descriptor.baseUrl}/api/projects/${liveProjectId}/frames/${liveFrameId}`,
      { headers: runtimeHeaders() },
    )
  ).json()) as {
    revision: number;
    canvas: {
      safeArea?: Record<string, number>;
      spacingBinding?: {
        id: string;
        tokenKey: string;
        kitRevision: number;
      };
    };
    root: {
      children: Array<{
        id: string;
        fill: { color: string };
        brandBindings?: Array<{
          id: string;
          property: string;
          kitRevision: number;
          tokenKey: string;
        }>;
      }>;
    };
  };
  expect(bound.root.children.find((node) => node.id === nodeId)).toMatchObject({
    fill: { color: "#315CF5" },
    brandBindings: [
      {
        id: "b0000000-0000-4000-8000-000000000005",
        property: "fill",
        kitRevision: 1,
        tokenKey: "signal",
      },
    ],
  });
  expect(
    bound.root.children.find((node) => node.id === unrelatedId),
  ).toMatchObject({ id: unrelatedId, fill: { color: "#22AA88" } });

  const metadataOnly = await request(
    `/api/projects/${liveProjectId}/frames/${liveFrameId}/brand-bindings/palette`,
    {
      baseRevision: 2,
      mode: "commit",
      actor: { source: "http", id: "live-brand-reviewer" },
      bindingId: "b0000000-0000-4000-8000-000000000006",
      nodeId,
      property: "fill",
      tokenKey: "signal",
    },
  );
  expect(metadataOnly).toMatchObject({ revision: 3 });
  expect(await render()).toEqual(blue);

  await request("/api/transactions", {
    schemaVersion: 1,
    mode: "commit",
    runtimeId: descriptor.runtimeId,
    workspaceId: descriptor.workspaceId,
    scope: {
      kind: "frame",
      projectId: liveProjectId,
      frameId: liveFrameId,
    },
    baseRevision: 3,
    actor: { source: "http", id: "human-direct-edit" },
    operations: [
      {
        kind: "updateNode",
        nodeId,
        propertyGroup: "fill",
        value: { fill: { type: "solid", color: "#121212", opacity: 1 } },
      },
    ],
  });
  const direct = (await (
    await fetch(
      `${descriptor.baseUrl}/api/projects/${liveProjectId}/frames/${liveFrameId}`,
      { headers: runtimeHeaders() },
    )
  ).json()) as {
    revision: number;
    root: { children: Array<{ id: string; brandBindings?: unknown }> };
  };
  expect(direct).toMatchObject({ revision: 4 });
  expect(
    direct.root.children.find((node) => node.id === nodeId)?.brandBindings,
  ).toBeUndefined();
  const dark = await render();
  expect(dark).not.toEqual(blue);

  await bootstrapStudio(page, `/project/${liveProjectId}/frame/${liveFrameId}`);
  await page.getByText("Bound panel", { exact: true }).click();
  await page.getByRole("tab", { name: "Brand" }).click();
  await expect(
    page.getByRole("button", { name: "Live Campaign System r1" }),
  ).toHaveClass(/is-selected/);
  await page.locator("summary").filter({ hasText: "Palette" }).click();
  await page.getByTitle("Bind Signal").click();
  await expect(
    page.getByRole("button", { name: "Commit live Brand binding" }),
  ).toBeVisible();
  expect(await render()).toEqual(dark);
  await page.getByRole("button", { name: "Commit live Brand binding" }).click();
  await expect(
    page.getByRole("button", { name: /Live Brand Frame/ }),
  ).toContainText("r5");
  expect(await render()).toEqual(blue);
  await page.getByText("Bound panel", { exact: true }).click();
  await expect(page.getByText(/fill → signal · kit r1/)).toBeVisible();
  await page.getByRole("button", { name: "Detach fill binding" }).click();
  expect(await render()).toEqual(blue);
  await page.getByRole("button", { name: "Commit live Brand binding" }).click();
  await expect(
    page.getByRole("button", { name: /Live Brand Frame/ }),
  ).toContainText("r6");
  expect(await render()).toEqual(blue);
  await request("/api/transactions", {
    schemaVersion: 1,
    mode: "commit",
    runtimeId: descriptor.runtimeId,
    workspaceId: descriptor.workspaceId,
    scope: {
      kind: "frame",
      projectId: liveProjectId,
      frameId: liveFrameId,
    },
    baseRevision: 6,
    actor: { source: "http", id: "live-brand-reviewer" },
    operations: [{ kind: "undo" }],
  });
  expect(await render()).toEqual(blue);

  const pinUpgrade = await fetch(
    `${descriptor.baseUrl}/api/projects/${liveProjectId}/brand-kit/pin`,
    {
      method: "POST",
      headers: { ...runtimeHeaders(), "content-type": "application/json" },
      body: JSON.stringify({
        kitId: kitR1.id,
        revision: 2,
        baseRevision: 2,
        mode: "commit",
        actor: { source: "http", id: "unsafe-upgrade" },
      }),
    },
  );
  expect(pinUpgrade.status).toBe(400);
  expect(await pinUpgrade.json()).toMatchObject({
    error: {
      message: expect.stringContaining(
        "does not match the project's exact pin",
      ),
    },
  });
  const project = (await (
    await fetch(`${descriptor.baseUrl}/api/projects/${liveProjectId}`, {
      headers: runtimeHeaders(),
    })
  ).json()) as { revision: number; brandKitPin: { revision: number } };
  expect(project).toMatchObject({ revision: 2, brandKitPin: { revision: 1 } });

  const history = (await (
    await fetch(
      `${descriptor.baseUrl}/api/projects/${liveProjectId}/frames/${liveFrameId}/history`,
      { headers: runtimeHeaders() },
    )
  ).json()) as Array<{ revision: number; actor: { source: string } }>;
  expect(history.find((entry) => entry.revision === 2)?.actor.source).toBe(
    "mcp",
  );
  expect(history.find((entry) => entry.revision === 4)?.actor.source).toBe(
    "http",
  );
  expect(history.find((entry) => entry.revision === 5)?.actor.source).toBe(
    "studio",
  );
  await request("/api/transactions", {
    schemaVersion: 1,
    mode: "commit",
    runtimeId: descriptor.runtimeId,
    workspaceId: descriptor.workspaceId,
    scope: {
      kind: "frame",
      projectId: liveProjectId,
      frameId: liveFrameId,
    },
    baseRevision: 7,
    actor: { source: "http", id: "live-brand-reviewer" },
    operations: [{ kind: "restoreRevision", revision: 4 }],
  });
  expect(await render()).toEqual(dark);
  const undone = (await (
    await fetch(
      `${descriptor.baseUrl}/api/projects/${liveProjectId}/frames/${liveFrameId}`,
      { headers: runtimeHeaders() },
    )
  ).json()) as {
    root: { children: Array<{ id: string; brandBindings?: unknown }> };
  };
  expect(
    undone.root.children.find((node) => node.id === nodeId)?.brandBindings,
  ).toBeUndefined();
  expect(undone.root.children.map((node) => node.id)).toEqual([
    nodeId,
    unrelatedId,
  ]);

  const effectTransport = new StdioClientTransport({
    command: process.execPath,
    args: ["apps/mcp/dist/cli.js", "--descriptor", descriptorPath],
    cwd: process.cwd(),
    stderr: "pipe",
  });
  const effectMcp = new Client({
    name: "live-effect-e2e",
    version: "1.0.0",
  });
  await effectMcp.connect(effectTransport);
  try {
    const tools = (await effectMcp.listTools()).tools.map((tool) => tool.name);
    expect(tools).toContain("bind_live_effect_style");
    expect(tools).toContain("unbind_live_effect_style");
    const preview = await effectMcp.callTool({
      name: "bind_live_effect_style",
      arguments: {
        projectId: liveProjectId,
        frameId: liveFrameId,
        baseRevision: 8,
        bindingId: "b0000000-0000-4000-8000-000000000007",
        nodeId,
        styleKey: "lifted",
        actorId: "live-effect-agent",
      },
    });
    expect(preview.isError, JSON.stringify(preview.content)).not.toBe(true);
    expect(await render()).toEqual(dark);
    const committed = await effectMcp.callTool({
      name: "commit_preview",
      arguments: {
        previewId: (preview.structuredContent as { previewId: string })
          .previewId,
      },
    });
    expect(committed.isError, JSON.stringify(committed.content)).not.toBe(true);
    expect(committed.structuredContent).toMatchObject({
      revision: 9,
      actor: { source: "mcp" },
    });
  } finally {
    await effectMcp.close();
  }
  const lifted = await render();
  expect(lifted).not.toEqual(dark);
  await page.getByText("Bound panel", { exact: true }).click();
  await page.locator("summary").filter({ hasText: "Effect styles" }).click();
  await expect(
    page.getByText(/Bound effect style: lifted · kit r1/),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Detach effect-style binding" })
    .click();
  expect(await render()).toEqual(lifted);
  await page
    .getByRole("button", { name: "Commit live effect-style binding" })
    .click();
  await expect(
    page.getByRole("button", { name: /Live Brand Frame/ }),
  ).toContainText("r10");
  expect(await render()).toEqual(lifted);
  await request("/api/transactions", {
    schemaVersion: 1,
    mode: "commit",
    runtimeId: descriptor.runtimeId,
    workspaceId: descriptor.workspaceId,
    scope: {
      kind: "frame",
      projectId: liveProjectId,
      frameId: liveFrameId,
    },
    baseRevision: 10,
    actor: { source: "http", id: "live-effect-reviewer" },
    operations: [{ kind: "undo" }],
  });
  await request("/api/transactions", {
    schemaVersion: 1,
    mode: "commit",
    runtimeId: descriptor.runtimeId,
    workspaceId: descriptor.workspaceId,
    scope: {
      kind: "frame",
      projectId: liveProjectId,
      frameId: liveFrameId,
    },
    baseRevision: 11,
    actor: { source: "http", id: "human-effect-edit" },
    operations: [
      {
        kind: "updateNode",
        nodeId,
        propertyGroup: "effects",
        value: { effects: null },
      },
    ],
  });
  expect(await render()).toEqual(dark);
  const effectHistory = (await (
    await fetch(
      `${descriptor.baseUrl}/api/projects/${liveProjectId}/frames/${liveFrameId}/history`,
      { headers: runtimeHeaders() },
    )
  ).json()) as Array<{ revision: number; actor: { source: string } }>;
  expect(
    effectHistory.find((entry) => entry.revision === 9)?.actor.source,
  ).toBe("mcp");
  expect(
    effectHistory.find((entry) => entry.revision === 10)?.actor.source,
  ).toBe("studio");
  expect(
    effectHistory.find((entry) => entry.revision === 12)?.actor.source,
  ).toBe("http");

  const radiusTransport = new StdioClientTransport({
    command: process.execPath,
    args: ["apps/mcp/dist/cli.js", "--descriptor", descriptorPath],
    cwd: process.cwd(),
    stderr: "pipe",
  });
  const radiusMcp = new Client({
    name: "live-radius-e2e",
    version: "1.0.0",
  });
  await radiusMcp.connect(radiusTransport);
  try {
    const tools = (await radiusMcp.listTools()).tools.map((tool) => tool.name);
    expect(tools).toContain("bind_live_radius_token");
    expect(tools).toContain("unbind_live_radius_token");
    const preview = await radiusMcp.callTool({
      name: "bind_live_radius_token",
      arguments: {
        projectId: liveProjectId,
        frameId: liveFrameId,
        baseRevision: 12,
        bindingId: "b0000000-0000-4000-8000-000000000008",
        nodeId,
        tokenKey: "card",
        actorId: "live-radius-agent",
      },
    });
    expect(preview.isError, JSON.stringify(preview.content)).not.toBe(true);
    expect(await render()).toEqual(dark);
    const committed = await radiusMcp.callTool({
      name: "commit_preview",
      arguments: {
        previewId: (preview.structuredContent as { previewId: string })
          .previewId,
      },
    });
    expect(committed.isError, JSON.stringify(committed.content)).not.toBe(true);
    expect(committed.structuredContent).toMatchObject({
      revision: 13,
      actor: { source: "mcp" },
    });
  } finally {
    await radiusMcp.close();
  }
  const rounded = await render();
  expect(rounded).not.toEqual(dark);
  await page.getByText("Bound panel", { exact: true }).click();
  await page.locator("summary").filter({ hasText: "Radius tokens" }).click();
  await expect(
    page.getByText(/Bound radius token: card · kit r1/),
  ).toBeVisible();
  await page.getByRole("button", { name: "Detach radius binding" }).click();
  expect(await render()).toEqual(rounded);
  await page
    .getByRole("button", { name: "Commit live radius binding" })
    .click();
  await expect(
    page.getByRole("button", { name: /Live Brand Frame/ }),
  ).toContainText("r14");
  expect(await render()).toEqual(rounded);
  await request("/api/transactions", {
    schemaVersion: 1,
    mode: "commit",
    runtimeId: descriptor.runtimeId,
    workspaceId: descriptor.workspaceId,
    scope: { kind: "frame", projectId: liveProjectId, frameId: liveFrameId },
    baseRevision: 14,
    actor: { source: "http", id: "live-radius-reviewer" },
    operations: [{ kind: "undo" }],
  });
  await request("/api/transactions", {
    schemaVersion: 1,
    mode: "commit",
    runtimeId: descriptor.runtimeId,
    workspaceId: descriptor.workspaceId,
    scope: { kind: "frame", projectId: liveProjectId, frameId: liveFrameId },
    baseRevision: 15,
    actor: { source: "http", id: "human-radius-edit" },
    operations: [
      {
        kind: "updateNode",
        nodeId,
        propertyGroup: "shape",
        value: {
          cornerRadius: {
            topLeft: 4,
            topRight: 8,
            bottomRight: 12,
            bottomLeft: 16,
          },
        },
      },
    ],
  });
  const finalFrame = (await (
    await fetch(
      `${descriptor.baseUrl}/api/projects/${liveProjectId}/frames/${liveFrameId}`,
      { headers: runtimeHeaders() },
    )
  ).json()) as {
    root: {
      children: Array<{
        id: string;
        cornerRadius?: Record<string, number>;
        brandBindings?: unknown;
      }>;
    };
  };
  expect(
    finalFrame.root.children.find((item) => item.id === nodeId),
  ).toMatchObject({
    cornerRadius: {
      topLeft: 4,
      topRight: 8,
      bottomRight: 12,
      bottomLeft: 16,
    },
  });
  expect(
    finalFrame.root.children.find((item) => item.id === nodeId)?.brandBindings,
  ).toBeUndefined();
  expect(finalFrame.revision).toBe(16);

  const spacingTransport = new StdioClientTransport({
    command: process.execPath,
    args: ["apps/mcp/dist/cli.js", "--descriptor", descriptorPath],
    cwd: process.cwd(),
    stderr: "pipe",
  });
  const spacingMcp = new Client({
    name: "live-spacing-e2e",
    version: "1.0.0",
  });
  await spacingMcp.connect(spacingTransport);
  try {
    const tools = (await spacingMcp.listTools()).tools.map((tool) => tool.name);
    expect(tools).toContain("bind_live_spacing_token");
    expect(tools).toContain("unbind_live_spacing_token");
    const beforeSpacing = await render();
    const preview = await spacingMcp.callTool({
      name: "bind_live_spacing_token",
      arguments: {
        projectId: liveProjectId,
        frameId: liveFrameId,
        baseRevision: 16,
        bindingId: "b0000000-0000-4000-8000-000000000009",
        tokenKey: "safe",
        actorId: "live-spacing-agent",
      },
    });
    expect(preview.isError, JSON.stringify(preview.content)).not.toBe(true);
    expect(await render()).toEqual(beforeSpacing);
    const committed = await spacingMcp.callTool({
      name: "commit_preview",
      arguments: {
        previewId: (preview.structuredContent as { previewId: string })
          .previewId,
      },
    });
    expect(committed.isError, JSON.stringify(committed.content)).not.toBe(true);
    expect(committed.structuredContent).toMatchObject({
      revision: 17,
      actor: { source: "mcp" },
    });
    expect(await render()).toEqual(beforeSpacing);
  } finally {
    await spacingMcp.close();
  }
  const spacingBound = (await (
    await fetch(
      `${descriptor.baseUrl}/api/projects/${liveProjectId}/frames/${liveFrameId}`,
      { headers: runtimeHeaders() },
    )
  ).json()) as {
    canvas: {
      safeArea?: Record<string, number>;
      spacingBinding?: {
        id: string;
        tokenKey: string;
        kitRevision: number;
      };
    };
  };
  expect(spacingBound.canvas).toMatchObject({
    safeArea: { top: 48, right: 48, bottom: 48, left: 48 },
    spacingBinding: {
      id: "b0000000-0000-4000-8000-000000000009",
      tokenKey: "safe",
      kitRevision: 1,
    },
  });
  await page.locator("summary").filter({ hasText: "Spacing tokens" }).click();
  await expect(
    page.getByText(/Bound safe-area token: safe · kit r1/),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Detach safe-area spacing binding" })
    .click();
  await page
    .getByRole("button", { name: "Commit live spacing binding" })
    .click();
  await expect(
    page.getByRole("button", { name: /Live Brand Frame/ }),
  ).toContainText("r18");
  await request("/api/transactions", {
    schemaVersion: 1,
    mode: "commit",
    runtimeId: descriptor.runtimeId,
    workspaceId: descriptor.workspaceId,
    scope: { kind: "frame", projectId: liveProjectId, frameId: liveFrameId },
    baseRevision: 18,
    actor: { source: "http", id: "live-spacing-reviewer" },
    operations: [{ kind: "undo" }],
  });
  await request("/api/transactions", {
    schemaVersion: 1,
    mode: "commit",
    runtimeId: descriptor.runtimeId,
    workspaceId: descriptor.workspaceId,
    scope: { kind: "frame", projectId: liveProjectId, frameId: liveFrameId },
    baseRevision: 19,
    actor: { source: "http", id: "human-spacing-edit" },
    operations: [
      {
        kind: "setCanvas",
        value: {
          safeArea: { top: 32, right: 40, bottom: 48, left: 56 },
        },
      },
    ],
  });
  const spacingEdited = (await (
    await fetch(
      `${descriptor.baseUrl}/api/projects/${liveProjectId}/frames/${liveFrameId}`,
      { headers: runtimeHeaders() },
    )
  ).json()) as {
    revision: number;
    canvas: { safeArea?: Record<string, number>; spacingBinding?: unknown };
    root: { children: Array<{ id: string }> };
  };
  expect(spacingEdited).toMatchObject({
    revision: 20,
    canvas: { safeArea: { top: 32, right: 40, bottom: 48, left: 56 } },
  });
  expect(spacingEdited.canvas.spacingBinding).toBeUndefined();
  expect(spacingEdited.root.children.map((item) => item.id)).toEqual([
    nodeId,
    unrelatedId,
  ]);
  const spacingHistory = (await (
    await fetch(
      `${descriptor.baseUrl}/api/projects/${liveProjectId}/frames/${liveFrameId}/history`,
      { headers: runtimeHeaders() },
    )
  ).json()) as Array<{ revision: number; actor: { source: string } }>;
  expect(
    spacingHistory.find((entry) => entry.revision === 17)?.actor.source,
  ).toBe("mcp");
  expect(
    spacingHistory.find((entry) => entry.revision === 18)?.actor.source,
  ).toBe("studio");
  expect(
    spacingHistory.find((entry) => entry.revision === 20)?.actor.source,
  ).toBe("http");

  await request(
    `/api/projects/${liveProjectId}/frames/${liveFrameId}/brand-bindings/palette`,
    {
      baseRevision: 20,
      mode: "commit",
      actor: { source: "http", id: "mode-fixture" },
      bindingId: "b0000000-0000-4000-8000-00000000000a",
      nodeId,
      property: "fill",
      tokenKey: "signal",
    },
  );
  const baseModeRender = await render();
  const modeTransport = new StdioClientTransport({
    command: process.execPath,
    args: ["apps/mcp/dist/cli.js", "--descriptor", descriptorPath],
    cwd: process.cwd(),
    stderr: "pipe",
  });
  const modeMcp = new Client({ name: "live-mode-e2e", version: "1.0.0" });
  await modeMcp.connect(modeTransport);
  try {
    const tools = (await modeMcp.listTools()).tools.map((tool) => tool.name);
    expect(tools).toContain("apply_live_variable_mode");
    const preview = await modeMcp.callTool({
      name: "apply_live_variable_mode",
      arguments: {
        projectId: liveProjectId,
        frameId: liveFrameId,
        baseRevision: 21,
        modeKey: "dark",
        actorId: "live-mode-agent",
      },
    });
    expect(preview.isError, JSON.stringify(preview.content)).not.toBe(true);
    expect(await render()).toEqual(baseModeRender);
    const committed = await modeMcp.callTool({
      name: "commit_preview",
      arguments: {
        previewId: (preview.structuredContent as { previewId: string })
          .previewId,
      },
    });
    expect(committed.structuredContent).toMatchObject({
      revision: 22,
      actor: { source: "mcp" },
    });
  } finally {
    await modeMcp.close();
  }
  const darkModeRender = await render();
  expect(darkModeRender).not.toEqual(baseModeRender);
  const modeFrame = (await (
    await fetch(
      `${descriptor.baseUrl}/api/projects/${liveProjectId}/frames/${liveFrameId}`,
      { headers: runtimeHeaders() },
    )
  ).json()) as {
    brandMode?: { modeKey: string; kitRevision: number };
    root: { children: Array<{ id: string; fill?: { color: string } }> };
  };
  expect(modeFrame.brandMode).toMatchObject({
    modeKey: "dark",
    kitRevision: 1,
  });
  expect(
    modeFrame.root.children.find((item) => item.id === nodeId),
  ).toMatchObject({
    fill: { color: "#90A8FF" },
  });
  await page.locator("summary").filter({ hasText: "Variable modes" }).click();
  await expect(page.getByText("Active palette mode: dark")).toBeVisible();
  await page.getByRole("button", { name: /Base Restore immutable/ }).click();
  expect(await render()).toEqual(darkModeRender);
  await page.getByRole("button", { name: "Commit variable mode" }).click();
  await expect(
    page.getByRole("button", { name: /Live Brand Frame/ }),
  ).toContainText("r23");
  expect(await render()).toEqual(baseModeRender);
});

test("live typography roles retain exact font mappings, detach on direct edits, and undo safely", async ({
  page,
}) => {
  test.setTimeout(60_000);
  const projectId = "b1000000-0000-4000-8000-000000000001";
  const frameId = "b1000000-0000-4000-8000-000000000002";
  const textId = "b1000000-0000-4000-8000-000000000003";
  await request("/api/transactions", {
    schemaVersion: 1,
    mode: "commit",
    runtimeId: descriptor.runtimeId,
    workspaceId: descriptor.workspaceId,
    scope: { kind: "workspace" },
    baseRevision: null,
    actor: { source: "system", id: "live-type-e2e" },
    operations: [
      {
        kind: "createProject",
        projectId,
        slug: "live-type-e2e",
        name: "Live Type E2E",
      },
    ],
  });
  const font = await importProjectFont({
    projectId,
    baseRevision: 0,
    path: path.join(
      process.cwd(),
      "apps/studio/node_modules/@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-600-normal.woff2",
    ),
    filename: "ibm-plex-sans-600.woff2",
  });
  await request("/api/transactions", {
    schemaVersion: 1,
    mode: "commit",
    runtimeId: descriptor.runtimeId,
    workspaceId: descriptor.workspaceId,
    scope: { kind: "project", projectId },
    baseRevision: 1,
    actor: { source: "http", id: "live-type-fixture" },
    operations: [
      {
        kind: "createFrame",
        frameId,
        slug: "live-type",
        name: "Live Type Frame",
        width: 640,
        height: 360,
      },
    ],
  });
  await request("/api/transactions", {
    schemaVersion: 1,
    mode: "commit",
    runtimeId: descriptor.runtimeId,
    workspaceId: descriptor.workspaceId,
    scope: { kind: "frame", projectId, frameId },
    baseRevision: 0,
    actor: { source: "http", id: "live-type-fixture" },
    operations: [
      {
        kind: "createNode",
        parentId: "root",
        node: {
          id: textId,
          type: "text",
          name: "Bound headline",
          visible: true,
          locked: false,
          transform: {
            x: 60,
            y: 100,
            width: 520,
            height: 120,
            rotation: 0,
            scaleX: 1,
            scaleY: 1,
            skewX: 0,
            skewY: 0,
            anchorX: 0,
            anchorY: 0,
          },
          opacity: 1,
          blendMode: "normal",
          text: "Live typography",
          typography: {
            fontId: font.id,
            fontSize: 32,
            fontWeight: 600,
            fontStyle: "normal",
            lineHeight: 40,
            letterSpacing: 0,
            alignment: "left",
            verticalAlignment: "middle",
            color: "#111111",
            opacity: 1,
          },
          textBox: {
            mode: "fixed",
            width: 520,
            height: 120,
            wrapping: "word",
            overflow: "clip",
            overflowAccepted: false,
          },
        },
      },
    ],
  });
  const kitR1 = (await request("/api/brand-kits", {
    name: "Live Type System",
    sourceProjectId: projectId,
    provenance: "Verified live typography E2E fixture.",
    licenseNotes: "Internal E2E fixture.",
    palette: [{ key: "signal", name: "Signal", color: "#315CF5" }],
    typeRoles: [
      {
        key: "display",
        name: "Display",
        fontId: font.id,
        fontSize: 64,
        lineHeight: 72,
        letterSpacing: -1,
        colorToken: "signal",
      },
    ],
    logos: [],
    definitions: [],
    actor: { source: "http", id: "live-type-author" },
  })) as { id: string; revision: number; contentHash: string };
  await request(`/api/projects/${projectId}/brand-kit/pin`, {
    kitId: kitR1.id,
    revision: kitR1.revision,
    baseRevision: 2,
    mode: "commit",
    actor: { source: "http", id: "live-type-author" },
  });
  const kitR2 = (await request("/api/brand-kits", {
    kitId: kitR1.id,
    name: "Live Type System",
    sourceProjectId: projectId,
    provenance: "Verified live typography E2E fixture revision 2.",
    licenseNotes: "Internal E2E fixture.",
    palette: [{ key: "signal", name: "Signal", color: "#F0A24A" }],
    typeRoles: [
      {
        key: "display",
        name: "Display",
        fontId: font.id,
        fontSize: 88,
        lineHeight: 96,
        letterSpacing: 2,
        colorToken: "signal",
      },
    ],
    logos: [],
    definitions: [],
    actor: { source: "http", id: "live-type-author" },
  })) as { revision: number };
  expect(kitR2.revision).toBe(2);
  const project = (await (
    await fetch(`${descriptor.baseUrl}/api/projects/${projectId}`, {
      headers: runtimeHeaders(),
    })
  ).json()) as {
    revision: number;
    brandKitPin: { revision: number; resourceMap: Record<string, string> };
  };
  expect(project).toMatchObject({ revision: 3, brandKitPin: { revision: 1 } });
  const mappedFontId = Object.values(project.brandKitPin.resourceMap)[0];
  expect(mappedFontId).toBeTruthy();
  const render = async (): Promise<Buffer> => {
    const response = await fetch(
      `${descriptor.baseUrl}/api/projects/${projectId}/frames/${frameId}/render-preview`,
      { method: "POST", headers: runtimeHeaders() },
    );
    expect(response.status).toBe(200);
    return Buffer.from(await response.arrayBuffer());
  };
  const before = await render();
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["apps/mcp/dist/cli.js", "--descriptor", descriptorPath],
    cwd: process.cwd(),
    stderr: "pipe",
  });
  const mcp = new Client({ name: "live-type-e2e", version: "1.0.0" });
  await mcp.connect(transport);
  try {
    const tools = (await mcp.listTools()).tools.map((tool) => tool.name);
    expect(tools).toContain("bind_live_typography_role");
    expect(tools).toContain("unbind_live_typography_role");
    const preview = await mcp.callTool({
      name: "bind_live_typography_role",
      arguments: {
        projectId,
        frameId,
        baseRevision: 1,
        bindingId: "b1000000-0000-4000-8000-000000000004",
        nodeId: textId,
        roleKey: "display",
        actorId: "live-type-agent",
      },
    });
    expect(preview.isError, JSON.stringify(preview.content)).not.toBe(true);
    expect(await render()).toEqual(before);
    const committed = await mcp.callTool({
      name: "commit_preview",
      arguments: {
        previewId: (preview.structuredContent as { previewId: string })
          .previewId,
      },
    });
    expect(committed.isError, JSON.stringify(committed.content)).not.toBe(true);
    expect(committed.structuredContent).toMatchObject({
      revision: 2,
      actor: { source: "mcp" },
    });
  } finally {
    await mcp.close();
  }
  const boundRender = await render();
  expect(boundRender).not.toEqual(before);
  const readFrame = async () =>
    (await (
      await fetch(
        `${descriptor.baseUrl}/api/projects/${projectId}/frames/${frameId}`,
        { headers: runtimeHeaders() },
      )
    ).json()) as {
      revision: number;
      root: {
        children: Array<{
          id: string;
          typography: {
            fontId: string;
            fontSize: number;
            fontWeight: number;
            lineHeight: number;
            letterSpacing: number;
            color: string;
          };
          brandBindings?: Array<{
            id: string;
            property: string;
            tokenKey: string;
            kitRevision: number;
          }>;
        }>;
      };
    };
  expect((await readFrame()).root.children[0]).toMatchObject({
    id: textId,
    typography: {
      fontId: mappedFontId,
      fontSize: 64,
      fontWeight: 600,
      lineHeight: 72,
      letterSpacing: -1,
      color: "#315CF5",
    },
    brandBindings: [
      {
        id: "b1000000-0000-4000-8000-000000000004",
        property: "typography",
        tokenKey: "display",
        kitRevision: 1,
      },
    ],
  });

  await request(
    `/api/projects/${projectId}/frames/${frameId}/brand-bindings/typography`,
    {
      baseRevision: 2,
      mode: "commit",
      actor: { source: "http", id: "live-type-reviewer" },
      bindingId: "b1000000-0000-4000-8000-000000000005",
      nodeId: textId,
      roleKey: "display",
    },
  );
  expect(await render()).toEqual(boundRender);
  await request("/api/transactions", {
    schemaVersion: 1,
    mode: "commit",
    runtimeId: descriptor.runtimeId,
    workspaceId: descriptor.workspaceId,
    scope: { kind: "frame", projectId, frameId },
    baseRevision: 3,
    actor: { source: "http", id: "human-type-edit" },
    operations: [
      {
        kind: "updateNode",
        nodeId: textId,
        propertyGroup: "typography",
        value: { fontSize: 52 },
      },
    ],
  });
  expect((await readFrame()).root.children[0]?.brandBindings).toBeUndefined();
  const directRender = await render();
  expect(directRender).not.toEqual(boundRender);

  await bootstrapStudio(page, `/project/${projectId}/frame/${frameId}`);
  await page.getByText("Bound headline", { exact: true }).click();
  await page.getByRole("tab", { name: "Brand" }).click();
  await page.locator("summary").filter({ hasText: "Type roles" }).click();
  await page.getByRole("button", { name: /Display/ }).click();
  await expect(
    page.getByRole("button", { name: "Commit live typography binding" }),
  ).toBeVisible();
  expect(await render()).toEqual(directRender);
  await page
    .getByRole("button", { name: "Commit live typography binding" })
    .click();
  await expect(
    page.getByRole("button", { name: /Live Type Frame/ }),
  ).toContainText("r5");
  expect(await render()).toEqual(boundRender);
  await page.getByText("Bound headline", { exact: true }).click();
  await expect(
    page.getByText(/Bound type role: display · kit r1/),
  ).toBeVisible();
  await page.getByRole("button", { name: "Detach typography binding" }).click();
  expect(await render()).toEqual(boundRender);
  await page
    .getByRole("button", { name: "Commit live typography binding" })
    .click();
  await expect(
    page.getByRole("button", { name: /Live Type Frame/ }),
  ).toContainText("r6");
  expect(await render()).toEqual(boundRender);
  await request("/api/transactions", {
    schemaVersion: 1,
    mode: "commit",
    runtimeId: descriptor.runtimeId,
    workspaceId: descriptor.workspaceId,
    scope: { kind: "frame", projectId, frameId },
    baseRevision: 6,
    actor: { source: "http", id: "live-type-reviewer" },
    operations: [{ kind: "undo" }],
  });
  expect((await readFrame()).root.children[0]?.brandBindings).toEqual([
    expect.objectContaining({ property: "typography", tokenKey: "display" }),
  ]);

  const pinUpgrade = await fetch(
    `${descriptor.baseUrl}/api/projects/${projectId}/brand-kit/pin`,
    {
      method: "POST",
      headers: { ...runtimeHeaders(), "content-type": "application/json" },
      body: JSON.stringify({
        kitId: kitR1.id,
        revision: 2,
        baseRevision: 3,
        mode: "commit",
        actor: { source: "http", id: "unsafe-type-upgrade" },
      }),
    },
  );
  expect(pinUpgrade.status).toBe(400);
  expect(await pinUpgrade.json()).toMatchObject({
    error: { message: expect.stringContaining("exact pin") },
  });
  const history = (await (
    await fetch(
      `${descriptor.baseUrl}/api/projects/${projectId}/frames/${frameId}/history`,
      { headers: runtimeHeaders() },
    )
  ).json()) as Array<{ revision: number; actor: { source: string } }>;
  expect(history.find((entry) => entry.revision === 2)?.actor.source).toBe(
    "mcp",
  );
  expect(history.find((entry) => entry.revision === 4)?.actor.source).toBe(
    "http",
  );
  expect(history.find((entry) => entry.revision === 5)?.actor.source).toBe(
    "studio",
  );
  await request("/api/transactions", {
    schemaVersion: 1,
    mode: "commit",
    runtimeId: descriptor.runtimeId,
    workspaceId: descriptor.workspaceId,
    scope: { kind: "frame", projectId, frameId },
    baseRevision: 7,
    actor: { source: "http", id: "live-type-reviewer" },
    operations: [{ kind: "restoreRevision", revision: 4 }],
  });
  expect(await render()).toEqual(directRender);
  const restored = await readFrame();
  expect(restored.root.children.map((node) => node.id)).toEqual([textId]);
  expect(restored.root.children[0]?.brandBindings).toBeUndefined();
});

test("HTTP security rejects untrusted callers and rotates the capability", async () => {
  const unauthorized = await fetch(`${descriptor.baseUrl}/api/runtime`);
  expect(unauthorized.status).toBe(401);
  expect(await unauthorized.json()).toMatchObject({
    error: { code: "INVALID_RUNTIME_CAPABILITY" },
  });

  const badOrigin = await fetch(`${descriptor.baseUrl}/api/runtime`, {
    headers: {
      authorization: `Bearer ${descriptor.capabilityToken}`,
      origin: "https://malicious.example",
    },
  });
  expect(badOrigin.status).toBe(403);
  expect(await badOrigin.json()).toMatchObject({
    error: { code: "INVALID_ORIGIN" },
  });

  const missingHeaders = await fetch(`${descriptor.baseUrl}/api/projects`, {
    headers: { authorization: `Bearer ${descriptor.capabilityToken}` },
  });
  expect(missingHeaders.status).toBe(401);
  expect(await missingHeaders.json()).toMatchObject({
    error: { code: "INVALID_RUNTIME_CAPABILITY" },
  });

  const previousToken = descriptor.capabilityToken;
  const rotatedResponse = await fetch(
    `${descriptor.baseUrl}/api/runtime/capability/rotate`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${previousToken}`,
        "x-design-runtime-id": descriptor.runtimeId,
        "x-design-workspace-id": descriptor.workspaceId,
      },
    },
  );
  expect(rotatedResponse.status).toBe(200);
  const rotated = (await rotatedResponse.json()) as {
    capabilityToken: string;
  };
  expect(rotated.capabilityToken).not.toBe(previousToken);
  descriptor.capabilityToken = rotated.capabilityToken;

  const staleToken = await fetch(`${descriptor.baseUrl}/api/runtime`, {
    headers: { authorization: `Bearer ${previousToken}` },
  });
  expect(staleToken.status).toBe(401);
  const currentToken = await fetch(`${descriptor.baseUrl}/api/runtime`, {
    headers: { authorization: `Bearer ${descriptor.capabilityToken}` },
  });
  expect(currentToken.status).toBe(200);
  expect(await currentToken.json()).toMatchObject({
    status: "ready",
    compatibility: {
      runtimeApiVersion: 1,
      workspaceSchemaVersion: 1,
    },
  });
});

test("authenticated lifecycle shutdown exits cleanly and removes its descriptor", async () => {
  const exited = once(runtime, "exit");
  const response = await fetch(`${descriptor.baseUrl}/api/runtime/stop`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${descriptor.capabilityToken}`,
      "x-design-runtime-id": descriptor.runtimeId,
      "x-design-workspace-id": descriptor.workspaceId,
    },
  });
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
    status: "stopping",
    runtimeId: descriptor.runtimeId,
  });
  await exited;
  expect(runtime.exitCode).toBe(0);
  await expect
    .poll(() =>
      stat(descriptorPath)
        .then(() => true)
        .catch(() => false),
    )
    .toBe(false);
});
