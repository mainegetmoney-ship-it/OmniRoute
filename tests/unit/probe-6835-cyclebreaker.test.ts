import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

test("getDbInstance() leaves a probe-failed database quarantined and initializes cleanly", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-6835-"));
  process.env.DATA_DIR = tmpDir;
  const sqliteFile = path.join(tmpDir, "storage.sqlite");
  const backupFile = `${sqliteFile}.probe-failed-1000000000000`;
  fs.writeFileSync(backupFile, Buffer.from("not a real sqlite file, always fails to open"));
  const core = await import("../../src/lib/db/core.ts");
  const quarantinedBytes = fs.readFileSync(backupFile);

  try {
    const db = core.getDbInstance();
    assert.equal(fs.existsSync(sqliteFile), true, "a clean live database should be created");
    assert.deepEqual(
      fs.readFileSync(backupFile),
      quarantinedBytes,
      "the quarantined database must not be moved, changed, or deleted"
    );
    assert.deepEqual(
      db.prepare("SELECT value FROM db_meta WHERE key = 'schema_version'").get(),
      { value: "1" },
      "the clean replacement should finish initialization"
    );
    core.resetDbInstance();
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("getDbInstance() quarantines a corrupt live database and preserves its exact bytes", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-corrupt-db-"));
  process.env.DATA_DIR = tmpDir;
  const sqliteFile = path.join(tmpDir, "storage.sqlite");
  const corruptBytes = Buffer.from("not a real sqlite file, but this is user data");
  const walBytes = Buffer.from("uncheckpointed user data");
  fs.writeFileSync(sqliteFile, corruptBytes);
  fs.writeFileSync(`${sqliteFile}-wal`, walBytes);
  const core = await import(`../../src/lib/db/core.ts?corrupt=${Date.now()}`);

  try {
    const db = core.getDbInstance();
    const backups = fs
      .readdirSync(tmpDir)
      .filter(
        (name) =>
          name.startsWith("storage.sqlite.probe-failed-") &&
          !name.endsWith("-wal") &&
          !name.endsWith("-shm")
      );

    assert.equal(backups.length, 1, "the corrupt database should be quarantined once");
    assert.deepEqual(
      fs.readFileSync(path.join(tmpDir, backups[0])),
      corruptBytes,
      "quarantine must preserve every original byte"
    );
    assert.deepEqual(
      fs.readFileSync(path.join(tmpDir, `${backups[0]}-wal`)),
      walBytes,
      "the matching WAL must be preserved with the corrupt database"
    );
    if (fs.existsSync(`${sqliteFile}-wal`)) {
      assert.notDeepEqual(
        fs.readFileSync(`${sqliteFile}-wal`),
        walBytes,
        "any WAL at the live path must belong to the clean replacement"
      );
    }
    assert.notDeepEqual(fs.readFileSync(sqliteFile), corruptBytes);
    assert.deepEqual(db.prepare("SELECT value FROM db_meta WHERE key = 'schema_version'").get(), {
      value: "1",
    });
    core.resetDbInstance();
  } finally {
    core.resetDbInstance();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
