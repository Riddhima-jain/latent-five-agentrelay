import { readFile } from "node:fs/promises";
import path from "node:path";
import { normalizeLogicalResource } from "./tool-policy-service.js";

export class FixtureResourceStore {
  constructor(private readonly protectedRoot: string) {}
  async read(resource: string): Promise<{ content: string; contentType: string }> {
    const logical = normalizeLogicalResource(resource);
    const absolute = path.resolve(this.protectedRoot, logical);
    const prefix = path.resolve(this.protectedRoot) + path.sep;
    if (!absolute.startsWith(prefix)) throw new Error("RESOURCE_OUT_OF_SCOPE");
    const content = await readFile(absolute, "utf8");
    return { content, contentType: logical.endsWith(".json") ? "application/json" : logical.endsWith(".csv") ? "text/csv" : "text/plain" };
  }
}
