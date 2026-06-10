import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  clonePrefix,
  deriveAlias,
  deriveKeyPath,
  deriveProfileId,
  sanitizeName,
  type Profile,
} from "../src/core/profile.js";
import {
  findProfile,
  loadManifest,
  ManifestError,
  removeProfile,
  saveManifest,
  upsertProfile,
  type Manifest,
} from "../src/core/manifest.js";
import { classifyTestOutput, parseAgentList } from "../src/core/sshOutput.js";
import { getProvider, PROVIDERS } from "../src/core/providers/index.js";
import { contractTilde, expandTilde, resolvePaths } from "../src/platform/paths.js";

const PROFILE: Profile = {
  id: "github-work",
  provider: "github",
  name: "work",
  email: "a@b.com",
  alias: "github.com-work",
  keyPath: "~/.ssh/xpssh_github_work",
  keyType: "ed25519",
  isDefault: false,
  createdAt: "2026-06-10T00:00:00Z",
  gitDirs: [],
};

describe("profile derivation", () => {
  test("sanitizeName", () => {
    expect(sanitizeName("Work Laptop!")).toBe("work-laptop");
    expect(sanitizeName("--weird--")).toBe("weird");
    expect(sanitizeName("a__b")).toBe("a-b");
  });

  test("id, alias, keyPath", () => {
    expect(deriveProfileId("github", "Work")).toBe("github-work");
    expect(deriveAlias("github.com", "work", false)).toBe("github.com-work");
    expect(deriveAlias("github.com", "work", true)).toBe("github.com");
    expect(deriveKeyPath("github", "my-work")).toBe("~/.ssh/xpssh_github_my_work");
  });

  test("clonePrefix", () => {
    expect(clonePrefix(PROFILE)).toBe("git@github.com-work:");
  });
});

describe("providers", () => {
  test("registry covers all four", () => {
    expect(PROVIDERS.map((p) => p.id)).toEqual(["github", "gitlab", "bitbucket", "azure"]);
  });

  test("fuzzy lookup", () => {
    expect(getProvider("gh")?.id).toBe("github");
    expect(getProvider("GitLab")?.id).toBe("gitlab");
    expect(getProvider("ado")?.id).toBe("azure");
    expect(getProvider("nope")).toBeUndefined();
  });

  test("azure is rsa + manual-only", () => {
    const azure = getProvider("azure")!;
    expect(azure.keyType).toBe("rsa");
    expect(azure.api).toBeNull();
  });

  test("github upload request shape", () => {
    const req = getProvider("github")!.api!.buildUploadRequest("tok", "my key", "ssh-ed25519 AAA");
    expect(req.url).toBe("https://api.github.com/user/keys");
    expect(req.headers["Authorization"]).toBe("Bearer tok");
    expect(JSON.parse(req.body)).toEqual({ title: "my key", key: "ssh-ed25519 AAA" });
  });

  test("bitbucket request carries uuid placeholder", () => {
    const req = getProvider("bb")!.api!.buildUploadRequest("tok", "t", "k");
    expect(req.url).toContain("{uuid}");
  });
});

