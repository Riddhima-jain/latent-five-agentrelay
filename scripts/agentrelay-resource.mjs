#!/usr/bin/env node
const [operation, resource] = process.argv.slice(2);
const gateway = process.env.AGENTRELAY_RESOURCE_GATEWAY;
const grant = process.env.AGENTRELAY_ACCESS_GRANT;
if (operation !== "read" || !resource) {
  process.stderr.write("Usage: agentrelay-resource read <logical-resource>\n");
  process.exit(2);
}
if (!gateway || !grant) {
  process.stderr.write("Resource access is unavailable outside an AgentRelay run.\n");
  process.exit(3);
}
const response = await fetch(`${gateway.replace(/\/$/, "")}/${resource.split("/").map(encodeURIComponent).join("/")}`, { headers: { "X-AgentRelay-Grant": grant } });
if (!response.ok) {
  const body = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
  process.stderr.write(`${body.error ?? `HTTP ${response.status}`}\n`);
  process.exit(response.status === 403 ? 4 : 5);
}
process.stdout.write(await response.text());
