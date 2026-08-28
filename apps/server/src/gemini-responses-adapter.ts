import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyReply } from "fastify";
import type { AppConfig } from "./config.js";

type JsonRecord = Record<string, unknown>;

interface Conversation {
  messages: JsonRecord[];
  toolNames: Map<string, string>;
}

function record(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;
}

function text(value: unknown): string {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return "";
  return value
    .map((part) => {
      const item = record(part);
      return item && typeof item.text === "string" ? item.text : "";
    })
    .filter(Boolean)
    .join("\n");
}

function inputMessages(input: unknown, toolNames: ReadonlyMap<string, string>): JsonRecord[] {
  const items = Array.isArray(input) ? input : [input];
  const messages: JsonRecord[] = [];
  for (const item of items) {
    const value = record(item);
    if (!value) continue;
    if (value.type === "function_call_output") {
      const callId = typeof value.call_id === "string" ? value.call_id : "";
      messages.push({
        role: "tool",
        tool_call_id: callId,
        // Gemini requires the function name on a tool result; Codex supplies
        // only the call ID, so recover it from the preceding assistant turn.
        name: toolNames.get(callId) ?? "unknown_function",
        content: typeof value.output === "string" ? value.output : JSON.stringify(value.output),
      });
      continue;
    }
    if (value.type === "message" || typeof value.role === "string") {
      messages.push({
        role: value.role === "developer" ? "system" : value.role ?? "user",
        content: text(value.content),
      });
    }
  }
  return messages;
}

function functionNames(messages: JsonRecord[]): Map<string, string> {
  const names = new Map<string, string>();
  for (const message of messages) {
    if (!Array.isArray(message.tool_calls)) continue;
    for (const call of message.tool_calls) {
      const item = record(call);
      const fn = item && record(item.function);
      if (item && typeof item.id === "string" && fn && typeof fn.name === "string") {
        names.set(item.id, fn.name);
      }
    }
  }
  return names;
}

function geminiSchema(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(geminiSchema);
  const source = record(value);
  if (!source) return value;
  return Object.fromEntries(
    Object.entries(source)
      .filter(([key]) => key !== "additionalProperties")
      .map(([key, item]) => [key, geminiSchema(item)]),
  );
}

