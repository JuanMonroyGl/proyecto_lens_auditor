const GEMINI_MODEL = "gemini-2.5-pro";
const GEMINI_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta";
const PROMPT_TOKEN_THRESHOLD = 200000;
const GEMINI_2_5_PRO_PRICING = {
  currency: "USD",
  model: GEMINI_MODEL,
  source: "https://ai.google.dev/gemini-api/docs/pricing",
  standard: {
    promptUnderOrEqual200k: { inputPerMillion: 1.25, outputPerMillion: 10 },
    promptOver200k: { inputPerMillion: 2.5, outputPerMillion: 15 }
  }
};

export async function buildAiRecommendations({ scan, targetArchitecture }) {
  const model = process.env.GEMINI_MODEL || GEMINI_MODEL;
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || "";
  const prompt = buildRecommendationPrompt(scan, targetArchitecture);
  const fallback = buildLocalAdvice(scan, targetArchitecture);

  if (!apiKey) {
    const inputTokens = estimateTokens(prompt);

    return {
      ...fallback,
      available: false,
      generatedAt: new Date().toISOString(),
      model,
      provider: "gemini",
      setup: {
        envFile: "server/.env",
        keyName: "GEMINI_API_KEY",
        optionalModelName: "GEMINI_MODEL"
      },
      source: "local-fallback",
      status: "missing-api-key",
      usage: {
        estimated: true,
        inputTokens,
        outputTokens: 0,
        totalTokens: inputTokens,
        estimatedCostUsd: 0,
        estimatedIfSentUsd: calculateGeminiCost({ inputTokens, outputTokens: 0 }).totalUsd,
        pricing: GEMINI_2_5_PRO_PRICING
      }
    };
  }

  const response = await fetch(`${GEMINI_ENDPOINT}/models/${model}:generateContent?key=${apiKey}`, {
    body: JSON.stringify({
      contents: [
        {
          role: "user",
          parts: [{ text: prompt }]
        }
      ],
      generationConfig: {
        responseMimeType: "application/json",
        temperature: 0.35
      }
    }),
    headers: { "Content-Type": "application/json" },
    method: "POST"
  });
  const payload = await response.json();

  if (!response.ok) {
    const message = payload?.error?.message || "Gemini no pudo generar recomendaciones.";
    throw new Error(message);
  }

  const text = payload?.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("\n") ?? "";
  const parsed = parseJsonResponse(text);
  const usageMetadata = payload?.usageMetadata ?? {};
  const inputTokens = Number(usageMetadata.promptTokenCount ?? estimateTokens(prompt));
  const outputTokens = Number(usageMetadata.candidatesTokenCount ?? estimateTokens(text));
  const thinkingTokens = Number(usageMetadata.thoughtsTokenCount ?? 0);
  const totalTokens = Number(usageMetadata.totalTokenCount ?? inputTokens + outputTokens + thinkingTokens);
  const cost = calculateGeminiCost({ inputTokens, outputTokens: outputTokens + thinkingTokens });

  return normalizeAiPayload({
    fallback,
    model,
    payload: parsed,
    usage: {
      estimated: false,
      inputTokens,
      outputTokens,
      thinkingTokens,
      totalTokens,
      estimatedCostUsd: cost.totalUsd,
      inputCostUsd: cost.inputUsd,
      outputCostUsd: cost.outputUsd,
      pricing: GEMINI_2_5_PRO_PRICING
    }
  });
}

function buildRecommendationPrompt(scan, targetArchitecture) {
  const compact = compactScan(scan);
  const targetCopy = targetArchitecture
    ? `El usuario esta evaluando migrar visualmente hacia: ${targetArchitecture}.`
    : "Sugiere una arquitectura objetivo si detectas una mejor opcion.";

  return [
    "Eres un arquitecto senior revisando un proyecto con Project Lens.",
    "Reglas estrictas:",
    "- Responde en espanol claro para developers, Project Managers y Product Owners.",
    "- No propongas modificar archivos automaticamente; el resultado es visual y de planeacion.",
    "- Usa SOLO la metadata recibida: rutas, capas, conteos, scores, imports resumidos y relaciones. No inventes contenido fuente.",
    "- Evita recomendaciones genericas. Cada recomendacion debe mencionar evidencia concreta del scan.",
    "- Si propones una arquitectura destino, explica por que encaja y como migrar por fases.",
    targetCopy,
    "",
    "Devuelve JSON valido con esta forma exacta:",
    JSON.stringify(
      {
        executiveSummary: "lectura corta del proyecto",
        recommendations: [
          {
            title: "accion recomendada",
            detail: "evidencia y recomendacion concreta",
            severity: "high | medium | low",
            impact: "beneficio esperado",
            effort: "S | M | L",
            files: ["ruta/opcional.js"],
            layer: "capa opcional"
          }
        ],
        architecture: {
          current: "arquitectura detectada",
          confidence: "alta | media | baja",
          evidence: ["senal concreta"],
          recommended: "arquitectura sugerida",
          rationale: "por que seria mejor",
          migrationPlan: [
            {
              phase: "1",
              title: "fase",
              detail: "que hacer visualmente",
              files: ["ruta/opcional.js"],
              risk: "riesgo"
            }
          ]
        }
      },
      null,
      2
    ),
    "",
    "Metadata del scan:",
    JSON.stringify(compact, null, 2)
  ].join("\n");
}

