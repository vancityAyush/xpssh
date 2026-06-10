import { describe, expect, test } from "bun:test";
import {
  buildHostBlock,
  listManagedIds,
  parseBlockFields,
  parseSegments,
  removeBlock,
  renderSegments,
  SshConfigParseError,
  upsertBlock,
  type HostBlockSpec,
} from "../src/core/sshconfig.js";

const SPEC: HostBlockSpec = {
  id: "github-work",
  alias: "github.com-work",
  hostName: "github.com",
  user: "git",
  identityFile: "~/.ssh/xpssh_github_work",
  useKeychain: true,
};

const BLOCK = buildHostBlock(SPEC);

const USER_ONLY = `Host myserver
    HostName 10.0.0.5
    User admin

Host *
    ServerAliveInterval 60
`;

const MIXED = `# my own comment
Host myserver
    HostName 10.0.0.5

${BLOCK}
Host other
    User root
`;

describe("round-trip invariant", () => {
  const cases: [string, string][] = [
    ["empty", ""],
    ["user-only", USER_ONLY],
    ["managed-only", BLOCK],
    ["mixed", MIXED],
    ["no trailing newline", "Host a\n    User b"],
    ["CRLF endings", "Host a\r\n    User b\r\n"],
    ["blank lines everywhere", "\n\nHost a\n\n\n    User b\n\n"],
    ["include directive", "Include ~/.ssh/other_config\nHost a\n    User b\n"],
  ];
  for (const [name, input] of cases) {
    test(name, () => {
      expect(renderSegments(parseSegments(input))).toBe(input);
    });
  }
});

describe("parseSegments", () => {
  test("identifies managed blocks and user text", () => {
    const segments = parseSegments(MIXED);
    expect(segments.map((s) => s.kind)).toEqual(["user", "managed", "user"]);
    expect(listManagedIds(segments)).toEqual(["github-work"]);
  });

  test("hard-errors on unclosed fence", () => {
    expect(() => parseSegments(`# >>> xpssh:a >>>\nHost a\n`)).toThrow(SshConfigParseError);
  });

  test("hard-errors on orphaned end fence", () => {
    expect(() => parseSegments(`# <<< xpssh:a <<<\n`)).toThrow(SshConfigParseError);
  });

  test("hard-errors on mismatched fence ids", () => {
    expect(() => parseSegments(`# >>> xpssh:a >>>\n# <<< xpssh:b <<<\n`)).toThrow(SshConfigParseError);
  });

  test("hard-errors on nested fences", () => {
    expect(() => parseSegments(`# >>> xpssh:a >>>\n# >>> xpssh:b >>>\n`)).toThrow(SshConfigParseError);
  });
});

describe("buildHostBlock", () => {
  test("contains the mandatory multi-account options", () => {
    expect(BLOCK).toContain("IdentitiesOnly yes");
    expect(BLOCK).toContain("AddKeysToAgent yes");
    expect(BLOCK).toContain("UseKeychain yes");
  });

  test("omits UseKeychain off darwin", () => {
    const block = buildHostBlock({ ...SPEC, useKeychain: false });
    expect(block).not.toContain("UseKeychain");
  });
});

describe("upsertBlock", () => {
  test("appends to empty config without leading separator", () => {
    const { segments, action } = upsertBlock([], SPEC);
    expect(action).toBe("added");
    expect(renderSegments(segments)).toBe(BLOCK);
  });

  test("appends after user content with one blank separator", () => {
    const { segments, action } = upsertBlock(parseSegments(USER_ONLY), SPEC);
    expect(action).toBe("added");
    expect(renderSegments(segments)).toBe(USER_ONLY + "\n" + BLOCK);
  });

  test("adds trailing newline when user file lacks one", () => {
    const { segments } = upsertBlock(parseSegments("Host a\n    User b"), SPEC);
    expect(renderSegments(segments)).toBe("Host a\n    User b\n\n" + BLOCK);
  });

  test("replaces an existing block in place", () => {
    const initial = parseSegments(MIXED);
    const updated: HostBlockSpec = { ...SPEC, identityFile: "~/.ssh/other_key" };
    const { segments, action } = upsertBlock(initial, updated);
    expect(action).toBe("replaced");
    const rendered = renderSegments(segments);
    expect(rendered).toContain("IdentityFile ~/.ssh/other_key");
    expect(rendered).not.toContain("IdentityFile ~/.ssh/xpssh_github_work");
    // user content above and below untouched
    expect(rendered).toContain("# my own comment");
    expect(rendered).toContain("Host other");
  });
});

describe("removeBlock", () => {
  test("removes block and restores the file byte-identical to pre-add", () => {
    const added = upsertBlock(parseSegments(USER_ONLY), SPEC).segments;
    const { segments, removed } = removeBlock(added, "github-work");
    expect(removed).toBe(true);
    expect(renderSegments(segments)).toBe(USER_ONLY);
  });

  test("empty config returns to empty after add+remove", () => {
    const added = upsertBlock([], SPEC).segments;
    const { segments } = removeBlock(added, "github-work");
    expect(renderSegments(segments)).toBe("");
  });

  test("no-op for unknown id", () => {
    const segments = parseSegments(MIXED);
    const result = removeBlock(segments, "nope");
    expect(result.removed).toBe(false);
    expect(renderSegments(result.segments)).toBe(MIXED);
  });

  test("removes from the middle without disturbing neighbors", () => {
    const { segments } = removeBlock(parseSegments(MIXED), "github-work");
    const rendered = renderSegments(segments);
    expect(rendered).toContain("# my own comment");
    expect(rendered).toContain("Host other");
    expect(rendered).not.toContain("xpssh:github-work");
  });
});

describe("parseBlockFields", () => {
  test("extracts host fields from a managed block", () => {
    const fields = parseBlockFields(BLOCK);
    expect(fields["Host"]).toBe("github.com-work");
    expect(fields["HostName"]).toBe("github.com");
    expect(fields["IdentityFile"]).toBe("~/.ssh/xpssh_github_work");
  });
});