function nativeTools(tools: unknown): JsonRecord[] | undefined {
  if (!Array.isArray(tools)) return undefined;
  const translated: JsonRecord[] = [];
  for (const tool of tools) {
    const value = record(tool);
    if (!value || value.type !== "function" || typeof value.name !== "string") continue;
    translated.push({
      name: value.name,
      ...(typeof value.description === "string" ? { description: value.description } : {}),
      ...(record(value.parameters) ? { parameters: geminiSchema(value.parameters) } : {}),
    });
  }
  return translated.length > 0 ? translated : undefined;
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function nativeContents(messages: JsonRecord[]): JsonRecord[] {
  return messages.map((message) => {
    if (message.role === "assistant") {
      const parts: JsonRecord[] = [];
      if (typeof message.content === "string" && message.content) parts.push({ text: message.content });
      if (Array.isArray(message.tool_calls)) {
        for (const call of message.tool_calls) {
          const item = record(call);
          const fn = item && record(item.function);
          if (!item || !fn || typeof fn.name !== "string") continue;
          parts.push({
            functionCall: {
              id: typeof item.id === "string" ? item.id : "call_" + randomUUID(),
              name: fn.name,
              args: typeof fn.arguments === "string" ? parseJson(fn.arguments) : {},
            },
          });
        }
      }
      return { role: "model", parts };
    }
    if (message.role === "tool") {
      return {
        role: "user",
        parts: [{
          functionResponse: {
            id: typeof message.tool_call_id === "string" ? message.tool_call_id : "",
            name: typeof message.name === "string" ? message.name : "unknown_function",
            response: { result: parseJson(typeof message.content === "string" ? message.content : "") },
          },
        }],
      };
    }
    return {
      role: "user",
      parts: [{ text: typeof message.content === "string" ? message.content : "" }],
    };
  });
}

function nativeAssistant(payload: unknown): { message: JsonRecord; usage: JsonRecord | null } | null {
  const response = record(payload);
  const candidate = response && Array.isArray(response.candidates) ? record(response.candidates[0]) : null;
  const content = candidate && record(candidate.content);
  if (!content || !Array.isArray(content.parts)) return null;
  const texts: string[] = [];
  const toolCalls: JsonRecord[] = [];
  for (const part of content.parts) {
    const value = record(part);
    if (!value) continue;
    if (typeof value.text === "string") texts.push(value.text);
    const call = record(value.functionCall);
    if (call && typeof call.name === "string") {
      toolCalls.push({
        id: typeof call.id === "string" ? call.id : "call_" + randomUUID(),
        type: "function",
        function: { name: call.name, arguments: JSON.stringify(call.args ?? {}) },
      });
    }
  }
  return {
    message: {
      role: "assistant",
      ...(texts.length > 0 ? { content: texts.join("\n") } : {}),
      ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
    },
    usage: response && record(response.usageMetadata),
  };
}

function responseOutput(message: JsonRecord): JsonRecord[] {
  const output: JsonRecord[] = [];
  const content = typeof message.content === "string" ? message.content : "";
  if (content) {
    output.push({
      type: "message",
      id: "msg_" + randomUUID(),
      status: "completed",
      role: "assistant",
      content: [{ type: "output_text", text: content, annotations: [] }],
    });
  }
  if (Array.isArray(message.tool_calls)) {
    for (const call of message.tool_calls) {
      const item = record(call);
      const fn = item && record(item.function);
      if (!item || !fn || typeof fn.name !== "string") continue;
      output.push({
        type: "function_call",
        id: "fc_" + randomUUID(),
        call_id: typeof item.id === "string" ? item.id : "call_" + randomUUID(),
        name: fn.name,
        arguments: typeof fn.arguments === "string" ? fn.arguments : "{}",
        status: "completed",
      });
    }
  }
  return output;
}

function sse(reply: FastifyReply, event: string, payload: JsonRecord): void {
  reply.raw.write("event: " + event + "\ndata: " + JSON.stringify({ type: event, ...payload }) + "\n\n");
}

function streamResponse(reply: FastifyReply, response: JsonRecord): void {
  reply.header("content-type", "text/event-stream");
  reply.header("cache-control", "no-cache");
  reply.header("connection", "keep-alive");
  const output = Array.isArray(response.output) ? response.output : [];
  sse(reply, "response.created", { response: { ...response, status: "in_progress" } });
  for (let index = 0; index < output.length; index += 1) {
    const item = record(output[index]);
    if (!item) continue;
    sse(reply, "response.output_item.added", { output_index: index, item });
    if (item.type === "message") {
      const content = Array.isArray(item.content) ? record(item.content[0]) : null;
      const value = content && typeof content.text === "string" ? content.text : "";
      sse(reply, "response.content_part.added", { output_index: index, content_index: 0, part: content ?? {} });
      if (value) sse(reply, "response.output_text.delta", { output_index: index, content_index: 0, delta: value });
      sse(reply, "response.output_text.done", { output_index: index, content_index: 0, text: value });
      sse(reply, "response.content_part.done", { output_index: index, content_index: 0, part: content ?? {} });
    } else if (item.type === "function_call") {
      const argumentsText = typeof item.arguments === "string" ? item.arguments : "{}";
      sse(reply, "response.function_call_arguments.delta", { output_index: index, delta: argumentsText });
      sse(reply, "response.function_call_arguments.done", { output_index: index, arguments: argumentsText });
    }
    sse(reply, "response.output_item.done", { output_index: index, item });
  }
  sse(reply, "response.completed", { response });
  reply.raw.end();
}

export function registerGeminiResponsesAdapter(app: FastifyInstance, config: AppConfig): void {
  const conversations = new Map<string, Conversation>();

  app.post("/model/v1/responses", async (request, reply) => {
    if (config.modelProvider !== "gemini") {
      return reply.code(404).send({ error: { message: "Gemini adapter is disabled" } });
    }
    const body = record(request.body);
    if (!body) return reply.code(400).send({ error: { message: "Expected JSON object" } });
    const authorization = request.headers.authorization;
    if (!authorization?.startsWith("Bearer ")) {
      return reply.code(401).send({ error: { message: "Gemini API key is required" } });
    }
    const previous = typeof body.previous_response_id === "string"
      ? conversations.get(body.previous_response_id)
      : undefined;
    const prior = previous?.messages ?? [];
    const knownToolNames = new Map([
      ...functionNames(prior),
      ...(previous?.toolNames ?? new Map<string, string>()),
    ]);
    const instructions = typeof body.instructions === "string" ? [{ role: "system", content: body.instructions }] : [];
    const messages = [
      ...prior,
      ...instructions,
      ...inputMessages(body.input, knownToolNames),
    ];
    const nativeBaseUrl = config.geminiBaseUrl.replace(/\/openai$/, "");
    const upstream = await fetch(
      nativeBaseUrl + "/models/" + encodeURIComponent(
        typeof body.model === "string" ? body.model : config.geminiModel,
      ) + ":generateContent",
      {
      method: "POST",
      headers: {
        "x-goog-api-key": authorization.slice("Bearer ".length),
        "content-type": "application/json",
      },
      body: JSON.stringify({
        contents: nativeContents(messages),
        ...(nativeTools(body.tools) ? { tools: [{ functionDeclarations: nativeTools(body.tools) }] } : {}),
      }),
      },
    );
    const payload = await upstream.json().catch(() => null);
    if (!upstream.ok) return reply.code(upstream.status).send(payload ?? { error: { message: "Gemini request failed" } });
    const completion = nativeAssistant(payload);
    if (!completion) return reply.code(502).send({ error: { message: "Gemini returned no assistant message" } });
    const assistant = completion.message;
    const id = "resp_" + randomUUID();
    const output = responseOutput(assistant);
    const toolNames = functionNames([...messages, assistant]);
    for (const item of output) {
      if (item.type !== "function_call" || typeof item.name !== "string") continue;
      if (typeof item.id === "string") toolNames.set(item.id, item.name);
      if (typeof item.call_id === "string") toolNames.set(item.call_id, item.name);
    }
    conversations.set(id, { messages: [...messages, assistant], toolNames });
    const usage = completion.usage;
    const response = {
      id,
      object: "response",
      created_at: Math.floor(Date.now() / 1_000),
      status: "completed",
      model: typeof body.model === "string" ? body.model : config.geminiModel,
      output,
      usage: {
        input_tokens: typeof usage?.promptTokenCount === "number" ? usage.promptTokenCount : 0,
        output_tokens: typeof usage?.candidatesTokenCount === "number" ? usage.candidatesTokenCount : 0,
        total_tokens: typeof usage?.totalTokenCount === "number" ? usage.totalTokenCount : 0,
      },
    };
    if (body.stream === true) return streamResponse(reply, response);
    return response;
  });
}
