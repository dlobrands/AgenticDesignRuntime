import type { DesignPlan } from "./model.js";
import { DesignPlanSchema } from "./schema.js";

export const createDesignPlan = (
  input: Omit<DesignPlan, "id" | "createdAt" | "updatedAt"> & {
    id: string;
    now: string;
    createdAt?: string;
  },
): DesignPlan => {
  const { now, createdAt, ...plan } = input;
  return DesignPlanSchema.parse({
    ...plan,
    createdAt: createdAt ?? now,
    updatedAt: now,
  });
};
