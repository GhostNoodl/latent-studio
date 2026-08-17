import { existsSync } from "node:fs";
import { realpath } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import { config } from "./config.ts";

let active = false;

export function setManagedComfyActive(value: boolean): void {
  active = value;
}

export function isManagedComfyActive(): boolean {
  return active;
}

export function managedComfyDir(): string {
  const portable = process.platform === "win32" ? "ComfyUI_windows_portable" : "ComfyUI_linux";
  return join(config.dataDir, "comfyui", portable, "ComfyUI");
}

/** Resolve an existing output while rejecting absolute paths, traversal, and junction escapes. */
export async function resolveContainedOutput(
  root: string,
  subfolder: string,
  filename: string,
): Promise<string | undefined> {
  if (!filename || isAbsolute(filename) || isAbsolute(subfolder)) return undefined;
  const candidate = resolve(root, subfolder, filename);
  const lexical = relative(root, candidate);
  if (!lexical || lexical === ".." || lexical.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) || isAbsolute(lexical)) {
    return undefined;
  }
  if (!existsSync(candidate)) return undefined;
  try {
    const [realRoot, realCandidate] = await Promise.all([realpath(root), realpath(candidate)]);
    const actual = relative(realRoot, realCandidate);
    if (!actual || actual === ".." || actual.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) || isAbsolute(actual)) {
      return undefined;
    }
    return realCandidate;
  } catch {
    return undefined;
  }
}

export async function localManagedOutput(ref: {
  filename: string;
  subfolder: string;
  type: string;
}): Promise<string | undefined> {
  if (!active || ref.type === "temp") return undefined;
  return resolveContainedOutput(join(managedComfyDir(), "output"), ref.subfolder, ref.filename);
}
