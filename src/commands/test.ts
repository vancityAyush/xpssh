import { defineCommand, UsageError } from "./types.js";
import { findProfile, loadManifest, saveManifest } from "../core/manifest.js";
import { testConnection } from "../services/sshTest.js";

interface TestArgs {
  profile?: string;
  all: boolean;
}

export const testCommand = defineCommand<TestArgs>({
  name: "test",
  summary: "Test SSH authentication for a profile",
  usage: "xpssh test [<profile>] [--all]",
  flags: [{ name: "all", type: "boolean", description: "test every profile" }],
  parse(positionals, values) {
    return { profile: positionals[0], all: values["all"] === true };
  },
  async run(args, ctx) {
    const manifest = await loadManifest(ctx.paths.manifest);
    if (manifest.profiles.length === 0) {
      return { ok: false, message: "No profiles to test — run `xpssh setup <provider>` first" };
    }

    let targets = manifest.profiles;
    if (!args.all) {
      if (!args.profile) {
        if (manifest.profiles.length === 1) {
          targets = manifest.profiles;
        } else if (ctx.yes) {
          throw new UsageError("Multiple profiles exist — pass <profile> or --all");
        } else {
          const chosen = await ctx.promptSelect(
            "Which profile?",
            manifest.profiles.map((p) => ({ label: `${p.id} (${p.email})`, value: p })),
          );
          targets = [chosen];
        }
      } else {
        const profile = findProfile(manifest, args.profile);
        if (!profile) {
          throw new UsageError(`No profile "${args.profile}" — run \`xpssh list\` to see what exists`);
        }
        targets = [profile];
      }
    }

    let allOk = true;
    for (const profile of targets) {
      ctx.emit({ type: "step", id: profile.id, label: `ssh -T git@${profile.alias}`, status: "start" });
      const result = await testConnection(ctx.exec, profile.alias);
      profile.lastTest = { ok: result.ok, at: new Date().toISOString(), message: result.message };
      ctx.emit({ type: "step", id: profile.id, label: `ssh -T git@${profile.alias}`, status: result.ok ? "done" : "fail" });
      ctx.emit({ type: result.ok ? "success" : "error", text: `${profile.id}: ${result.message}` });
      if (!result.ok) allOk = false;
    }
    await saveManifest(ctx.paths.manifest, manifest);

    return allOk
      ? { ok: true, message: targets.length > 1 ? "All connections authenticated" : undefined }
      : { ok: false, message: "Some connections failed — make sure the public key is added to the provider" };
  },
});
