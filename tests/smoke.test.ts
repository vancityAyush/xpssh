import { describe, expect, test } from "bun:test";
import { VERSION } from "../src/version.js";

describe("smoke", () => {
  test("version is a semver string", () => {
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+/);
  });
});
