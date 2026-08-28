import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import type { AgentService } from "./agent-service.js";

const service = {
  listAgents: () => [],
  systemInfo: async () => ({}),
} as unknown as AgentService;

afterEach(() => vi.unstubAllGlobals());

describe("Gemini Responses adapter", () => {
  it("translates function calls and preserves the follow-up conversation", async () => {
    const calls: unknown[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, options: RequestInit) => {
        calls.push(JSON.parse(String(options.body)));
        const call = calls.length === 1;
        return new Response(
          JSON.stringify({
            candidates: [
              {
                content: {
                  role: "model",
                  parts: call
                    ? [{ functionCall: { id: "call_1", name: "shell", args: { command: "pwd" } } }]
                    : [{ text: "Done." }],
                },
              },
            ],
            usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 3, totalTokenCount: 8 },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }),
    );
    const app = await createApp(
      loadConfig({
        NODE_ENV: "test",
        MODEL_PROVIDER: "gemini",
        GEMINI_API_KEY: "test-key",
      }),
      service,
    );
    const first = await app.inject({
      method: "POST",
      url: "/model/v1/responses",
      headers: { authorization: "Bearer test-key" },
      payload: {
        model: "gemini-test",
        input: [{ type: "message", role: "user", content: [{ type: "input_text", text: "Inspect it" }] }],
        tools: [{ type: "function", name: "shell", description: "Run a command", parameters: { type: "object", additionalProperties: false } }],
      },
    });
    expect(first.statusCode).toBe(200);
    const firstBody = first.json() as {
      id: string;
      output: Array<{ id: string; type: string; name?: string }>;
    };
    expect(firstBody.output).toMatchObject([{ type: "function_call", name: "shell" }]);
    expect(calls[0]).toMatchObject({
      tools: [{ functionDeclarations: [{ parameters: { type: "object" } }] }],
    });

    const second = await app.inject({
      method: "POST",
      url: "/model/v1/responses",
      headers: { authorization: "Bearer test-key" },
      payload: {
        model: "gemini-test",
        previous_response_id: firstBody.id,
        input: [
          {
            type: "function_call_output",
            call_id: firstBody.output[0]?.id,
            output: "/workspace",
          },
        ],
      },
    });
    expect(second.statusCode).toBe(200);
    expect(second.json()).toMatchObject({ output: [{ type: "message", content: [{ text: "Done." }] }] });
    expect(calls).toHaveLength(2);
    const followUp = calls[1] as { contents: Array<{ role: string; parts: unknown[] }> };
    expect(
      followUp.contents.find((message) =>
        message.parts.some((part) =>
          Boolean((part as { functionResponse?: unknown }).functionResponse),
        ),
      ),
    ).toMatchObject({
      role: "user",
      parts: [
        {
          functionResponse: {
            id: firstBody.output[0]?.id,
            name: "shell",
            response: { result: "/workspace" },
          },
        },
      ],
    });
    await app.close();
  });
});
