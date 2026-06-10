import { describe, expect, test } from "bun:test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { makeFakeCtx, type ScriptedExec } from "./helpers/fakeCtx.js";
import { setupCommand } from "../src/commands/setup.js";
import { removeCommand } from "../src/commands/remove.js";
import { listCommand } from "../src/commands/list.js";
import { testCommand } from "../src/commands/test.js";
import { loadManifest } from "../src/core/manifest.js";
import { tokenize } from "../src/cli/tokenize.js";
import { resolveCommand } from "../src/cli/parse.js";
import { UsageError } from "../src/commands/types.js";

/** scripted ssh-keygen that creates the key pair files (the service mkdirs ~/.ssh first) */
function keygenScript(): ScriptedExec {
  return {
    match: "ssh-keygen",
    result: { code: 0 },
    effect: async (_cmd, args) => {
      const keyPath = args[args.indexOf("-f") + 1]!;
      const email = args[args.indexOf("-C") + 1]!;
      await writeFile(keyPath, "PRIVATE KEY\n");
      await writeFile(`${keyPath}.pub`, `ssh-ed25519 AAAATEST ${email}\n`);
    },
  };
}

const GITHUB_OK: ScriptedExec = {
  match: "ssh -T",
  result: { code: 1, stderr: "Hi vancityAyush! You've successfully authenticated, but GitHub does not provide shell access." },
};

async function runSetup(ctx: Awaited<ReturnType<typeof makeFakeCtx>>, argv: string) {
  const { def, args } = resolveCommand(tokenize(argv));
  return def.run(args, ctx);
}

describe("tokenize", () => {
  test("plain words", () => {
    expect(tokenize("setup github -e a@b.com")).toEqual(["setup", "github", "-e", "a@b.com"]);
  });
  test("double quotes keep spaces", () => {
    expect(tokenize('setup -n "work laptop"')).toEqual(["setup", "-n", "work laptop"]);
  });
  test("single quotes and escapes", () => {
    expect(tokenize("a 'b c' d\\ e")).toEqual(["a", "b c", "d e"]);
  });
  test("empty and whitespace-only", () => {
    expect(tokenize("")).toEqual([]);
    expect(tokenize("   ")).toEqual([]);
  });
  test("empty quoted token survives", () => {
    expect(tokenize('a "" b')).toEqual(["a", "", "b"]);
  });
});

describe("resolveCommand", () => {
  test("unknown command", () => {
    expect(() => resolveCommand(["wat"])).toThrow(UsageError);
  });
  test("unknown flag includes usage", () => {
    try {
      resolveCommand(["list", "--wat"]);
      expect.unreachable();
    } catch (err) {
      expect((err as Error).message).toContain("Usage: xpssh list");
    }
  });
  test("alias lookup", () => {
    expect(resolveCommand(["ls"]).def.name).toBe("list");
  });
  test("setup type validation", () => {
    expect(() => resolveCommand(["setup", "github", "-t", "dsa"])).toThrow(UsageError);
  });
});

describe("setup command", () => {
  test("full pipeline: key, ssh config, manifest, clipboard, browser, test", async () => {
    const ctx = await makeFakeCtx({ script: [] });
    ctx.script.push(keygenScript(), GITHUB_OK);

    const result = await runSetup(ctx, "setup github -n personal -e me@example.com");
    expect(result.ok).toBe(true);
    expect(result.message).toContain("git@github.com:"); // first profile is default → bare alias

    // ssh config written with fenced block + mandatory options
    const config = await readFile(join(ctx.home, ".ssh", "config"), "utf8");
    expect(config).toContain("# >>> xpssh:github-personal >>>");
    expect(config).toContain("Host github.com\n");
    expect(config).toContain("IdentitiesOnly yes");
    expect(config).toContain("UseKeychain yes"); // darwin fake

    // manifest recorded with test result
    const manifest = await loadManifest(ctx.paths.manifest);
    expect(manifest.profiles).toHaveLength(1);
    expect(manifest.profiles[0]!.isDefault).toBe(true);
    expect(manifest.profiles[0]!.lastTest?.ok).toBe(true);

    // clipboard and browser exercised
    expect(ctx.execCalls.some((c) => c.startsWith("pbcopy"))).toBe(true);
    expect(ctx.execCalls.some((c) => c.startsWith("open https://github.com/settings/keys"))).toBe(true);

    // pipeline step events emitted in order
    const steps = ctx.events.filter((e) => e.type === "step" && e.status === "done").map((e) => (e as { id: string }).id);
    expect(steps).toEqual(["generate-key", "write-ssh-config", "save-profile", "deliver-pubkey", "test-connection"]);
  });

  test("second profile for same provider gets host alias, not default", async () => {
    const ctx = await makeFakeCtx();
    ctx.script.push(keygenScript(), GITHUB_OK);
    await runSetup(ctx, "setup github -n personal -e me@example.com");
    const result = await runSetup(ctx, "setup github -n work -e me@work.com");
    expect(result.ok).toBe(true);
    expect(result.message).toContain("git@github.com-work:");

    const config = await readFile(join(ctx.home, ".ssh", "config"), "utf8");
    expect(config).toContain("Host github.com-work");
    const manifest = await loadManifest(ctx.paths.manifest);
    expect(manifest.profiles.find((p) => p.id === "github-work")!.isDefault).toBe(false);
  });

  test("azure uses rsa 4096", async () => {
    const ctx = await makeFakeCtx();
    ctx.script.push(keygenScript(), { match: "ssh -T", result: { code: 1, stderr: "remote: Shell access is not supported." } });
    await runSetup(ctx, "setup azure -n work -e me@corp.com");
    const keygenCall = ctx.execCalls.find((c) => c.startsWith("ssh-keygen"))!;
    expect(keygenCall).toContain("-t rsa");
    expect(keygenCall).toContain("-b 4096");
  });

  test("-y without email errors instead of prompting", async () => {
    const ctx = await makeFakeCtx({ yes: true });
    expect(runSetup(ctx, "setup github -y")).rejects.toThrow(UsageError);
  });

  test("interactive prompts fill provider, name, email", async () => {
    const ctx = await makeFakeCtx({ selectIndex: 1, textAnswers: ["personal", "me@gl.com"] }); // gitlab
    ctx.script.push(keygenScript(), { match: "ssh -T", result: { code: 0, stdout: "Welcome to GitLab, @me!" } });
    const result = await runSetup(ctx, "setup");
    expect(result.ok).toBe(true);
    const manifest = await loadManifest(ctx.paths.manifest);
    expect(manifest.profiles[0]!.id).toBe("gitlab-personal");
  });
});

