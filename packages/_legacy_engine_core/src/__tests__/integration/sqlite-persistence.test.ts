import { describe, it, expect } from "vitest";
import { SqliteRunStore } from "../../runtime/store/sqlite/SqliteRunStore";

describe("SQLite persistence", () => {
  it("persists runs to disk", async () => {
    const store = new SqliteRunStore("test.db");
    await store.save("abc", "hello");

    const store2 = new SqliteRunStore("test.db");
    const val = await store2.get("abc");

    expect(val).toBe("hello");
  });
});
