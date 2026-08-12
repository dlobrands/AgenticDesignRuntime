import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  DesignBriefSchema,
  ProjectDocumentSchema,
  createDesignBrief,
  createProjectDocument,
} from "../src/index.js";

const now = "2026-08-10T18:00:00.000Z";

const brief = () =>
  createDesignBrief({
    id: randomUUID(),
    now,
    name: "Campaign launch brief",
    objective: "Launch the agent-human design environment to design leaders.",
    audience: {
      primary: "Design and marketing leaders at growing technology companies",
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
      { id: randomUUID(), role: "headline", text: "Preserve human intent" },
      { id: randomUUID(), role: "cta", text: "Inspect the system" },
    ],
    optionalCopy: [
      {
        id: randomUUID(),
        role: "body",
        text: "Agents propose. Humans refine.",
      },
    ],
    brandContext: {
      description: "Use the pinned cobalt precision-instrument identity.",
      requiredTokenKeys: ["brand.cobalt", "brand.graphite"],
      prohibitedUses: ["Unapproved logo distortion"],
    },
    assetRequirements: [
      {
        id: randomUUID(),
        role: "heroSubject",
        description: "One clear collaborative-system visual.",
        required: true,
      },
    ],
    hierarchyRequirements: [
      {
        id: randomUUID(),
        role: "headline",
        priority: 1,
        description: "Headline must be the first read.",
      },
      {
        id: randomUUID(),
        role: "cta",
        priority: 2,
        description: "CTA follows the supporting claim.",
      },
    ],
    mood: {
      keywords: ["precise", "trustworthy", "editorial"],
      avoid: ["playful gradients", "generic AI glow"],
      notes: "Calm authority with visible structure.",
    },
    constraints: [
      {
        id: randomUUID(),
        priority: "must",
        description: "Preserve approved copy exactly.",
      },
    ],
    accessibilityRequirements: {
      minimumContrastRatio: 4.5,
      requirements: ["No important content inside the 64px edge safety zone"],
      readingOrder: ["headline", "body", "cta", "legalCopy"],
    },
    exportRequirements: [
      {
        id: randomUUID(),
        name: "Campaign PNG",
        format: "png",
        scale: 1,
        transparentBackground: "forbidden",
      },
      {
        id: randomUUID(),
        name: "Review WebP",
        format: "webp",
        scale: 0.5,
        quality: 84,
        transparentBackground: "allowed",
      },
    ],
  });

describe("DesignBrief", () => {
  it("captures bounded non-executable intent without scene operations", () => {
    const value = brief();
    expect(value).toMatchObject({
      createdAt: now,
      updatedAt: now,
      format: { width: 1080, height: 1350, unit: "px" },
      accessibilityRequirements: { minimumContrastRatio: 4.5 },
    });
    expect(DesignBriefSchema.parse(value)).toEqual(value);
    expect(() =>
      DesignBriefSchema.parse({ ...value, script: "deleteAllNodes()" }),
    ).toThrow(/Unrecognized key/);
  });

  it("rejects ambiguous IDs and impossible export intent", () => {
    const value = brief();
    expect(() =>
      DesignBriefSchema.parse({
        ...value,
        optionalCopy: [
          { ...value.optionalCopy[0]!, id: value.requiredCopy[0]!.id },
        ],
      }),
    ).toThrow(/Copy item IDs/);
    expect(() =>
      DesignBriefSchema.parse({
        ...value,
        exportRequirements: [
          {
            id: randomUUID(),
            name: "Impossible JPEG",
            format: "jpeg",
            scale: 1,
            transparentBackground: "required",
          },
        ],
      }),
    ).toThrow(/JPEG cannot require/);
    expect(() =>
      DesignBriefSchema.parse({
        ...value,
        mood: { keywords: [], avoid: [] },
      }),
    ).toThrow(/mood keyword/);
  });

  it("remains optional in legacy schema-1 projects and validates unique names", () => {
    const project = createProjectDocument({
      id: randomUUID(),
      slug: "brief-project",
      name: "Brief project",
      now,
    });
    delete project.designBriefs;
    expect(ProjectDocumentSchema.parse(project).designBriefs).toBeUndefined();
    const first = brief();
    expect(() =>
      ProjectDocumentSchema.parse({
        ...project,
        designBriefs: [first, { ...first, id: randomUUID() }],
      }),
    ).toThrow(/names must be unique/);
  });
});
