import type { TraceEvent } from "../domain/trace.js";
import type { TraceSink } from "../domain/ports.js";

/** In-memory `TraceSink` for isolated development and tests. */
export class RecordingTraceSink implements TraceSink {
  readonly events: TraceEvent[] = [];

  async append(event: TraceEvent): Promise<void> {
    this.events.push(structuredClone(event));
  }

  typesEmitted(): string[] {
    return this.events.map((event) => event.type);
  }
}
