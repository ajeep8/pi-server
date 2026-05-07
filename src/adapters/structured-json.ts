import { readFileSync } from "node:fs";
import type { ExtensionUIRequest } from "../rpc/protocol.js";
import type { AdapterOutput } from "./types.js";

interface ClarifyingQuestion {
  id: string;
  label: string;
  inputType: "text";
  required: boolean;
}

interface ArtifactCandidate {
  type: string;
  title: string;
  content: string;
  intro: string;
  outro: string;
}

interface StructuredResponse {
  kind: "chat_text" | "rich_payload" | "clarifying_questions" | "artifact_draft";
  text: string;
  clarifyingQuestions: ClarifyingQuestion[];
  rich: unknown;
  artifactCandidate: ArtifactCandidate | null;
}

const CUSTOM_WIDGET_KEYS = new Set(["push_file", "structured_content"]);

export function structuredJsonAdapter(request: ExtensionUIRequest): AdapterOutput {
  if (request.method === "setWidget" && CUSTOM_WIDGET_KEYS.has(request.widgetKey as string)) {
    return handleCustomWidget(request);
  }

  const params = resolveParams(request);
  const response = buildStructuredResponse(request.method, params);

  return {
    type: "content",
    content: JSON.stringify(response),
    finishReason: "stop",
  };
}

function handleCustomWidget(request: ExtensionUIRequest): AdapterOutput {
  const widgetKey = request.widgetKey as string;
  const widgetLines = request.widgetLines as string[] | undefined;
  const payload = widgetLines?.[0] ?? "{}";

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(payload);
  } catch {
    parsed = { raw: payload };
  }

  if (widgetKey === "push_file") {
    return handlePushFile(parsed);
  }

  const response: StructuredResponse = {
    kind: "rich_payload",
    text: "",
    clarifyingQuestions: [],
    rich: { type: widgetKey, ...parsed },
    artifactCandidate: null,
  };

  return {
    type: "content",
    content: JSON.stringify(response),
    finishReason: "stop",
  };
}

function handlePushFile(parsed: Record<string, unknown>): AdapterOutput {
  const filePath = parsed.path as string;
  const filename = (parsed.filename as string) ?? "file";

  let content: string;
  try {
    content = readFileSync(filePath, "utf-8");
  } catch {
    content = `Error: could not read file at ${filePath}`;
  }

  const response: StructuredResponse = {
    kind: "artifact_draft",
    text: "",
    clarifyingQuestions: [],
    rich: null,
    artifactCandidate: {
      type: "Document",
      title: filename,
      content,
      intro: "Here's the generated document.",
      outro: "",
    },
  };

  return {
    type: "content",
    content: JSON.stringify(response),
    finishReason: "stop",
  };
}

function resolveParams(request: ExtensionUIRequest): Record<string, unknown> {
  if (request.params && typeof request.params === "object") {
    return request.params as Record<string, unknown>;
  }
  const { type: _, id: __, method: ___, params: ____, ...rest } = request;
  return rest;
}

function buildStructuredResponse(method: string, params: Record<string, unknown>): StructuredResponse {
  switch (method) {
    case "askQuestion":
    case "ask_question":
      return buildClarifyingQuestions(params);
    case "showArtifact":
    case "show_artifact":
      return buildArtifactDraft(params);
    default:
      return buildRichPayload(params);
  }
}

function buildClarifyingQuestions(params: Record<string, unknown>): StructuredResponse {
  const questions = Array.isArray(params.questions) ? params.questions : [];
  const clarifyingQuestions: ClarifyingQuestion[] = questions.map((q: unknown, i: number) => {
    if (typeof q === "string") {
      return { id: `q${i + 1}`, label: q, inputType: "text" as const, required: true };
    }
    const obj = q as Record<string, unknown>;
    return {
      id: (obj.id as string) ?? `q${i + 1}`,
      label: (obj.label as string) ?? (obj.text as string) ?? String(q),
      inputType: "text" as const,
      required: true,
    };
  });

  return {
    kind: "clarifying_questions",
    text: (params.text as string) ?? "",
    clarifyingQuestions,
    rich: null,
    artifactCandidate: null,
  };
}

function buildArtifactDraft(params: Record<string, unknown>): StructuredResponse {
  return {
    kind: "artifact_draft",
    text: "",
    clarifyingQuestions: [],
    rich: null,
    artifactCandidate: {
      type: ((params.type as string) ?? "Document").slice(0, 120),
      title: ((params.title as string) ?? "Untitled").slice(0, 120),
      content: (params.content as string) ?? "",
      intro: (params.intro as string) ?? "",
      outro: (params.outro as string) ?? "",
    },
  };
}

function buildRichPayload(params: Record<string, unknown>): StructuredResponse {
  return {
    kind: "rich_payload",
    text: (params.text as string) ?? "",
    clarifyingQuestions: [],
    rich: params,
    artifactCandidate: null,
  };
}
