import { mkdir, readFile, unlink } from "node:fs/promises";
import { dirname } from "node:path";
import type { ExecFn } from "./exec.js";
import type { KeyType } from "../core/providers/index.js";

export interface KeygenSpec {
  keyType: KeyType;
  /** absolute private key path */
  keyPath: string;
  email: string;
}

export async function generateKeyPair(exec: ExecFn, spec: KeygenSpec): Promise<void> {
  await mkdir(dirname(spec.keyPath), { recursive: true, mode: 0o700 });
  const args = [
    "-t",
    spec.keyType,
    ...(spec.keyType === "rsa" ? ["-b", "4096"] : []),
    "-f",
    spec.keyPath,
    "-C",
    spec.email,
    "-N",
    "",
    "-q",
  ];
  const result = await exec("ssh-keygen", args);
  if (result.code !== 0) {
    throw new Error(`ssh-keygen failed: ${result.stderr.trim() || `exit ${result.code}`}`);
  }
}

export async function readPublicKey(keyPath: string): Promise<string> {
  return (await readFile(`${keyPath}.pub`, "utf8")).trim();
}

export async function deleteKeyPair(keyPath: string): Promise<void> {
  for (const file of [keyPath, `${keyPath}.pub`]) {
    try {
      await unlink(file);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
  }
}
