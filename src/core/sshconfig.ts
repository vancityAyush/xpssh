/**
 * Safe ~/.ssh/config editing.
 *
 * xpssh-managed host blocks are wrapped in fence comments:
 *
 *   # >>> xpssh:github-work >>>
 *   Host github.com-work
 *       ...
 *   # <<< xpssh:github-work <<<
 *
 * The file is parsed into an ordered list of segments (user text or managed
 * block). Rendering the segments back MUST reproduce the input byte-for-byte
 * (round-trip invariant) so user content is never reordered or reformatted.
 */

const BEGIN_RE = /^# >>> xpssh:([A-Za-z0-9._-]+) >>>\s*$/;
const END_RE = /^# <<< xpssh:([A-Za-z0-9._-]+) <<<\s*$/;

export type Segment =
  | { kind: "user"; text: string }
  | { kind: "managed"; id: string; text: string };

export class SshConfigParseError extends Error {
  constructor(message: string) {
    super(`${message} — fix ~/.ssh/config by hand or run \`xpssh doctor\``);
    this.name = "SshConfigParseError";
  }
}

/** Split file content into lines, preserving the exact line terminators. */
function splitKeepEnds(text: string): string[] {
  if (text === "") return [];
  const lines = text.split(/(?<=\n)/);
  return lines;
}

export function parseSegments(text: string): Segment[] {
  const segments: Segment[] = [];
  let userBuf = "";
  let managed: { id: string; buf: string } | null = null;

  for (const line of splitKeepEnds(text)) {
    const stripped = line.replace(/\r?\n$/, "");
    const begin = stripped.match(BEGIN_RE);
    const end = stripped.match(END_RE);

    if (begin) {
      if (managed) {
        throw new SshConfigParseError(
          `Nested xpssh fence: "${begin[1]}" begins inside unclosed "${managed.id}"`,
        );
      }
      if (userBuf) {
        segments.push({ kind: "user", text: userBuf });
        userBuf = "";
      }
      managed = { id: begin[1]!, buf: line };
    } else if (end) {
      if (!managed) {
        throw new SshConfigParseError(`Orphaned xpssh end fence for "${end[1]}"`);
      }
      if (end[1] !== managed.id) {
        throw new SshConfigParseError(
          `Mismatched xpssh fences: begin "${managed.id}" closed by "${end[1]}"`,
        );
      }
      segments.push({ kind: "managed", id: managed.id, text: managed.buf + line });
      managed = null;
    } else if (managed) {
      managed.buf += line;
    } else {
      userBuf += line;
    }
  }

  if (managed) {
    throw new SshConfigParseError(`Unclosed xpssh fence for "${managed.id}"`);
  }
  if (userBuf) {
    segments.push({ kind: "user", text: userBuf });
  }
  return segments;
}

export function renderSegments(segments: Segment[]): string {
  return segments.map((s) => s.text).join("");
}

export interface HostBlockSpec {
  id: string;
  alias: string;
  hostName: string;
  user: string;
  identityFile: string;
  /** darwin only */
  useKeychain: boolean;
}

export function buildHostBlock(spec: HostBlockSpec): string {
  const lines = [
    `# >>> xpssh:${spec.id} >>>`,
    `Host ${spec.alias}`,
    `    HostName ${spec.hostName}`,
    `    User ${spec.user}`,
    `    IdentityFile ${spec.identityFile}`,
    `    IdentitiesOnly yes`,
    `    AddKeysToAgent yes`,
    ...(spec.useKeychain ? ["    UseKeychain yes"] : []),
    `# <<< xpssh:${spec.id} <<<`,
  ];
  return lines.join("\n") + "\n";
}

/** Insert or replace the managed block for `spec.id`. Returns the new segment list and what happened. */
export function upsertBlock(
  segments: Segment[],
  spec: HostBlockSpec,
): { segments: Segment[]; action: "added" | "replaced" } {
  const block = buildHostBlock(spec);
  const index = segments.findIndex((s) => s.kind === "managed" && s.id === spec.id);
  if (index !== -1) {
    const next = [...segments];
    next[index] = { kind: "managed", id: spec.id, text: block };
    return { segments: next, action: "replaced" };
  }
  const next = [...segments];
  const last = next[next.length - 1];
  if (last && !last.text.endsWith("\n")) {
    // user file lacks trailing newline; add one inside the user segment so blocks stay line-aligned
    next[next.length - 1] = { ...last, text: last.text + "\n" };
  }
  if (last) {
    // one blank separator line between existing content and our block
    next.push({ kind: "user", text: "\n" });
  }
  next.push({ kind: "managed", id: spec.id, text: block });
  return { segments: next, action: "added" };
}

/** Remove the managed block for `id`. Also swallows one blank separator line directly before it. */
export function removeBlock(segments: Segment[], id: string): { segments: Segment[]; removed: boolean } {
  const index = segments.findIndex((s) => s.kind === "managed" && s.id === id);
  if (index === -1) return { segments, removed: false };
  const next = [...segments];
  next.splice(index, 1);
  const before = next[index - 1];
  if (before && before.kind === "user" && /(^|\n)\n$/.test(before.text)) {
    next[index - 1] = { ...before, text: before.text.replace(/\n$/, "") };
    if (next[index - 1]!.text === "") next.splice(index - 1, 1);
  }
  return { segments: next, removed: true };
}

export function listManagedIds(segments: Segment[]): string[] {
  return segments.filter((s): s is Segment & { kind: "managed" } => s.kind === "managed").map((s) => s.id);
}

/** Extract `Key value` pairs from a managed block (Host, HostName, IdentityFile, ...). */
export function parseBlockFields(blockText: string): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const raw of blockText.split("\n")) {
    const line = raw.trim();
    if (line.startsWith("#") || line === "") continue;
    const match = line.match(/^(\S+)\s+(.+)$/);
    if (match) fields[match[1]!] = match[2]!;
  }
  return fields;
}
