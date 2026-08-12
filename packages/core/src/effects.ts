import type { Effect, Effects } from "./model.js";

export const LEGACY_OUTER_SHADOW_EFFECT_ID = "legacy-outer-shadow";

export const effectItems = (effects: Effects | undefined): Effect[] => {
  if (!effects) return [];
  if ("items" in effects && effects.items) return effects.items;
  return [
    {
      id: LEGACY_OUTER_SHADOW_EFFECT_ID,
      type: "outerShadow",
      ...effects.outerShadow,
    },
  ];
};

export const hasEnabledEffects = (effects: Effects | undefined): boolean =>
  effectItems(effects).some((effect) => effect.enabled);
