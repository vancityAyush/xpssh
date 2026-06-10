#!/usr/bin/env node
import { VERSION } from "./version.js";

const args = process.argv.slice(2);

if (args.includes("--version") || args.includes("-v")) {
  console.log(VERSION);
  process.exit(0);
}

if (args[0] === "ui" || (args.length === 0 && process.stdout.isTTY)) {
  const { render } = await import("ink");
  const { App } = await import("./tui/App.js");
  const { sessionLog } = await import("./tui/dispatch.js");
  const app = render(<App />, { alternateScreen: true });
  await app.waitUntilExit();
  // the alt screen vanished — persist what happened into normal scrollback
  if (sessionLog.length > 0) {
    console.log("xpssh session:");
    for (const line of sessionLog) console.log(`  ${line}`);
  }
  process.exit(0);
}

if (args.length === 0) {
  const { renderHelp } = await import("./cli/help.js");
  console.log(renderHelp());
  process.exit(0);
}

const { runCli } = await import("./cli/run.js");
process.exit(await runCli(args));
