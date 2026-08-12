import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import cookie from "@fastify/cookie";
import Fastify from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import {
  CLIENT_SESSION_HEADER,
  RuntimeSecurity,
  type RuntimeClientSource,
} from "../src/security.js";
import { closeWorkspace, openWorkspace } from "../src/workspace.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

const createHarness = async () => {
  const root = await mkdtemp(path.join(tmpdir(), "adr-security-test-"));
  roots.push(root);
  const workspace = await openWorkspace(root, {
    descriptorDirectory: path.join(root, "descriptors"),
  });
  const security = new RuntimeSecurity(workspace);
  const app = Fastify();
  await app.register(cookie);
  security.register(app);
  app.post<{
    Body: { source: RuntimeClientSource; label?: string };
  }>("/test/session", async (request) =>
    security.registerClient(request, request.body.source, request.body.label),
  );
  app.post<{ Body: { id?: string; source?: string } }>(
    "/test/actor",
    async (request) => security.actorForRequest(request, request.body),
  );
  return { app, security, workspace };
};

describe("runtime-issued participant identity", () => {
  it("issues distinct Studio sessions and binds them to browser authentication", async () => {
    const { app, security, workspace } = await createHarness();
    try {
      const nonce = security.issueBootstrapNonce();
      const bootstrap = await app.inject({
        method: "GET",
        url: `/bootstrap?nonce=${nonce}`,
      });
      expect(bootstrap.statusCode).toBe(302);
      const browserCookie = bootstrap.cookies[0];
      expect(browserCookie?.name).toBe("adr_session");

      const registerStudio = () =>
        app.inject({
          method: "POST",
          url: "/test/session",
          cookies: { adr_session: browserCookie!.value },
          payload: { source: "studio", label: "Studio window" },
        });
      const first = await registerStudio();
      const second = await registerStudio();
      expect(first.statusCode).toBe(200);
      expect(second.statusCode).toBe(200);
      const firstIdentity = first.json();
      const secondIdentity = second.json();
      expect(firstIdentity).toMatchObject({
        source: "studio",
        label: "Studio window",
      });
      expect(secondIdentity.sessionId).not.toBe(firstIdentity.sessionId);
      expect(secondIdentity.clientId).not.toBe(firstIdentity.clientId);

      const actor = await app.inject({
        method: "POST",
        url: "/test/actor",
        cookies: { adr_session: browserCookie!.value },
        headers: { [CLIENT_SESSION_HEADER]: firstIdentity.sessionId },
        payload: { id: "Human editor", source: "mcp" },
      });
      expect(actor.json()).toMatchObject({
        source: "studio",
        id: "Human editor",
        clientId: firstIdentity.clientId,
        sessionId: firstIdentity.sessionId,
      });

      const secondNonce = security.issueBootstrapNonce();
      const secondBootstrap = await app.inject({
        method: "GET",
        url: `/bootstrap?nonce=${secondNonce}`,
      });
      const secondBrowserCookie = secondBootstrap.cookies[0]!;
      const crossWindowImpersonation = await app.inject({
        method: "POST",
        url: "/test/actor",
        cookies: { adr_session: secondBrowserCookie.value },
        headers: { [CLIENT_SESSION_HEADER]: firstIdentity.sessionId },
        payload: { id: "Impersonated editor" },
      });
      expect(crossWindowImpersonation.statusCode).toBe(401);
    } finally {
      await app.close();
      await closeWorkspace(workspace);
    }
  });

  it("prevents capability callers from claiming Studio provenance", async () => {
    const { app, workspace } = await createHarness();
    const capabilityHeaders = {
      authorization: `Bearer ${workspace.capabilityToken}`,
    };
    try {
      const rejectedStudio = await app.inject({
        method: "POST",
        url: "/test/session",
        headers: capabilityHeaders,
        payload: { source: "studio" },
      });
      expect(rejectedStudio.statusCode).toBe(401);

      const registeredMcp = await app.inject({
        method: "POST",
        url: "/test/session",
        headers: capabilityHeaders,
        payload: { source: "mcp", label: "Agent MCP" },
      });
      expect(registeredMcp.statusCode).toBe(200);
      const mcpIdentity = registeredMcp.json();

      const mcpActor = await app.inject({
        method: "POST",
        url: "/test/actor",
        headers: {
          ...capabilityHeaders,
          [CLIENT_SESSION_HEADER]: mcpIdentity.sessionId,
        },
        payload: { id: "Agent seven", source: "studio" },
      });
      expect(mcpActor.json()).toMatchObject({
        source: "mcp",
        id: "Agent seven",
        clientId: mcpIdentity.clientId,
        sessionId: mcpIdentity.sessionId,
      });

      const httpActor = await app.inject({
        method: "POST",
        url: "/test/actor",
        headers: capabilityHeaders,
        payload: { id: "Automation", source: "studio" },
      });
      expect(httpActor.json()).toMatchObject({
        source: "http",
        id: "Automation",
      });
    } finally {
      await app.close();
      await closeWorkspace(workspace);
    }
  });
});
