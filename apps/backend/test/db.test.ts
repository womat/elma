import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { openDb } from "../src/db.ts";
import { Repo } from "../src/repo.ts";

let dir: string | undefined;
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = undefined;
});

describe("openDb", () => {
  it("ergänzt display_name in einer DB von vor 0.7.0 und lässt bestehende Konten unverändert", () => {
    dir = mkdtempSync(join(tmpdir(), "elma-db-"));
    const path = join(dir, "elma.db");
    const old = new DatabaseSync(path);
    old.exec(`CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, created_at INTEGER NOT NULL);
      INSERT INTO users VALUES ('u1', 'elisa@elma.test', 'passkey-only', 1);`);
    old.close();

    const db = openDb(path);
    const repo = new Repo(db);
    expect(repo.userById("u1")).toEqual({ id: "u1", email: "elisa@elma.test", displayName: null });
    const cols = db.prepare("PRAGMA table_info(invites)").all() as { name: string }[];
    expect(cols.map((c) => c.name)).toContain("display_name");
    repo.setDisplayName("u1", "Elisa");
    db.close();

    // zweites Öffnen darf die Spalte nicht noch einmal anlegen wollen
    expect(new Repo(openDb(path)).userById("u1")?.displayName).toBe("Elisa");
  });

  it("entfernt den Index reservations_one_active, damit geplante und laufende gleichzeitig offen sein können (0.11.0)", () => {
    dir = mkdtempSync(join(tmpdir(), "elma-db-"));
    const path = join(dir, "elma.db");
    openDb(path).close();
    const old = new DatabaseSync(path);
    old.exec("CREATE UNIQUE INDEX reservations_one_active ON reservations (producer_id) WHERE ended_at IS NULL");
    old.close();

    const db = openDb(path);
    const indexes = db.prepare("PRAGMA index_list(reservations)").all() as { name: string }[];
    expect(indexes.map((i) => i.name)).not.toContain("reservations_one_active");
    db.close();
  });
});
