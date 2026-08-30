export const SALES_RECOVERY_FIXTURES = {
  "market/market-report.json": "market/market-report.json",
  "finance/finance-report.csv": "finance/finance-report.csv",
  "customer/customer-list.json": "customer/customer-list.json",
} as const;

export type ControlledFixtureHandle = keyof typeof SALES_RECOVERY_FIXTURES;

export interface ControlledFixtureProvider {
  materialize(workspacePath: string, handles: readonly string[]): Promise<readonly string[]>;
}

/**
 * Validates logical resource handles. Protected content is deliberately never
 * copied or mounted into an Agent workspace.
 */
export class LocalControlledFixtureProvider implements ControlledFixtureProvider {
  constructor(_fixtureRoot: string) {}

  async materialize(workspacePath: string, handles: readonly string[]): Promise<readonly string[]> {
    void workspacePath;
    for (const handle of handles) {
      if (!SALES_RECOVERY_FIXTURES[handle as ControlledFixtureHandle]) {
        throw new Error(`Unknown protected resource handle: ${handle}`);
      }
    }
    return [];
  }
}
