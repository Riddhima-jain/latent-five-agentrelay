import { copyFile, mkdir } from "node:fs/promises";
import path from "node:path";

export const SALES_RECOVERY_FIXTURES = {
  "fixture://market-report.json": "market-report.json",
  "fixture://finance-report.csv": "finance-report.csv",
  "fixture://customer-list.json": "customer-list.json",
} as const;

export type ControlledFixtureHandle = keyof typeof SALES_RECOVERY_FIXTURES;

export interface ControlledFixtureProvider {
  materialize(workspacePath: string, handles: readonly string[]): Promise<readonly string[]>;
}

/**
 * Copies only registry-approved fixtures into an Agent workspace. Arbitrary host
 * paths are never accepted as resource handles.
 */
export class LocalControlledFixtureProvider implements ControlledFixtureProvider {
  constructor(private readonly fixtureRoot: string) {}

  async materialize(workspacePath: string, handles: readonly string[]): Promise<readonly string[]> {
    const destinationRoot = path.join(workspacePath, ".agentrelay", "fixtures");
    await mkdir(destinationRoot, { recursive: true });
    const destinations: string[] = [];
    for (const handle of handles) {
      const filename = SALES_RECOVERY_FIXTURES[handle as ControlledFixtureHandle];
      if (!filename) throw new Error(`Unknown controlled fixture: ${handle}`);
      const source = path.join(this.fixtureRoot, filename);
      const destination = path.join(destinationRoot, filename);
      await copyFile(source, destination);
      destinations.push(path.relative(workspacePath, destination));
    }
    return destinations;
  }
}
