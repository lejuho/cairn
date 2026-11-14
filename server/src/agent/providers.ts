import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentProvider, AgentProviderInfo } from "@cairn/shared";
import { getLlmModel } from "../llm/config.js";
import type { LlmGateway } from "../llm/gateway.js";

// Each provider is used as a plain text generator: system prompt + conversation in, one text
// reply out. The model gets NO tools of its own (no shell, no files, no MCP) — everything it
// can do in Cairn goes through the action list the agent loop validates and executes.
//
// The user chose subscription CLIs over metered API keys: Anthropic through the `claude` CLI,
// OpenAI through the `codex` CLI, xAI Grok through the existing OAuth-session proxy.

export type CompleteInput = { provider: AgentProvider; model: string; system: string; prompt: string };
export type Complete = (input: CompleteInput) => Promise<string>;

const TIMEOUT_MS = 150_000;

function findBinary(envName: string, candidates: string[]): string | null {
  const configured = process.env[envName]?.trim();
  if (configured) return existsSync(configured) ? configured : null;
  return candidates.find((p) => existsSync(p)) ?? null;
}

function claudeBin(): string | null {
  return findBinary("CAIRN_CLAUDE_BIN", [join(homedir(), ".local/bin/claude"), "/usr/local/bin/claude", "/usr/bin/claude"]);
}

function codexBin(): string | null {
  return findBinary("CAIRN_CODEX_BIN", [join(homedir(), ".npm-global/bin/codex"), "/usr/local/bin/codex", "/usr/bin/codex"]);
}

// An empty working directory: the CLIs must not pick up a project's instruction files.
function workDir(): string {
  const dir = join(tmpdir(), "cairn-agent");
  mkdirSync(dir, { recursive: true });
  return dir;
}

function run(bin: string, args: string[], stdin: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { cwd: workDir(), stdio: ["pipe", "pipe", "pipe"] });
    let out = "";
    let err = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("응답 시간이 초과됐습니다"));
    }, TIMEOUT_MS);
    child.stdout.on("data", (chunk: Buffer) => { out += chunk.toString(); });
    child.stderr.on("data", (chunk: Buffer) => { err += chunk.toString(); });
    child.on("error", (e) => { clearTimeout(timer); reject(e); });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(out);
      else reject(new Error((err || out).trim().split("\n").slice(-3).join(" ").slice(0, 400) || `exit ${code}`));
    });
    child.stdin.on("error", () => undefined);
    child.stdin.end(stdin);
  });
}

async function completeAnthropic(model: string, system: string, prompt: string): Promise<string> {
  const bin = claudeBin();
  if (!bin) throw new Error("claude CLI를 찾을 수 없습니다");
  const out = await run(bin, [
    "-p",
    "--model", model,
    "--tools", "",                 // no built-in tools
    "--strict-mcp-config",         // and no MCP servers
    "--no-session-persistence",
    "--setting-sources", "",       // no user/project settings, so no hooks
    "--system-prompt", system,
    "--output-format", "json"
  ], prompt);
  const parsed = JSON.parse(out) as { result?: unknown; is_error?: boolean };
  if (parsed.is_error || typeof parsed.result !== "string") throw new Error("claude CLI가 답을 돌려주지 않았습니다");
  return parsed.result;
}

async function completeOpenAi(model: string, system: string, prompt: string): Promise<string> {
  const bin = codexBin();
  if (!bin) throw new Error("codex CLI를 찾을 수 없습니다");
  const dir = await mkdtemp(join(tmpdir(), "cairn-agent-codex-"));
  const outFile = join(dir, "last.txt");
  try {
    await run(bin, [
      "exec",
      "--skip-git-repo-check",
      "--ephemeral",
      "--sandbox", "read-only",
      "--color", "never",
      "-c", "mcp_servers={}",      // none of the user's MCP servers
      ...(model ? ["--model", model] : []),
      "-o", outFile,
      "-"
    ], `${system}\n\n${prompt}`);
    return await readFile(outFile, "utf-8");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function completeXai(gateway: LlmGateway | undefined, model: string, system: string, prompt: string): Promise<string> {
  if (!gateway) throw new Error("Grok 프록시가 연결되어 있지 않습니다");
  const result = await gateway.completeChat({
    model: model || getLlmModel(),
    messages: [{ role: "system", content: system }, { role: "user", content: prompt }]
  });
  if (!result.ok) throw new Error(`Grok 프록시 오류: ${result.error.message}`);
  const content = result.data.choices[0]?.message.content;
  if (typeof content !== "string" || !content.trim()) throw new Error("Grok 프록시가 빈 답을 돌려줬습니다");
  return content;
}

export function createComplete(gateway: LlmGateway | undefined): Complete {
  return ({ provider, model, system, prompt }) => {
    if (provider === "anthropic") return completeAnthropic(model || ANTHROPIC_MODELS[0]!.id, system, prompt);
    if (provider === "openai") return completeOpenAi(model, system, prompt);
    return completeXai(gateway, model, system, prompt);
  };
}

const ANTHROPIC_MODELS = [
  { id: "claude-opus-5-5", label: "Claude Opus 5.5" },
  { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5" },
  { id: "claude-haiku-5-5", label: "Claude Haiku 5.5" },
  { id: "claude-fable-5-2", label: "Claude Fable 5.2" }
];

// The model codex uses when none is named, read from the user's own config for display only.
function codexDefaultModel(): string | null {
  try {
    const text = readFileSync(join(homedir(), ".codex/config.toml"), "utf-8");
    return /^model\s*=\s*"([^"]+)"/m.exec(text)?.[1] ?? null;
  } catch {
    return null;
  }
}

export function listProviders(gateway: LlmGateway | undefined): AgentProviderInfo[] {
  const codexModel = codexDefaultModel();
  const grokModel = getLlmModel();
  return [
    {
      id: "anthropic", label: "Anthropic", available: claudeBin() !== null, via: "claude CLI (구독)",
      models: ANTHROPIC_MODELS, defaultModel: ANTHROPIC_MODELS[0]!.id, allowCustomModel: true
    },
    {
      id: "openai", label: "OpenAI", available: codexBin() !== null, via: "codex CLI (구독)",
      models: [{ id: "", label: codexModel ? `codex 기본 (${codexModel})` : "codex 기본" }], defaultModel: "", allowCustomModel: true
    },
    {
      id: "xai", label: "xAI Grok", available: gateway !== undefined, via: "Grok 프록시",
      models: [{ id: grokModel, label: grokModel }], defaultModel: grokModel, allowCustomModel: true
    }
  ];
}
