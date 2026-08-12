import type { DesignBrief } from "./model.js";
import { DesignBriefSchema } from "./schema.js";

export const createDesignBrief = (
  input: Omit<DesignBrief, "id" | "createdAt" | "updatedAt"> & {
    id: string;
    now: string;
    createdAt?: string;
  },
): DesignBrief => {
  const { now, createdAt, ...brief } = input;
  return DesignBriefSchema.parse({
    ...brief,
    createdAt: createdAt ?? now,
    updatedAt: now,
  });
};
