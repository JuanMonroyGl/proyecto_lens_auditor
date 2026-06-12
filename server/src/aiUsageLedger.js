import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ledgerPath = path.join(__dirname, "..", ".project-lens", "ai-usage-ledger.json");

const emptyLedger = {
  currency: "USD",
  estimatedCostUsd: 0,
  inputTokens: 0,
  lastCostUsd: 0,
  lastModel: "",
  lastRequestAt: "",
  lastSource: "",
  outputTokens: 0,
  requestCount: 0,
  thinkingTokens: 0,
  totalTokens: 0,
  version: 1
};

export async function readAiUsageLedger() {
  try {
    const raw = await fs.readFile(ledgerPath, "utf8");
    return normalizeLedger(JSON.parse(raw));
  } catch (error) {
    if (error?.code === "ENOENT") {
      return { ...emptyLedger };
    }

    throw error;
  }
}

export async function resetAiUsageLedger() {
  const ledger = { ...emptyLedger };
  await writeLedger(ledger);
  return ledger;
}

export async function attachAiUsageTotal(advice) {
  const current = await readAiUsageLedger();

  if (advice?.source !== "gemini" || advice?.status !== "ok" || advice?.usage?.estimated) {
    return { ...advice, usageTotal: current, usageRecorded: false };
  }

  const usage = advice.usage ?? {};
  const next = normalizeLedger({
    ...current,
    estimatedCostUsd: roundMoney(current.estimatedCostUsd + Number(usage.estimatedCostUsd ?? 0)),
    inputTokens: current.inputTokens + toInteger(usage.inputTokens),
    lastCostUsd: roundMoney(Number(usage.estimatedCostUsd ?? 0)),
    lastModel: advice.model ?? current.lastModel,
    lastRequestAt: new Date().toISOString(),
    lastSource: advice.source,
    outputTokens: current.outputTokens + toInteger(usage.outputTokens),
    requestCount: current.requestCount + 1,
    thinkingTokens: current.thinkingTokens + toInteger(usage.thinkingTokens),
    totalTokens: current.totalTokens + toInteger(usage.totalTokens)
  });

  await writeLedger(next);

  return { ...advice, usageTotal: next, usageRecorded: true };
}

function normalizeLedger(value) {
  return {
    ...emptyLedger,
    ...value,
    estimatedCostUsd: roundMoney(Number(value?.estimatedCostUsd ?? 0)),
    inputTokens: toInteger(value?.inputTokens),
    lastCostUsd: roundMoney(Number(value?.lastCostUsd ?? 0)),
    outputTokens: toInteger(value?.outputTokens),
    requestCount: toInteger(value?.requestCount),
    thinkingTokens: toInteger(value?.thinkingTokens),
    totalTokens: toInteger(value?.totalTokens)
  };
}

async function writeLedger(ledger) {
  await fs.mkdir(path.dirname(ledgerPath), { recursive: true });
  await fs.writeFile(ledgerPath, `${JSON.stringify(ledger, null, 2)}\n`, "utf8");
}

function toInteger(value) {
  return Number.isFinite(Number(value)) ? Math.max(0, Math.round(Number(value))) : 0;
}

function roundMoney(value) {
  return Number(value.toFixed(6));
}