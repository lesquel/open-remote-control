import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writePrivateFile } from "./private-file";

function permissionBits(path: string): number {
  return statSync(path).mode & 0o777;
}

describe("writePrivateFile", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "pilot-private-file-"));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  test("creates parent as 0700 and file as 0600 on POSIX", () => {
    const parent = join(root, "private");
    const path = join(parent, "secret.txt");

    writePrivateFile(path, "secret");

    expect(readFileSync(path, "utf8")).toBe("secret");
    if (process.platform !== "win32") {
      expect(permissionBits(parent)).toBe(0o700);
      expect(permissionBits(path)).toBe(0o600);
    }
  });

  test("tightens an existing permissive parent and file", () => {
    const parent = join(root, "private");
    const path = join(parent, "secret.txt");
    mkdirSync(parent, { mode: 0o755 });
    writeFileSync(path, "old", { mode: 0o644 });
    if (process.platform !== "win32") {
      chmodSync(parent, 0o755);
      chmodSync(path, 0o644);
    }

    writePrivateFile(path, "new");

    expect(readFileSync(path, "utf8")).toBe("new");
    if (process.platform !== "win32") {
      expect(permissionBits(parent)).toBe(0o700);
      expect(permissionBits(path)).toBe(0o600);
    }
  });

  test("atomically replaces content without leaving a temp file", () => {
    const parent = join(root, "private");
    const path = join(parent, "secret.txt");
    mkdirSync(parent);
    writeFileSync(path, "old");

    writePrivateFile(path, "new");

    expect(readFileSync(path, "utf8")).toBe("new");
    expect(readdirSync(parent)).toEqual(["secret.txt"]);
  });

  test("removes its temp file when the atomic rename fails", () => {
    const parent = join(root, "private");
    const destinationDirectory = join(parent, "secret.txt");
    mkdirSync(destinationDirectory, { recursive: true });
    writeFileSync(join(destinationDirectory, "keep"), "unchanged");

    expect(() => writePrivateFile(destinationDirectory, "new")).toThrow();

    expect(existsSync(join(destinationDirectory, "keep"))).toBe(true);
    expect(readdirSync(parent)).toEqual(["secret.txt"]);
  });
});
