import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { z } from "zod";
import type { Profile } from "./profile.js";

const profileSchema = z.object({
  id: z.string().min(1),
  provider: z.enum(["github", "gitlab", "bitbucket", "azure"]),
  name: z.string().min(1),
  email: z.string(),
  alias: z.string().min(1),
  keyPath: z.string().min(1),
  keyType: z.enum(["ed25519", "rsa"]),
  isDefault: z.boolean(),
  createdAt: z.string(),
  lastTest: z
    .object({ ok: z.boolean(), at: z.string(), message: z.string() })
    .optional(),
  gitDirs: z.array(z.string()).default([]),
  uploaded: z
    .object({ via: z.enum(["api", "manual"]), at: z.string() })
    .optional(),
});

const manifestSchema = z.object({
  version: z.literal(1),
  profiles: z.array(profileSchema),
});

export interface Manifest {
  version: 1;
  profiles: Profile[];
}

export class ManifestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ManifestError";
  }
}

export async function loadManifest(manifestPath: string): Promise<Manifest> {
  let raw: string;
  try {
    raw = await readFile(manifestPath, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return { version: 1, profiles: [] };
    }
    throw err;
  }
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new ManifestError(`${manifestPath} is not valid JSON — fix or delete it`);
  }
  const parsed = manifestSchema.safeParse(json);
  if (!parsed.success) {
    throw new ManifestError(`${manifestPath} failed validation: ${parsed.error.issues[0]?.message}`);
  }
  return parsed.data as Manifest;
}

/** Atomic write: tmp file in the same dir, then rename. */
export async function saveManifest(manifestPath: string, manifest: Manifest): Promise<void> {
  manifestSchema.parse(manifest);
  await mkdir(dirname(manifestPath), { recursive: true });
  const tmp = join(dirname(manifestPath), `.profiles.json.tmp-${process.pid}`);
  await writeFile(tmp, JSON.stringify(manifest, null, 2) + "\n", { mode: 0o600 });
  await rename(tmp, manifestPath);
}

export function findProfile(manifest: Manifest, idOrAlias: string): Profile | undefined {
  return manifest.profiles.find((p) => p.id === idOrAlias || p.alias === idOrAlias);
}

/** Insert or replace by id; enforces one default per provider. */
export function upsertProfile(manifest: Manifest, profile: Profile): Manifest {
  if (profile.isDefault) {
    const clash = manifest.profiles.find(
      (p) => p.provider === profile.provider && p.isDefault && p.id !== profile.id,
    );
    if (clash) {
      throw new ManifestError(
        `${clash.id} is already the default for ${profile.provider} — remove it or set up without --default`,
      );
    }
  }
  const rest = manifest.profiles.filter((p) => p.id !== profile.id);
  return { ...manifest, profiles: [...rest, profile] };
}

export function removeProfile(manifest: Manifest, id: string): Manifest {
  return { ...manifest, profiles: manifest.profiles.filter((p) => p.id !== id) };
}
