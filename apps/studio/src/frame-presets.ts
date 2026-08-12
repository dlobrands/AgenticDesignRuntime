export type MarketingFramePreset = {
  id: string;
  label: string;
  width: number;
  height: number;
  category: "social" | "video" | "print";
};

export const MARKETING_FRAME_PRESETS = [
  {
    id: "instagram-portrait",
    label: "Instagram portrait",
    width: 1080,
    height: 1350,
    category: "social",
  },
  {
    id: "instagram-square",
    label: "Instagram square",
    width: 1080,
    height: 1080,
    category: "social",
  },
  {
    id: "story-reel",
    label: "Story / Reel",
    width: 1080,
    height: 1920,
    category: "video",
  },
  {
    id: "youtube-thumbnail",
    label: "YouTube thumbnail",
    width: 1280,
    height: 720,
    category: "video",
  },
  {
    id: "linkedin-landscape",
    label: "LinkedIn landscape",
    width: 1200,
    height: 627,
    category: "social",
  },
  {
    id: "linkedin-square",
    label: "LinkedIn square",
    width: 1200,
    height: 1200,
    category: "social",
  },
  {
    id: "poster-portrait",
    label: "Poster portrait",
    width: 1800,
    height: 2400,
    category: "print",
  },
] as const satisfies readonly MarketingFramePreset[];

export const marketingFramePreset = (
  id: string,
): MarketingFramePreset | undefined =>
  MARKETING_FRAME_PRESETS.find((preset) => preset.id === id);
