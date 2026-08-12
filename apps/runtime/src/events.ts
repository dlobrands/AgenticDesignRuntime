import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import type {
  RuntimeEvent,
  RuntimeEventName,
  WorkspaceState,
} from "./types.js";

export class RuntimeEventBus {
  readonly #emitter = new EventEmitter();
  readonly #workspace: WorkspaceState;

  constructor(workspace: WorkspaceState) {
    this.#workspace = workspace;
    this.#emitter.setMaxListeners(100);
  }

  emit<T>(event: RuntimeEventName, payload: T): RuntimeEvent<T> {
    const envelope: RuntimeEvent<T> = {
      event,
      eventId: randomUUID(),
      runtimeId: this.#workspace.runtimeId,
      workspaceId: this.#workspace.config.workspaceId,
      timestamp: new Date().toISOString(),
      payload,
    };
    this.#emitter.emit("event", envelope);
    return envelope;
  }

  subscribe(listener: (event: RuntimeEvent) => void): () => void {
    this.#emitter.on("event", listener);
    return () => this.#emitter.off("event", listener);
  }
}