describe("remove command", () => {
  test("restores ssh config byte-identical and clears manifest", async () => {
    const ctx = await makeFakeCtx();
    ctx.script.push(keygenScript(), GITHUB_OK);

    // pre-existing user content
    await mkdir(join(ctx.home, ".ssh"), { recursive: true });
    const userConfig = "Host myserver\n    HostName 10.0.0.5\n    User admin\n";
    await writeFile(join(ctx.home, ".ssh", "config"), userConfig);

    await runSetup(ctx, "setup github -n personal -e me@example.com");
    const withBlock = await readFile(join(ctx.home, ".ssh", "config"), "utf8");
    expect(withBlock).toContain("xpssh:github-personal");

    const { def, args } = resolveCommand(tokenize("remove github-personal -y"));
    const result = await def.run(args, ctx);
    expect(result.ok).toBe(true);

    const after = await readFile(join(ctx.home, ".ssh", "config"), "utf8");
    expect(after).toBe(userConfig);

    const manifest = await loadManifest(ctx.paths.manifest);
    expect(manifest.profiles).toHaveLength(0);

    // key files gone
    expect(readFile(join(ctx.home, ".ssh", "xpssh_github_personal"), "utf8")).rejects.toThrow();
  });

  test("declined confirmation aborts", async () => {
    const ctx = await makeFakeCtx({ confirmAnswer: false });
    ctx.script.push(keygenScript(), GITHUB_OK);
    await runSetup(ctx, "setup github -n personal -e me@example.com");

    const { def, args } = resolveCommand(tokenize("remove github-personal"));
    const result = await def.run(args, ctx);
    expect(result.ok).toBe(false);
    const config = await readFile(join(ctx.home, ".ssh", "config"), "utf8");
    expect(config).toContain("xpssh:github-personal");
  });
});

describe("list command", () => {
  test("empty state", async () => {
    const ctx = await makeFakeCtx();
    const result = await listCommand.run({ json: false }, ctx);
    expect(result.ok).toBe(true);
    expect(result.message).toContain("xpssh setup");
  });

  test("json output includes liveness", async () => {
    const ctx = await makeFakeCtx();
    ctx.script.push(keygenScript(), GITHUB_OK);
    await runSetup(ctx, "setup github -n personal -e me@example.com");

    await listCommand.run({ json: true }, ctx);
    const jsonEvent = ctx.events.findLast((e) => e.type === "info")!;
    const payload = JSON.parse((jsonEvent as { text: string }).text);
    expect(payload.profiles[0].keyExists).toBe(true);
    expect(payload.profiles[0].clonePrefix).toBe("git@github.com:");
  });
});

describe("test command", () => {
  test("updates lastTest and fails on permission denied", async () => {
    const ctx = await makeFakeCtx();
    ctx.script.push(keygenScript(), GITHUB_OK);
    await runSetup(ctx, "setup github -n personal -e me@example.com");

    // now make ssh fail
    ctx.script.length = 0;
    ctx.script.push({ match: "ssh -T", result: { code: 255, stderr: "git@github.com: Permission denied (publickey)." } });

    const { def, args } = resolveCommand(tokenize("test github-personal"));
    const result = await def.run(args, ctx);
    expect(result.ok).toBe(false);

    const manifest = await loadManifest(ctx.paths.manifest);
    expect(manifest.profiles[0]!.lastTest?.ok).toBe(false);
  });

  test("unknown profile is a usage error", async () => {
    const ctx = await makeFakeCtx();
    ctx.script.push(keygenScript(), GITHUB_OK);
    await runSetup(ctx, "setup github -n personal -e me@example.com");
    const { def, args } = resolveCommand(tokenize("test nope"));
    expect(def.run(args, ctx)).rejects.toThrow(UsageError);
  });
});
