import { randomUUID } from "node:crypto";
import {
  chmodSync,
  mkdirSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";

const PRIVATE_DIRECTORY_MODE = 0o700;
const PRIVATE_FILE_MODE = 0o600;

function applyPosixMode(path: string, mode: number): void {
  // Node's mode/chmod options do not provide Windows ACL guarantees. Avoid
  // pretending they do; Windows keeps its platform-native access controls.
  if (process.platform !== "win32") chmodSync(path, mode);
}

/**
 * Atomically replace a credential-bearing text file with owner-only POSIX modes.
 *
 * The temporary file is unique and lives beside the destination, so rename is
 * atomic on the destination filesystem. Errors are thrown for the caller to
 * translate into its existing structured result or diagnostic surface.
 */
export function writePrivateFile(path: string, content: string): void {
  const parent = dirname(path);
  mkdirSync(parent, { recursive: true, mode: PRIVATE_DIRECTORY_MODE });
  applyPosixMode(parent, PRIVATE_DIRECTORY_MODE);

  const tempPath = join(
    parent,
    `.${basename(path)}.${process.pid}.${randomUUID()}.tmp`,
  );

  try {
    writeFileSync(tempPath, content, {
      encoding: "utf8",
      flag: "wx",
      mode: PRIVATE_FILE_MODE,
    });
    applyPosixMode(tempPath, PRIVATE_FILE_MODE);
    renameSync(tempPath, path);
    // Tighten files created by older versions even on filesystems whose rename
    // semantics preserve destination metadata rather than source metadata.
    applyPosixMode(path, PRIVATE_FILE_MODE);
  } catch (error) {
    try {
      unlinkSync(tempPath);
    } catch (cleanupError) {
      if ((cleanupError as NodeJS.ErrnoException).code !== "ENOENT") {
        throw new AggregateError(
          [error, cleanupError],
          `Private file write failed and temporary file cleanup also failed: ${path}`,
        );
      }
    }
    throw error;
  }
}
