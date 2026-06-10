#!/usr/bin/env node
import { render } from "ink";
import { VERSION } from "./version.js";
import { Spike } from "./tui/Spike.js";

const args = process.argv.slice(2);

if (args.includes("--version") || args.includes("-v")) {
  console.log(VERSION);
  process.exit(0);
}

if (args[0] === "ui" || (args.length === 0 && process.stdout.isTTY)) {
  const app = render(<Spike />, { alternateScreen: true });
  await app.waitUntilExit();
  process.exit(0);
}

console.log(`xpssh v${VERSION} — run \`xpssh ui\` in a terminal for the TUI`);
