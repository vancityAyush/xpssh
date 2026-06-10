import { describe, expect, test } from "bun:test";
import { chmod, readFile, stat, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { makeFakeCtx, type FakeCtx, type ScriptedExec } from "./helpers/fakeCtx.js";
import { doctorCommand } from "../src/commands/doctor.js";
import { tokenize } from "../src/cli/tokenize.js";
import { resolveCommand } from "../src/cli/parse.js";

/** scripted ssh-keygen that creates the key pair files (private key 600, like the real tool) */
function keygenScript(): ScriptedExec {
  return {
    match: "ssh-keygen",
    result: { code: 0 },
    effect: async (_cmd, args) => {
      const keyPath = args[args.indexOf("-f") + 1]!;
      const email = args[args.indexOf("-C") + 1]!;
      await writeFile(keyPath, "PRIVATE KEY\n", { mode: 0o600 });
      await writeFile(`${keyPath}.pub`, `ssh-ed25519 AAAATEST ${email}\n`);
    },
  };
}

const GITHUB_OK: ScriptedExec = {
  match: "ssh -T",
  result: { code: 1, stderr: "Hi vancityAyush! You've successfully authenticated, but GitHub does not provide shell access." },
};

/** Fresh ctx with one github-personal profile created through the real setup command. */
async function setupProfile(): Promise<FakeCtx> {
  const ctx = await makeFakeCtx();
  ctx.script.push(keygenScript(), GITHUB_OK);
  const { def, args } = resolveCommand(tokenize("setup github -n personal -e me@example.com"));
  const result = await def.run(args, ctx);
  expect(result.ok).toBe(true);
  return ctx;
}

/** Run doctor with a clean event log so assertions only see this run. */
function runDoctor(ctx: FakeCtx, fix = false) {
  ctx.events.length = 0;
  return doctorCommand.run({ fix }, ctx);
}

const configPath = (ctx: FakeCtx) => join(ctx.home, ".ssh", "config");
const warns = (ctx: FakeCtx) =>
  ctx.events.filter((e) => e.type === "warn").map((e) => (e as { text: string }).text);

describe("doctor command", () => {
  test("clean state reports no issues", async () => {
    const ctx = await setupProfile();
    const result = await runDoctor(ctx);
    expect(result.ok).toBe(true);
    expect(result.message).toBe("No issues found");
    expect(warns(ctx)).toHaveLength(0);
  });

  test("missing managed block: reported, --fix re-adds it", async () => {
    const ctx = await setupProfile();
    const userOnly = "Host myserver\n    HostName 10.0.0.5\n";
    await writeFile(configPath(ctx), userOnly);

    const report = await runDoctor(ctx);
    expect(report.ok).toBe(false);
    expect(warns(ctx)).toContain("github-personal: missing ssh config block");

    const repair = await runDoctor(ctx, true);
    expect(repair.ok).toBe(true);
    expect(repair.message).toBe("1 issue found, 1 fixed");
    const config = await readFile(configPath(ctx), "utf8");
    expect(config).toContain("# >>> xpssh:github-personal >>>");
    expect(config).toContain("Host github.com");
    expect(config).toContain(userOnly); // user content untouched
  });

  test("orphan fenced block: reported, --fix removes it and keeps user content", async () => {
    const ctx = await setupProfile();
    const userLine = "Host myserver\n    HostName 10.0.0.5\n";
    const ghost =
      "# >>> xpssh:github-ghost >>>\nHost github.com-ghost\n    HostName github.com\n# <<< xpssh:github-ghost <<<\n";
    const before = await readFile(configPath(ctx), "utf8");
    await writeFile(configPath(ctx), `${before}\n${userLine}\n${ghost}`);

    const report = await runDoctor(ctx);
    expect(report.ok).toBe(false);
    expect(warns(ctx)).toContain('orphan ssh config block "github-ghost"');

    const repair = await runDoctor(ctx, true);
    expect(repair.ok).toBe(true);
    const config = await readFile(configPath(ctx), "utf8");
    expect(config).not.toContain("github-ghost");
    expect(config).toContain(userLine);
    expect(config).toContain("# >>> xpssh:github-personal >>>");
  });

  test("missing key file: warns with setup --force suggestion, not fixable", async () => {
    const ctx = await setupProfile();
    await unlink(join(ctx.home, ".ssh", "xpssh_github_personal"));

    const result = await runDoctor(ctx, true);
    expect(result.ok).toBe(false); // --fix never regenerates keys
    expect(result.message).toBe("1 issue found, 0 fixed");
    const warn = warns(ctx).find((t) => t.includes("key file missing (~/.ssh/xpssh_github_personal)"));
    expect(warn).toContain("xpssh setup github -n personal --force");
    expect(warn).toContain("xpssh remove github-personal --keep-key");
  });

  test("loose ssh config permissions: warns, --fix restores 600", async () => {
    const ctx = await setupProfile();
    await chmod(configPath(ctx), 0o644);

    const report = await runDoctor(ctx);
    expect(report.ok).toBe(false);
    expect(warns(ctx).some((t) => t.includes("permissions too open (644)"))).toBe(true);

    const repair = await runDoctor(ctx, true);
    expect(repair.ok).toBe(true);
    expect((await stat(configPath(ctx))).mode & 0o777).toBe(0o600);
  });

  test("alias shadowed by an earlier user Host entry", async () => {
    const ctx = await setupProfile();
    const before = await readFile(configPath(ctx), "utf8");
    await writeFile(configPath(ctx), `Host github.com\n    User nobody\n\n${before}`);

    const result = await runDoctor(ctx);
    expect(result.ok).toBe(false); // not auto-fixable
    expect(warns(ctx).some((t) => t.includes("alias github.com may be shadowed"))).toBe(true);
  });

  test("broken fences: hard error, config left untouched", async () => {
    const ctx = await setupProfile();
    const intact = await readFile(configPath(ctx), "utf8");
    const broken = intact.replace("# <<< xpssh:github-personal <<<\n", "");
    await writeFile(configPath(ctx), broken);

    const result = await runDoctor(ctx, true);
    expect(result.ok).toBe(false);
    expect(result.message).toContain("broken xpssh fences");
    const errors = ctx.events.filter((e) => e.type === "error").map((e) => (e as { text: string }).text);
    expect(errors.some((t) => t.includes("Unclosed xpssh fence"))).toBe(true);
    expect(await readFile(configPath(ctx), "utf8")).toBe(broken);
  });

  test("mixed findings: counts unfixable issues in the result", async () => {
    const ctx = await setupProfile();
    await unlink(join(ctx.home, ".ssh", "xpssh_github_personal")); // unfixable
    await chmod(configPath(ctx), 0o644); // fixable

    const result = await runDoctor(ctx, true);
    expect(result.ok).toBe(false);
    expect(result.message).toBe("2 issues found, 1 fixed");
    expect((await stat(configPath(ctx))).mode & 0o777).toBe(0o600);
  });
});