function compactScan(scan) {
  const architecture = scan?.architectureInsights ?? {};
  const files = scan?.files ?? [];

  return {
    totals: scan?.totals,
    stack: architecture.stack ?? [],
    detectedArchitecture: architecture.pattern,
    layers: (architecture.layers ?? []).map((layer) => ({
      label: layer.label,
      files: layer.files,
      lines: layer.lines,
      description: layer.description,
      examples: layer.examples
    })),
    relations: (architecture.relations ?? []).slice(0, 12),
    localRecommendations: scan?.recommendations ?? [],
    couplingAlerts: (scan?.couplingAlerts ?? []).slice(0, 12),
    topFiles: files
      .map((file) => ({
        path: file.relativePath,
        category: file.categoryLabel,
        layer: file.fileInsights?.layer,
        role: file.fileInsights?.role,
        lines: file.lines,
        score: file.refactorScore,
        fanIn: file.codeMetrics?.fanIn,
        fanOut: file.codeMetrics?.fanOut,
        signals: file.signals?.map((signal) => signal.title ?? signal.message ?? signal.type).slice(0, 3)
      }))
      .sort((a, b) => b.score - a.score || b.lines - a.lines)
      .slice(0, 80)
  };
}

function normalizeAiPayload({ fallback, model, payload, usage }) {
  return {
    available: true,
    executiveSummary: cleanString(payload.executiveSummary) || fallback.executiveSummary,
    generatedAt: new Date().toISOString(),
    model,
    provider: "gemini",
    recommendations: normalizeRecommendations(payload.recommendations, fallback.recommendations),
    architecture: normalizeArchitecture(payload.architecture, fallback.architecture),
    source: "gemini",
    status: "ok",
    usage
  };
}

function normalizeRecommendations(items, fallbackItems) {
  const source = Array.isArray(items) && items.length > 0 ? items : fallbackItems;

  return source.slice(0, 8).map((item, index) => ({
    title: cleanString(item.title) || `Recomendacion ${index + 1}`,
    detail: cleanString(item.detail) || "Revisa esta zona con mas detalle.",
    severity: ["high", "medium", "low"].includes(item.severity) ? item.severity : "medium",
    impact: cleanString(item.impact) || "Mejora claridad y reduce riesgo de cambios.",
    effort: cleanString(item.effort) || "M",
    files: Array.isArray(item.files) ? item.files.map(String).slice(0, 5) : [],
    layer: cleanString(item.layer)
  }));
}

function normalizeArchitecture(item, fallbackItem) {
  const source = item && typeof item === "object" ? item : fallbackItem;

  return {
    current: cleanString(source.current) || fallbackItem.current,
    confidence: cleanString(source.confidence) || fallbackItem.confidence,
    evidence: Array.isArray(source.evidence) ? source.evidence.map(String).slice(0, 6) : fallbackItem.evidence,
    recommended: cleanString(source.recommended) || fallbackItem.recommended,
    rationale: cleanString(source.rationale) || fallbackItem.rationale,
    migrationPlan: normalizeMigrationPlan(source.migrationPlan, fallbackItem.migrationPlan)
  };
}

function normalizeMigrationPlan(items, fallbackItems) {
  const source = Array.isArray(items) && items.length > 0 ? items : fallbackItems;

  return source.slice(0, 6).map((item, index) => ({
    phase: cleanString(item.phase) || String(index + 1),
    title: cleanString(item.title) || `Fase ${index + 1}`,
    detail: cleanString(item.detail) || "Ordena esta parte antes de mover codigo.",
    files: Array.isArray(item.files) ? item.files.map(String).slice(0, 5) : [],
    risk: cleanString(item.risk) || "Riesgo medio si se mueve sin pruebas."
  }));
}

