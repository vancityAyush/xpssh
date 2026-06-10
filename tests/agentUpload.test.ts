import { describe, expect, test } from "bun:test";
import { writeFile } from "node:fs/promises";
import { makeFakeCtx, type FakeCtx, type ScriptedExec } from "./helpers/fakeCtx.js";
import { agentCommand } from "../src/commands/agent.js";
import { uploadCommand } from "../src/commands/upload.js";
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

async function runSetup(ctx: FakeCtx, argv: string) {
  const { def, args } = resolveCommand(tokenize(argv));
  return def.run(args, ctx);
}

/** create the github-personal fixture profile (email me@example.com) through the real setup command */
async function setupGithubProfile(ctx: FakeCtx) {
  ctx.script.push(keygenScript(), GITHUB_OK);
  const result = await runSetup(ctx, "setup github -n personal -e me@example.com");
  expect(result.ok).toBe(true);
}

/** agent/upload are not in the registry, so drive them through their own parse() + run() */
async function runAgent(ctx: FakeCtx, positionals: string[]) {
  return agentCommand.run(agentCommand.parse(positionals, {}), ctx);
}

async function runUpload(ctx: FakeCtx, positionals: string[], values: Record<string, string | boolean | undefined> = {}) {
  return uploadCommand.run(uploadCommand.parse(positionals, values), ctx);
}

describe("agent command", () => {
  test("bare agent defaults to list and reports a stopped agent", async () => {
    const ctx = await makeFakeCtx({ script: [{ match: "ssh-add -l", result: { code: 2 } }] });
    const result = await runAgent(ctx, []);
    expect(result.ok).toBe(true);
    expect(result.message).toContain("not running");
    expect(result.message).toContain("xpssh agent start");
  });

  test("list shows keys and cross-references manifest profiles by email", async () => {
    const ctx = await makeFakeCtx();
    await setupGithubProfile(ctx);

    ctx.script.length = 0;
    ctx.script.push({
      match: "ssh-add -l",
      result: {
        code: 0,
        stdout: "256 SHA256:abc me@example.com (ED25519)\n256 SHA256:xyz stranger@elsewhere.dev (ED25519)\n",
      },
    });
    ctx.events.length = 0;

    const result = await runAgent(ctx, ["list"]);
    expect(result.ok).toBe(true);
    const lines = ctx.events.filter((e) => e.type === "info").map((e) => (e as { text: string }).text);
    expect(lines).toEqual([
      "256 ED25519 SHA256:abc me@example.com ← github-personal",
      "256 ED25519 SHA256:xyz stranger@elsewhere.dev",
    ]);
  });

  test("list reports a running agent with no keys", async () => {
    const ctx = await makeFakeCtx({ script: [{ match: "ssh-add -l", result: { code: 1 } }] });
    const result = await runAgent(ctx, ["list"]);
    expect(result.ok).toBe(true);
    expect(result.message).toBe("Agent running, no keys loaded");
  });

  test("add loads the key via Keychain on darwin", async () => {
    const ctx = await makeFakeCtx(); // darwin fake → hasKeychain
    await setupGithubProfile(ctx);

    // getAgentStatus runs `ssh-add -l` before the add; more specific matches first
    ctx.script.length = 0;
    ctx.script.push(
      { match: "ssh-add -l", result: { code: 0, stdout: "" } },
      { match: "ssh-add --apple-use-keychain", result: { code: 0 } },
    );
    ctx.execCalls.length = 0;

    const result = await runAgent(ctx, ["add", "github-personal"]);
    expect(result.ok).toBe(true);
    expect(result.message).toContain("Keychain");
    expect(ctx.execCalls.some((c) => c.includes("--apple-use-keychain"))).toBe(true);
    expect(ctx.execCalls.some((c) => c.includes("xpssh_github_personal"))).toBe(true);
  });

  test("add with unknown profile is a usage error", async () => {
    const ctx = await makeFakeCtx();
    await expect(runAgent(ctx, ["add", "nope"])).rejects.toThrow(UsageError);
    await expect(runAgent(ctx, ["add", "nope"])).rejects.toThrow("xpssh list");
  });

  test("add fails cleanly when the agent cannot be started", async () => {
    const ctx = await makeFakeCtx();
    await setupGithubProfile(ctx);
    ctx.script.length = 0;
    ctx.script.push(
      { match: "ssh-add -l", result: { code: 2 } },
      { match: "ssh-agent -s", result: { code: 1 } },
    );
    const result = await runAgent(ctx, ["add", "github-personal"]);
    expect(result.ok).toBe(false);
    expect(result.message).toBe("Could not start ssh-agent");
  });

  test("remove reports a key that is not loaded", async () => {
    const ctx = await makeFakeCtx();
    await setupGithubProfile(ctx);
    ctx.script.length = 0;
    ctx.script.push({ match: "ssh-add -d", result: { code: 1 } });
    const result = await runAgent(ctx, ["remove", "github-personal"]);
    expect(result.ok).toBe(false);
    expect(result.message).toContain("not loaded");
  });

  test("start reports a running agent", async () => {
    const ctx = await makeFakeCtx({ script: [{ match: "ssh-add -l", result: { code: 0 } }] });
    const result = await runAgent(ctx, ["start"]);
    expect(result.ok).toBe(true);
  });

  test("bogus subcommand is a usage error listing valid ones", () => {
    expect(() => agentCommand.parse(["bogus"], {})).toThrow(UsageError);
    expect(() => agentCommand.parse(["bogus"], {})).toThrow("list, add, remove, start");
  });
});

