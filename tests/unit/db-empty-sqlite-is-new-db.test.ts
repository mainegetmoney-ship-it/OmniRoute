/**
 * A zero-byte `storage.sqlite` must be treated as a BRAND-NEW database, not as an
 * existing one whose migration tracking table was wiped.
 *
 * Repro: an interrupted first launch, a full disk, or a killed installer can leave
 * an empty `storage.sqlite` in DATA_DIR. `isNewDb` was derived from
 * `fs.existsSync(sqliteFile)` alone (src/lib/db/core.ts), so the empty file counted
 * as "existing". The migration runner then hit its mass-migration safety abort
 * (`MigrationSafetyAbortError`) and the server refused to start at all — surfacing
 * to desktop users as a generic startup/"internal" error with no way forward
 * except manually deleting the file.
 *
 * A file that exists but holds no database is a new database.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-emptydb-"));
process.env.DATA_DIR = TEST_DATA_DIR;

const { isEffectivelyNewDatabase } = await import("../../src/lib/db/core.ts");

test.after(() => {
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
});

test("missing storage.sqlite counts as a new database", () => {
  const p = path.join(TEST_DATA_DIR, "missing.sqlite");
  assert.equal(isEffectivelyNewDatabase(p), true);
});

test("zero-byte storage.sqlite counts as a new database (regression)", () => {
  const p = path.join(TEST_DATA_DIR, "empty.sqlite");
  fs.writeFileSync(p, "");
  assert.equal(fs.existsSync(p), true, "file must exist for the regression to be meaningful");
  assert.equal(fs.statSync(p).size, 0);
  assert.equal(
    isEffectivelyNewDatabase(p),
    true,
    "an existing but empty file holds no database — it must be treated as new"
  );
});

test("a populated sqlite file is NOT treated as a new database", () => {
  const p = path.join(TEST_DATA_DIR, "real.sqlite");
  // SQLite files begin with the 16-byte header "SQLite format 3\0".
  fs.writeFileSync(p, Buffer.concat([Buffer.from("SQLite format 3\0"), Buffer.alloc(4096)]));
  assert.equal(
    isEffectivelyNewDatabase(p),
    false,
    "a non-empty database file must keep the existing-database safety checks"
  );
});