function buildLocalAdvice(scan, targetArchitecture) {
  const architecture = scan?.architectureInsights ?? {};
  const pattern = architecture.pattern ?? {};
  const highFiles = [...(scan?.files ?? [])]
    .sort((a, b) => b.refactorScore - a.refactorScore || b.lines - a.lines)
    .slice(0, 5);
  const recommended =
    targetArchitecture ||
    architecture.recommendedPattern?.name ||
    pattern.recommendedTarget ||
    "Arquitectura modular por capas";

  return {
    executiveSummary:
      pattern.summary ||
      "Project Lens detecto una estructura local y preparo recomendaciones con reglas internas mientras configuras Gemini.",
    recommendations: [
      {
        title: "Atacar primero los archivos con mas senales",
        detail: highFiles.length
          ? `${highFiles.map((file) => file.relativePath).join(", ")} concentran score, lineas o conexiones. Conviene convertirlos en el primer bloque de refactor.`
          : "No hay hotspots fuertes; usa snapshots para medir cada mejora pequena.",
        severity: highFiles.some((file) => file.refactorScore >= 60) ? "high" : "medium",
        impact: "Reduce riesgo antes de discutir cambios grandes de arquitectura.",
        effort: "M",
        files: highFiles.map((file) => file.relativePath),
        layer: highFiles[0]?.fileInsights?.layer ?? ""
      },
      {
        title: `Evaluar migracion hacia ${recommended}`,
        detail:
          "La migracion debe planearse por contratos y carpetas, no moviendo todo de una vez. Primero separa entradas, casos de uso, dominio e infraestructura de forma visual.",
        severity: "medium",
        impact: "Da una ruta compartida para PM, PO y developers sin modificar archivos automaticamente.",
        effort: "L",
        files: highFiles.slice(0, 3).map((file) => file.relativePath),
        layer: ""
      }
    ],
    architecture: {
      current: pattern.name ?? "Arquitectura mixta detectada",
      confidence: pattern.confidence ?? "media",
      evidence: pattern.evidence ?? [],
      recommended,
      rationale:
        architecture.recommendedPattern?.reason ||
        "Puede mejorar separacion de responsabilidades, testabilidad y lectura del sistema.",
      migrationPlan: buildLocalMigrationPlan(scan, recommended)
    }
  };
}

function buildLocalMigrationPlan(scan, targetArchitecture) {
  const topFiles = [...(scan?.files ?? [])]
    .sort((a, b) => b.refactorScore - a.refactorScore || b.lines - a.lines)
    .slice(0, 8);

  return [
    {
      phase: "1",
      title: "Dibujar limites actuales",
      detail: "Agrupa visualmente archivos por entrada, reglas, datos, configuracion y pruebas antes de mover carpetas.",
      files: topFiles.slice(0, 3).map((file) => file.relativePath),
      risk: "Bajo; es una lectura visual."
    },
    {
      phase: "2",
      title: `Proponer destino ${targetArchitecture}`,
      detail: "Marca que archivos vivirian en cada capa destino y que dependencias deberian quedar apuntando hacia adentro.",
      files: topFiles.slice(3, 6).map((file) => file.relativePath),
      risk: "Medio si no se validan contratos entre capas."
    },
    {
      phase: "3",
      title: "Medir con antes vs despues",
      detail: "Usa commits o snapshots para validar que bajan fan-out, tamano de hotspots y conexiones cruzadas.",
      files: topFiles.slice(6, 8).map((file) => file.relativePath),
      risk: "Bajo; ayuda a evitar refactors esteticos sin mejora real."
    }
  ];
}

function parseJsonResponse(text) {
  try {
    return JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);

    if (!match) {
      throw new Error("Gemini respondio sin JSON valido.");
    }

    return JSON.parse(match[0]);
  }
}

function calculateGeminiCost({ inputTokens, outputTokens }) {
  const tier =
    inputTokens > PROMPT_TOKEN_THRESHOLD
      ? GEMINI_2_5_PRO_PRICING.standard.promptOver200k
      : GEMINI_2_5_PRO_PRICING.standard.promptUnderOrEqual200k;
  const inputUsd = (inputTokens / 1_000_000) * tier.inputPerMillion;
  const outputUsd = (outputTokens / 1_000_000) * tier.outputPerMillion;

  return {
    inputUsd: roundMoney(inputUsd),
    outputUsd: roundMoney(outputUsd),
    totalUsd: roundMoney(inputUsd + outputUsd)
  };
}

function estimateTokens(text) {
  return Math.ceil(String(text ?? "").length / 4);
}

function cleanString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function roundMoney(value) {
  return Number(value.toFixed(6));
}