describe("upload command", () => {
  test("happy path uploads the key and records uploaded.via api", async () => {
    const ctx = await makeFakeCtx({ fetchResponses: [{ status: 201, body: {} }] });
    await setupGithubProfile(ctx);

    const result = await runUpload(ctx, ["github-personal"], { token: "tok123" });
    expect(result.ok).toBe(true);
    expect(result.message).toContain("GitHub");

    const manifest = await loadManifest(ctx.paths.manifest);
    expect(manifest.profiles[0]!.uploaded?.via).toBe("api");
  });

  test("azure has no upload API: fails with settings URL and never fetches", async () => {
    const ctx = await makeFakeCtx();
    ctx.script.push(keygenScript(), { match: "ssh -T", result: { code: 1, stderr: "remote: Shell access is not supported." } });
    await runSetup(ctx, "setup azure -n work -e me@corp.com");

    let fetchCalls = 0;
    const realFetch = ctx.fetch;
    ctx.fetch = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      fetchCalls += 1;
      return realFetch(input, init);
    }) as typeof fetch;

    const result = await runUpload(ctx, ["azure-work"]);
    expect(result.ok).toBe(false);
    expect(result.message).toContain("https://dev.azure.com/_usersSettings/keys");
    expect(fetchCalls).toBe(0);
  });

  test("401 from the provider surfaces the token hint", async () => {
    const ctx = await makeFakeCtx({ fetchResponses: [{ status: 401, body: { message: "Bad credentials" } }] });
    await setupGithubProfile(ctx);

    const result = await runUpload(ctx, ["github-personal"], { token: "badtok" });
    expect(result.ok).toBe(false);
    expect(result.message).toContain("admin:public_key");

    const manifest = await loadManifest(ctx.paths.manifest);
    expect(manifest.profiles[0]!.uploaded).toBeUndefined();
  });

  test("no token with -y is a usage error naming the env var", async () => {
    // textAnswers would satisfy a prompt — proves promptSecret is skipped under -y
    const ctx = await makeFakeCtx({ yes: true, textAnswers: ["should-not-be-used"] });
    await setupGithubProfile(ctx);
    await expect(runUpload(ctx, ["github-personal"])).rejects.toThrow(UsageError);
    await expect(runUpload(ctx, ["github-personal"])).rejects.toThrow("XPSSH_TOKEN_GITHUB");
  });

  test("prompts for the token when interactive", async () => {
    const ctx = await makeFakeCtx({ fetchResponses: [{ status: 201, body: {} }], textAnswers: ["sekret-token"] });
    await setupGithubProfile(ctx);
    const result = await runUpload(ctx, ["github-personal"]);
    expect(result.ok).toBe(true);
  });

  test("missing <profile> is a usage error", async () => {
    const ctx = await makeFakeCtx();
    await expect(runUpload(ctx, [])).rejects.toThrow(UsageError);
  });
});
