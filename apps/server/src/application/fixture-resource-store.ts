import { readFile } from "node:fs/promises";
import path from "node:path";
import { normalizeLogicalResource } from "./tool-policy-service.js";

export interface ProtectedResourceStore {
  read(resource: string): Promise<{ content: string; contentType: string }>;
}

export class FixtureResourceStore implements ProtectedResourceStore {
  constructor(private readonly protectedRoot: string) {}

  async read(resource: string): Promise<{ content: string; contentType: string }> {
    const normalized = normalizeLogicalResource(resource);
    const root = path.resolve(this.protectedRoot);
    const target = path.resolve(root, normalized);
    if (!target.startsWith(`${root}${path.sep}`)) throw new Error("Resource escapes protected fixture root");
    const content = await readFile(target, "utf8");
    return { content, contentType: contentTypeFor(normalized) };
  }
}

function contentTypeFor(resource: string): string {
  if (resource.endsWith(".json")) return "application/json";
  if (resource.endsWith(".csv")) return "text/csv";
  return "application/octet-stream";
}
