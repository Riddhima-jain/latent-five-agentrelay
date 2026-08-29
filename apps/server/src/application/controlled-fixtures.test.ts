import { access, mkdtemp, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { LocalControlledFixtureProvider } from "./controlled-fixtures.js";

describe("LocalControlledFixtureProvider", () => {
  it("materializes only named controlled fixtures into the Agent workspace", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "agentrelay-workspace-"));
    try {
      const provider = new LocalControlledFixtureProvider(
        path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../fixtures/sales-recovery"),
      );
      await expect(provider.materialize(workspace, ["fixture://market-report.json"])).resolves.toEqual([
        path.join(".agentrelay", "fixtures", "market-report.json"),
      ]);
      await expect(access(path.join(workspace, ".agentrelay", "fixtures", "market-report.json"))).resolves.toBeUndefined();
      await expect(provider.materialize(workspace, ["C:/sensitive-file"])).rejects.toThrow("Unknown controlled fixture");
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });
});
