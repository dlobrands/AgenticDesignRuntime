import { describe, expect, it } from "vitest";
import {
  FrameDocumentSchema,
  analyzeSemanticConflict,
  createFrameDocument,
  semanticChanges,
  simulateFrameOperations,
} from "../src/index";

const frame = () =>
  createFrameDocument({
    id: "11111111-1111-4111-8111-111111111111",
    slug: "guided-frame",
    name: "Guided frame",
    width: 1080,
    height: 1350,
    now: "2026-08-10T12:00:00.000Z",
  });

describe("canvas guides and safe areas", () => {
  it("keeps legacy schema-1 frames valid and validates bounded metadata", () => {
    expect(FrameDocumentSchema.safeParse(frame()).success).toBe(true);
    const valid = structuredClone(frame());
    valid.canvas.guides = [
      {
        id: "22222222-2222-4222-8222-222222222222",
        axis: "vertical",
        position: 120,
      },
      {
        id: "33333333-3333-4333-8333-333333333333",
        axis: "horizontal",
        position: 240,
      },
    ];
    valid.canvas.safeArea = { top: 90, right: 72, bottom: 90, left: 72 };
    expect(FrameDocumentSchema.safeParse(valid).success).toBe(true);

    const duplicate = structuredClone(valid);
    duplicate.canvas.guides![1]!.id = duplicate.canvas.guides![0]!.id;
    expect(FrameDocumentSchema.safeParse(duplicate).success).toBe(false);
    const outside = structuredClone(valid);
    outside.canvas.guides![0]!.position = 1081;
    expect(FrameDocumentSchema.safeParse(outside).success).toBe(false);
    const collapsed = structuredClone(valid);
    collapsed.canvas.safeArea = {
      top: 0,
      right: 540,
      bottom: 0,
      left: 540,
    };
    expect(FrameDocumentSchema.safeParse(collapsed).success).toBe(false);
  });

  it("commits and reverses metadata through one setCanvas operation", () => {
    const source = frame();
    const changed = simulateFrameOperations(source, [
      {
        kind: "setCanvas",
        value: {
          guides: [
            {
              id: "22222222-2222-4222-8222-222222222222",
              axis: "vertical",
              position: 240,
            },
          ],
          safeArea: { top: 90, right: 72, bottom: 90, left: 72 },
        },
      },
    ]);
    expect(changed.frame.canvas).toMatchObject({
      guides: [{ axis: "vertical", position: 240 }],
      safeArea: { top: 90, right: 72, bottom: 90, left: 72 },
    });
    expect(
      simulateFrameOperations(changed.frame, changed.inverseOperations).frame,
    ).toEqual(source);
  });

  it("classifies guide and safe-area edits as independent semantic properties", () => {
    const source = frame();
    const withGuide = simulateFrameOperations(source, [
      {
        kind: "setCanvas",
        value: {
          guides: [
            {
              id: "22222222-2222-4222-8222-222222222222",
              axis: "vertical",
              position: 240,
            },
          ],
        },
      },
    ]).frame;
    const withSafeArea = simulateFrameOperations(source, [
      {
        kind: "setCanvas",
        value: { safeArea: { top: 90, right: 72, bottom: 90, left: 72 } },
      },
    ]).frame;
    expect(semanticChanges(source, withGuide)).toEqual([
      expect.objectContaining({ property: "frame.canvas.guides" }),
    ]);
    expect(
      analyzeSemanticConflict(source, withGuide, withSafeArea)
        .conflictingProperties,
    ).toEqual([]);
  });
});
