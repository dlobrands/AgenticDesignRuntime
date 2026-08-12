import { z } from "zod";

const hash = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const identifier = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/);
const semver = z
  .string()
  .regex(
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/,
  );
const httpsUrl = z
  .string()
  .url()
  .refine((value) => new URL(value).protocol === "https:", {
    message: "Expected an HTTPS URL.",
  });

export const UpdateChannelSchema = z.enum(["stable", "preview", "nightly"]);
export const UpdateManifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    product: z.literal("Agentic Design Runtime"),
    releaseId: identifier,
    sequence: z.number().int().positive(),
    channel: UpdateChannelSchema,
    version: semver,
    publishedAt: z.string().datetime(),
    officialOrigin: httpsUrl,
    platform: z.enum(["darwin", "linux", "win32"]),
    architecture: z.enum(["arm64", "x64"]),
    compatibility: z
      .object({
        runtimeApi: z
          .object({
            min: z.number().int().positive(),
            max: z.number().int().positive(),
          })
          .strict(),
        workspaceSchema: z
          .object({
            min: z.number().int().positive(),
            max: z.number().int().positive(),
          })
          .strict(),
        plugin: z.object({ min: semver, max: semver }).strict(),
      })
      .strict(),
    artifact: z
      .object({
        url: httpsUrl,
        format: z.literal("adr-runtime-bundle-v1"),
        sha256: hash,
        sizeBytes: z
          .number()
          .int()
          .positive()
          .max(2 * 1024 * 1024 * 1024),
        entrypoint: z.literal("bin/design-runtime"),
      })
      .strict(),
    provenance: z
      .object({
        predicateType: z.string().min(1).max(500),
        builderId: z.string().min(1).max(500),
        sourceRepository: httpsUrl,
        sourceRevision: z.string().regex(/^[a-f0-9]{40,64}$/),
        artifactSha256: hash,
      })
      .strict(),
    signature: z
      .object({
        algorithm: z.literal("ed25519"),
        keyId: identifier,
        value: z.string().min(40).max(500),
      })
      .strict(),
    releaseNotes: z.string().min(1).max(20_000),
    migration: z
      .object({
        required: z.boolean(),
        fromWorkspaceSchema: z.number().int().positive(),
        toWorkspaceSchema: z.number().int().positive(),
        reversible: z.boolean(),
        migratorId: z
          .string()
          .regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/)
          .optional(),
      })
      .strict(),
  })
  .strict()
  .superRefine((manifest, context) => {
    if (
      manifest.compatibility.runtimeApi.min >
      manifest.compatibility.runtimeApi.max
    )
      context.addIssue({
        code: "custom",
        message: "Runtime API compatibility range is inverted.",
        path: ["compatibility", "runtimeApi"],
      });
    if (
      manifest.compatibility.workspaceSchema.min >
      manifest.compatibility.workspaceSchema.max
    )
      context.addIssue({
        code: "custom",
        message: "Workspace schema compatibility range is inverted.",
        path: ["compatibility", "workspaceSchema"],
      });
    if (manifest.provenance.artifactSha256 !== manifest.artifact.sha256)
      context.addIssue({
        code: "custom",
        message: "Provenance artifact hash must match the release artifact.",
        path: ["provenance", "artifactSha256"],
      });
    if (
      manifest.migration.required &&
      (!manifest.migration.reversible || !manifest.migration.migratorId)
    )
      context.addIssue({
        code: "custom",
        message: "Required migrations need an explicit reversible migrator.",
        path: ["migration"],
      });
  });

export type UpdateManifest = z.infer<typeof UpdateManifestSchema>;

export const TrustedUpdateConfigurationSchema = z
  .object({
    schemaVersion: z.literal(1),
    officialOrigin: httpsUrl,
    manifestUrl: httpsUrl,
    channel: UpdateChannelSchema,
    publicKeys: z.record(z.string(), z.string().min(40).max(500)),
    requiredPredicateType: z.string().min(1).max(500),
    requiredBuilderId: z.string().min(1).max(500),
    sourceRepository: httpsUrl,
  })
  .strict();
export type TrustedUpdateConfiguration = z.infer<
  typeof TrustedUpdateConfigurationSchema
>;

export const UpdateStateSchema = z
  .object({
    schemaVersion: z.literal(1),
    highestSequence: z.number().int().nonnegative(),
    current: z
      .object({
        version: semver,
        releaseId: identifier,
        installPath: z.string(),
        sequence: z.number().int().nonnegative(),
        entrypoint: z.string(),
        invocation: z.enum(["node", "executable"]),
        manifestHash: hash.optional(),
      })
      .strict()
      .optional(),
    previous: z
      .object({
        version: semver,
        releaseId: identifier,
        installPath: z.string(),
        sequence: z.number().int().nonnegative(),
        entrypoint: z.string(),
        invocation: z.enum(["node", "executable"]),
        manifestHash: hash.optional(),
      })
      .strict()
      .optional(),
    staged: z
      .object({
        version: semver,
        releaseId: identifier,
        stagingPath: z.string(),
        sequence: z.number().int().positive(),
        manifestHash: hash,
      })
      .strict()
      .optional(),
  })
  .strict();
export type UpdateState = z.infer<typeof UpdateStateSchema>;

export const unsignedUpdateManifest = (
  manifest: UpdateManifest,
): Omit<UpdateManifest, "signature"> => {
  const { signature, ...unsigned } = manifest;
  void signature;
  return unsigned;
};

const parseSemver = (
  value: string,
): [number, number, number, string[] | undefined] => {
  const match = semver.parse(value).match(/^(\d+)\.(\d+)\.(\d+)(?:-(.+))?$/)!;
  return [
    Number(match[1]),
    Number(match[2]),
    Number(match[3]),
    match[4]?.split("."),
  ];
};

export const compareSemver = (left: string, right: string): number => {
  const a = parseSemver(left);
  const b = parseSemver(right);
  for (let index = 0; index < 3; index += 1)
    if (a[index] !== b[index])
      return (a[index] as number) - (b[index] as number);
  if (a[3] === b[3]) return 0;
  if (a[3] === undefined) return 1;
  if (b[3] === undefined) return -1;
  const length = Math.max(a[3].length, b[3].length);
  for (let index = 0; index < length; index += 1) {
    const leftIdentifier = a[3][index];
    const rightIdentifier = b[3][index];
    if (leftIdentifier === undefined) return -1;
    if (rightIdentifier === undefined) return 1;
    if (leftIdentifier === rightIdentifier) continue;
    const leftNumeric = /^\d+$/.test(leftIdentifier);
    const rightNumeric = /^\d+$/.test(rightIdentifier);
    if (leftNumeric && rightNumeric)
      return Number(leftIdentifier) - Number(rightIdentifier);
    if (leftNumeric) return -1;
    if (rightNumeric) return 1;
    return leftIdentifier.localeCompare(rightIdentifier);
  }
  return 0;
};
