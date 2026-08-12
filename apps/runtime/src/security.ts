import {
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { RuntimeError, type Actor } from "@agentic-design/core";
import { readJson, writeJsonAtomic } from "./fs-safe.js";
import type { WorkspaceState } from "./types.js";

export const SESSION_COOKIE = "adr_session";
export const CLIENT_SESSION_HEADER = "x-design-session-id";

export type RuntimeClientSource = "studio" | "http" | "mcp";
export type RuntimeClientIdentity = {
  clientId: string;
  sessionId: string;
  source: RuntimeClientSource;
  label: string;
};

type IdentityRecord = RuntimeClientIdentity & {
  expiresAt: number;
  authSessionId?: string;
};

const secretHash = (value: string): Buffer =>
  createHash("sha256").update(value).digest();
const secureEqual = (left: string, right: string): boolean =>
  timingSafeEqual(secretHash(left), secretHash(right));

export class RuntimeSecurity {
  readonly workspace: WorkspaceState;
  readonly #sessions = new Map<string, IdentityRecord>();
  readonly #clientSessions = new Map<string, IdentityRecord>();
  readonly #nonces = new Map<string, number>();
  readonly #capabilityIdentity: IdentityRecord;

  constructor(workspace: WorkspaceState) {
    this.workspace = workspace;
    this.#capabilityIdentity = this.#newIdentity("http", "HTTP client");
  }

  registerClient(
    request: FastifyRequest,
    source: RuntimeClientSource,
    label?: string,
  ): RuntimeClientIdentity {
    const capabilityAuthenticated = this.#hasCapability(request);
    const sessionAuthenticated = this.#hasSession(request);
    if (source === "studio" && !sessionAuthenticated)
      throw new RuntimeError(
        "INVALID_RUNTIME_CAPABILITY",
        "Studio identity requires an authenticated browser session.",
        undefined,
        401,
      );
    if (source !== "studio" && !capabilityAuthenticated)
      throw new RuntimeError(
        "INVALID_RUNTIME_CAPABILITY",
        "HTTP and MCP identities require the runtime capability.",
        undefined,
        401,
      );
    const browserIdentity = this.#browserIdentity(request);
    const identity = this.#newIdentity(
      source,
      label?.trim().slice(0, 128) ||
        (source === "studio"
          ? "Studio"
          : source === "mcp"
            ? "MCP agent"
            : "HTTP client"),
      browserIdentity?.sessionId,
    );
    this.#clientSessions.set(identity.sessionId, identity);
    return this.#publicIdentity(identity);
  }

  identityForRequest(request: FastifyRequest): RuntimeClientIdentity {
    const requestedSession = request.headers[CLIENT_SESSION_HEADER];
    if (typeof requestedSession === "string") {
      const record = this.#clientSessions.get(requestedSession);
      if (!record || record.expiresAt <= Date.now()) {
        this.#clientSessions.delete(requestedSession);
        throw new RuntimeError(
          "INVALID_RUNTIME_CAPABILITY",
          "Client session identity is invalid or expired.",
          undefined,
          401,
        );
      }
      if (record.source === "studio") {
        const browserIdentity = this.#browserIdentity(request);
        if (
          !browserIdentity ||
          browserIdentity.sessionId !== record.authSessionId
        )
          throw new RuntimeError(
            "INVALID_RUNTIME_CAPABILITY",
            "Studio session identity does not match browser authentication.",
            undefined,
            401,
          );
      }
      if (record.source !== "studio" && !this.#hasCapability(request))
        throw new RuntimeError(
          "INVALID_RUNTIME_CAPABILITY",
          "Capability client identity does not match authentication.",
          undefined,
          401,
        );
      return this.#publicIdentity(record);
    }
    const browser = this.#browserIdentity(request);
    if (browser) return this.#publicIdentity(browser);
    return this.#publicIdentity(this.#capabilityIdentity);
  }

  actorForRequest(
    request: FastifyRequest,
    claimed?: { id?: string },
  ): Actor & { source: RuntimeClientSource } {
    const identity = this.identityForRequest(request);
    return {
      source: identity.source,
      id: claimed?.id?.trim().slice(0, 128) || identity.label,
      clientId: identity.clientId,
      sessionId: identity.sessionId,
    };
  }

  connectionForRequest(request: FastifyRequest): RuntimeClientIdentity & {
    connectionId: string;
  } {
    return { ...this.identityForRequest(request), connectionId: randomUUID() };
  }

  issueBootstrapNonce(ttlMs = 60_000): string {
    const nonce = randomBytes(32).toString("base64url");
    this.#nonces.set(nonce, Date.now() + ttlMs);
    return nonce;
  }

  async rotateCapability(): Promise<string> {
    const next = randomBytes(32).toString("base64url");
    const descriptor = (await readJson(
      this.workspace.descriptorPath,
    )) as Record<string, unknown>;
    await writeJsonAtomic(
      this.workspace.descriptorPath,
      { ...descriptor, capabilityToken: next },
      0o600,
    );
    this.workspace.capabilityToken = next;
    return next;
  }

  register(app: FastifyInstance): void {
    app.get<{ Querystring: { nonce?: string; next?: string } }>(
      "/bootstrap",
      async (request, reply) => {
        const nonce = request.query.nonce;
        if (!nonce || !this.#consumeNonce(nonce))
          throw new RuntimeError(
            "INVALID_RUNTIME_CAPABILITY",
            "Bootstrap nonce is invalid or expired.",
            undefined,
            401,
          );
        const session = randomBytes(32).toString("base64url");
        this.#sessions.set(session, this.#newIdentity("studio", "Studio"));
        reply.setCookie(SESSION_COOKIE, session, {
          httpOnly: true,
          sameSite: "strict",
          secure: false,
          path: "/",
          maxAge: 12 * 60 * 60,
        });
        const next =
          request.query.next?.startsWith("/") &&
          !request.query.next.startsWith("//")
            ? request.query.next
            : "/";
        return reply.redirect(next);
      },
    );
  }

  assertRequest(
    request: FastifyRequest,
    options: { runtimeHeaders?: boolean } = {},
  ): void {
    this.#assertHost(request);
    this.#assertOrigin(request);
    const capabilityAuthenticated = this.#hasCapability(request);
    const sessionAuthenticated = this.#hasSession(request);
    if (!capabilityAuthenticated && !sessionAuthenticated)
      throw new RuntimeError(
        "INVALID_RUNTIME_CAPABILITY",
        "A valid runtime capability or browser session is required.",
        undefined,
        401,
      );
    if (options.runtimeHeaders && capabilityAuthenticated)
      this.#assertRuntimeHeaders(request);
  }

  assertSocket(request: FastifyRequest): void {
    this.assertRequest(request, { runtimeHeaders: false });
  }

  assertCapabilityRequest(request: FastifyRequest): void {
    this.#assertHost(request);
    this.#assertOrigin(request);
    if (!this.#hasCapability(request))
      throw new RuntimeError(
        "INVALID_RUNTIME_CAPABILITY",
        "A valid runtime capability is required.",
        undefined,
        401,
      );
    this.#assertRuntimeHeaders(request);
  }

  error(
    reply: FastifyReply,
    error: RuntimeError,
    requestId: string,
  ): FastifyReply {
    return reply.status(error.statusCode).send({
      error: {
        code: error.code,
        message: error.message,
        requestId,
        ...(error.details ? { details: error.details } : {}),
      },
    });
  }

  #consumeNonce(nonce: string): boolean {
    const expiresAt = this.#nonces.get(nonce);
    this.#nonces.delete(nonce);
    for (const [key, expiry] of this.#nonces)
      if (expiry <= Date.now()) this.#nonces.delete(key);
    return expiresAt !== undefined && expiresAt > Date.now();
  }

  #hasCapability(request: FastifyRequest): boolean {
    const header = request.headers.authorization;
    if (!header?.startsWith("Bearer ")) return false;
    return secureEqual(header.slice(7), this.workspace.capabilityToken);
  }

  #hasSession(request: FastifyRequest): boolean {
    return this.#browserIdentity(request) !== undefined;
  }

  #browserIdentity(request: FastifyRequest): IdentityRecord | undefined {
    const value = request.cookies[SESSION_COOKIE];
    if (!value) return undefined;
    const record = this.#sessions.get(value);
    if (!record || record.expiresAt <= Date.now()) {
      this.#sessions.delete(value);
      return undefined;
    }
    return record;
  }

  #newIdentity(
    source: RuntimeClientSource,
    label: string,
    authSessionId?: string,
  ): IdentityRecord {
    return {
      clientId: randomUUID(),
      sessionId: randomUUID(),
      source,
      label,
      expiresAt: Date.now() + 12 * 60 * 60_000,
      ...(authSessionId ? { authSessionId } : {}),
    };
  }

  #publicIdentity(record: IdentityRecord): RuntimeClientIdentity {
    return {
      clientId: record.clientId,
      sessionId: record.sessionId,
      source: record.source,
      label: record.label,
    };
  }

  #assertHost(request: FastifyRequest): void {
    const host = request.headers.host?.toLowerCase();
    if (!host)
      throw new RuntimeError(
        "INVALID_HOST",
        "The Host header is required.",
        undefined,
        400,
      );
    const port = this.workspace.config.server.port;
    const allowed = new Set([
      `${this.workspace.config.server.host.toLowerCase()}:${port}`,
      `127.0.0.1:${port}`,
      `localhost:${port}`,
      `[::1]:${port}`,
    ]);
    if (!allowed.has(host))
      throw new RuntimeError(
        "INVALID_HOST",
        "The Host header does not identify this local runtime.",
        { host },
        403,
      );
  }

  #assertOrigin(request: FastifyRequest): void {
    const origin = request.headers.origin;
    if (!origin) return;
    const port = this.workspace.config.server.port;
    const allowed = new Set([
      `http://${this.workspace.config.server.host}:${port}`,
      `http://127.0.0.1:${port}`,
      `http://localhost:${port}`,
      `http://[::1]:${port}`,
    ]);
    if (!allowed.has(origin))
      throw new RuntimeError(
        "INVALID_ORIGIN",
        "The request Origin is not allowed.",
        { origin },
        403,
      );
  }

  #assertRuntimeHeaders(request: FastifyRequest): void {
    const runtimeId = request.headers["x-design-runtime-id"];
    const workspaceId = request.headers["x-design-workspace-id"];
    if (runtimeId !== this.workspace.runtimeId) {
      throw new RuntimeError(
        "INVALID_RUNTIME_CAPABILITY",
        "The runtime header is missing or does not match the active process.",
        undefined,
        401,
      );
    }
    if (workspaceId !== this.workspace.config.workspaceId) {
      throw new RuntimeError(
        "WORKSPACE_MISMATCH",
        "The workspace header is missing or does not match the active workspace.",
        undefined,
        409,
      );
    }
  }
}