describe("manifest", () => {
  test("load returns empty manifest when file missing", async () => {
    const dir = await mkdtemp(join(tmpdir(), "xpssh-test-"));
    const manifest = await loadManifest(join(dir, "profiles.json"));
    expect(manifest).toEqual({ version: 1, profiles: [] });
  });

  test("save/load round-trip with 0600 perms", async () => {
    const dir = await mkdtemp(join(tmpdir(), "xpssh-test-"));
    const path = join(dir, "nested", "profiles.json");
    await saveManifest(path, { version: 1, profiles: [PROFILE] });
    const loaded = await loadManifest(path);
    expect(loaded.profiles[0]).toEqual(PROFILE);
    expect((await readFile(path, "utf8")).endsWith("\n")).toBe(true);
  });

  test("rejects corrupt JSON with a clear error", async () => {
    const dir = await mkdtemp(join(tmpdir(), "xpssh-test-"));
    const path = join(dir, "profiles.json");
    await Bun.write(path, "{nope");
    expect(loadManifest(path)).rejects.toThrow(ManifestError);
  });

  test("upsert replaces by id and enforces single default per provider", () => {
    let manifest: Manifest = { version: 1, profiles: [{ ...PROFILE, isDefault: true }] };
    manifest = upsertProfile(manifest, { ...PROFILE, email: "new@b.com", isDefault: true });
    expect(manifest.profiles).toHaveLength(1);
    expect(manifest.profiles[0]!.email).toBe("new@b.com");

    expect(() =>
      upsertProfile(manifest, { ...PROFILE, id: "github-personal", name: "personal", isDefault: true }),
    ).toThrow(ManifestError);
  });

  test("find by id or alias, remove by id", () => {
    const manifest: Manifest = { version: 1, profiles: [PROFILE] };
    expect(findProfile(manifest, "github-work")?.id).toBe("github-work");
    expect(findProfile(manifest, "github.com-work")?.id).toBe("github-work");
    expect(removeProfile(manifest, "github-work").profiles).toHaveLength(0);
  });
});

describe("classifyTestOutput", () => {
  test("github greeting (exit 1)", () => {
    const r = classifyTestOutput(1, "", "Hi vancityAyush! You've successfully authenticated, but GitHub does not provide shell access.");
    expect(r.ok).toBe(true);
    expect(r.message).toContain("Hi vancityAyush!");
  });

  test("gitlab welcome (exit 0)", () => {
    const r = classifyTestOutput(0, "Welcome to GitLab, @ayush!", "");
    expect(r.ok).toBe(true);
  });

  test("azure shell-not-supported", () => {
    const r = classifyTestOutput(1, "", "remote: Shell access is not supported.");
    expect(r.ok).toBe(true);
  });

  test("permission denied beats exit-code heuristic", () => {
    const r = classifyTestOutput(255, "", "git@github.com: Permission denied (publickey).");
    expect(r.ok).toBe(false);
    expect(r.message).toContain("not registered");
  });

  test("network failure", () => {
    const r = classifyTestOutput(255, "", "ssh: Could not resolve hostname github.com");
    expect(r.ok).toBe(false);
  });
});

describe("parseAgentList", () => {
  test("parses keys", () => {
    const out = "256 SHA256:abcdef ayush@mac (ED25519)\n3072 SHA256:xyz work key (RSA)\n";
    const keys = parseAgentList(out);
    expect(keys).toHaveLength(2);
    expect(keys[0]).toEqual({ bits: 256, fingerprint: "SHA256:abcdef", comment: "ayush@mac", type: "ED25519" });
    expect(keys[1]!.comment).toBe("work key");
  });

  test("empty agent", () => {
    expect(parseAgentList("The agent has no identities.\n")).toEqual([]);
  });
});

describe("paths", () => {
  test("XPSSH_CONFIG_DIR wins, then XDG, then ~/.config", () => {
    expect(resolvePaths({ HOME: "/h", XPSSH_CONFIG_DIR: "/custom" }).configDir).toBe("/custom");
    expect(resolvePaths({ HOME: "/h", XDG_CONFIG_HOME: "/xdg" }).configDir).toBe("/xdg/xpssh");
    expect(resolvePaths({ HOME: "/h" }).configDir).toBe("/h/.config/xpssh");
    expect(resolvePaths({ HOME: "/h" }).sshConfig).toBe("/h/.ssh/config");
  });

  test("tilde expand/contract", () => {
    expect(expandTilde("~/.ssh/key", "/h")).toBe("/h/.ssh/key");
    expect(expandTilde("/abs", "/h")).toBe("/abs");
    expect(contractTilde("/h/.ssh/key", "/h")).toBe("~/.ssh/key");
    expect(contractTilde("/elsewhere", "/h")).toBe("/elsewhere");
  });
});
