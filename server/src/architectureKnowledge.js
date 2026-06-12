import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const catalogPath = path.join(__dirname, "data", "architectureCatalog.json");
const catalog = JSON.parse(fs.readFileSync(catalogPath, "utf8"));
const MIN_PRIMARY_SCORE = 28;

export function getArchitectureCatalog() {
  return catalog;
}

export function evaluateArchitectureCatalog({ dependencies, files, layers, packageManifests, projectProfile }) {
  const context = buildScoringContext({ dependencies, files, layers, packageManifests, projectProfile });
  const matches = catalog.architectures
    .map((architecture) => scoreArchitecture(architecture, context))
    .sort((a, b) => b.score - a.score || b.evidence.length - a.evidence.length);
  const primary = matches[0]?.score >= MIN_PRIMARY_SCORE ? matches[0] : buildInconclusiveMatch(matches[0]);
  const secondary = matches
    .filter((match) => match.id !== primary.id && match.score >= Math.max(18, primary.score - 24))
    .slice(0, 3);
  const recommendedTargets = buildRecommendedTargets(primary, secondary, matches);

  return {
    catalogVersion: catalog.version,
    primaryArchitecture: primary,
    secondaryArchitectures: secondary,
    architectureMatches: matches,
    recommendedArchitectureTargets: recommendedTargets,
    evidence: primary.evidence,
    contradictions: primary.contradictions,
    migrationPaths: buildMigrationPaths(primary, recommendedTargets)
  };
}

function buildScoringContext({ dependencies, files, layers, packageManifests, projectProfile }) {
  const normalizedFiles = files.map((file) => ({
    ...file,
    lowerPath: file.relativePath.toLowerCase(),
    lowerName: path.posix.basename(file.relativePath).toLowerCase(),
    lowerFolder: String(file.parentFolder ?? file.folder ?? "").toLowerCase(),
    segments: file.relativePath.toLowerCase().split(/[\\/]+/)
  }));
  const dependencyNames = new Set(
    (packageManifests ?? [])
      .flatMap((manifest) => manifest.dependencies ?? [])
      .map((item) => item.toLowerCase())
  );
  const edges = dependencies?.edges ?? [];
  const layerLabels = new Set((layers ?? []).map((layer) => layer.label));

  return {
    dependencyNames,
    edges,
    files: normalizedFiles,
    layers: layers ?? [],
    layerLabels,
    packageManifests: packageManifests ?? [],
    projectProfile: projectProfile ?? {},
    sourceFileCount: normalizedFiles.filter((file) => file.category === "source").length
  };
}

function scoreArchitecture(architecture, context) {
  const evidence = [];
  const contradictions = [];
  const detection = architecture.detection ?? {};

  collectSignals(detection.folders, "folder", architecture, context, evidence);
  collectSignals(detection.files, "file", architecture, context, evidence);
  collectSignals(detection.dependencies, "dependency", architecture, context, evidence);
  collectSignals(detection.imports, "import", architecture, context, evidence);
  collectSignals(detection.patterns, "pattern", architecture, context, evidence);
  collectSignals(detection.negative_signals, "contradiction", architecture, context, contradictions);
  addProjectShapeSignals(architecture, context, evidence, contradictions);

  const positiveScore = evidence.reduce((total, item) => total + item.weight, 0);
  const negativeScore = contradictions.reduce((total, item) => total + item.weight, 0);
  const score = Math.max(0, Math.min(100, Math.round(positiveScore - negativeScore * 0.7)));

  return {
    id: architecture.id,
    name: architecture.name,
    aliases: architecture.aliases ?? [],
    family: architecture.family,
    description: architecture.description,
    confidence: confidenceFromScore(score),
    complexity: architecture.complexity,
    projectTypes: architecture.project_types ?? [],
    score,
    evidence: evidence.sort((a, b) => b.weight - a.weight).slice(0, 10),
    contradictions: contradictions.sort((a, b) => b.weight - a.weight).slice(0, 8),
    badSmells: architecture.bad_smells ?? [],
    advantages: architecture.advantages ?? [],
    risks: architecture.risks ?? [],
    migrationFrom: architecture.migration_from ?? [],
    migrationTo: architecture.migration_to ?? [],
    visualRefactors: architecture.visual_refactors ?? [],
    uiHints: architecture.ui_hints ?? {},
    explanations: architecture.explanations ?? {},
    comparison: architecture.comparison ?? {}
  };
}

function collectSignals(signals = [], type, architecture, context, output) {
  for (const signal of signals) {
    const matches = findSignalMatches(signal, type, architecture, context);

    for (const match of matches.slice(0, 4)) {
      output.push({
        type,
        label: buildSignalLabel(signal, match),
        location: match.location,
        pattern: signal.pattern,
        weight: Number(signal.weight ?? 1),
        source: signal.evidence_type ?? type
      });
    }
  }
}

function findSignalMatches(signal, type, architecture, context) {
  if (!signal?.pattern) {
    return [];
  }

  if (type === "dependency") {
    return [...context.dependencyNames]
      .filter((dependency) => matchesText(dependency, signal.pattern, signal.match_type))
      .map((dependency) => ({ value: dependency, location: dependency }));
  }

  if (signal.match_type === "relation" || type === "import" || type === "contradiction") {
    return matchRelationSignal(signal, context);
  }

  if (signal.match_type === "composite" || type === "pattern") {
    return matchCompositeSignal(signal, architecture, context);
  }

  if (type === "folder") {
    return context.files
      .filter((file) => matchesPathOrSegment(file.lowerFolder || file.lowerPath, file.segments, signal))
      .map((file) => ({ value: file.relativePath, location: file.parentFolder || file.relativePath }));
  }

  return context.files
    .filter((file) => matchesText(file.lowerName, signal.pattern, signal.match_type) || matchesText(file.lowerPath, signal.pattern, signal.match_type))
    .map((file) => ({ value: file.relativePath, location: file.relativePath }));
}

function matchRelationSignal(signal, context) {
  const relation = String(signal.pattern).toLowerCase().split("->");

  if (relation.length !== 2) {
    return [];
  }

  const [fromPattern, toPattern] = relation.map((item) => item.trim());

  return context.edges
    .filter((edge) => matchesPathPart(edge.from, fromPattern) && matchesPathPart(edge.to, toPattern))
    .map((edge) => ({ value: `${edge.from} -> ${edge.to}`, location: `${edge.from} -> ${edge.to}` }));
}

function matchCompositeSignal(signal, architecture, context) {
  const pattern = String(signal.pattern).toLowerCase();
  const hasUi = context.layerLabels.has("UI / Frontend") || context.files.some((file) => file.lowerPath.includes("client/"));
  const hasApi = context.layerLabels.has("API Backend") || context.files.some((file) => file.lowerPath.includes("server/"));
  const hasDomainLike = context.files.some((file) => /domain|core|model|entity|application|usecase|use_case/.test(file.lowerPath));
  const hasControllerService = context.files.some((file) => /controller|route/.test(file.lowerPath)) && context.files.some((file) => /service|application|usecase/.test(file.lowerPath));
  const hasMultipleApps = context.files.filter((file) => /(^|\/)package\.json$/.test(file.lowerPath)).length > 1;

  if (pattern.includes("single_deployable") && hasUi && hasApi) {
    return [{ value: "frontend + backend en un repo", location: "root" }];
  }

  if (pattern.includes("layered") && hasControllerService) {
    return [{ value: "entrada + servicio/aplicacion", location: "source tree" }];
  }

  if ((pattern.includes("domain") || architecture.family === "concentric_domain_core") && hasDomainLike) {
    return [{ value: "nombres de dominio/aplicacion", location: "source tree" }];
  }

  if ((pattern.includes("module") || architecture.id === "modular_monolith") && (hasMultipleApps || context.layers.length >= 5)) {
    return [{ value: "varias zonas internas", location: "architecture layers" }];
  }

  if (architecture.id === "microfrontends" && hasUi && hasMultipleApps) {
    return [{ value: "frontend con multiples package.json", location: "client packages" }];
  }

  return [];
}

function addProjectShapeSignals(architecture, context, evidence, contradictions) {
  const hasUi = context.layerLabels.has("UI / Frontend") || context.files.some((file) => file.lowerPath.includes("client/"));
  const hasApi = context.layerLabels.has("API Backend") || context.files.some((file) => file.lowerPath.includes("server/"));
  const packageCount = context.files.filter((file) => /(^|\/)package\.json$/.test(file.lowerPath)).length;
  const hasManyInternalLayers = context.layers.length >= 5;

  if (architecture.id === "modular_monolith" && hasUi && hasApi && hasManyInternalLayers) {
    evidence.push({
      type: "pattern",
      label: "Un solo repo combina UI, API y varias zonas internas",
      location: "root",
      pattern: "ui_api_internal_modules",
      weight: 24,
      source: "derived_shape"
    });
  }

  if (architecture.id === "layered_n_tier" && hasUi && hasApi) {
    evidence.push({
      type: "pattern",
      label: "Se ven capas tecnicas de presentacion y backend",
      location: "root",
      pattern: "presentation_backend_layers",
      weight: 16,
      source: "derived_shape"
    });
  }

  if (architecture.id === "microservices" && packageCount <= 3) {
    contradictions.push({
      type: "contradiction",
      label: "No hay muchos paquetes/despliegues independientes visibles",
      location: "root",
      pattern: "single_repo_low_package_count",
      weight: 16,
      source: "derived_shape"
    });
  }

  if (architecture.id === "serverless_architecture" && !context.files.some((file) => /serverless|lambda|function|trigger/.test(file.lowerPath))) {
    contradictions.push({
      type: "contradiction",
      label: "No aparecen funciones, triggers o manifiestos serverless claros",
      location: "root",
      pattern: "missing_serverless_markers",
      weight: 12,
      source: "derived_shape"
    });
  }
}

function buildRecommendedTargets(primary, secondary, matches) {
  const ids = [...(primary.migrationTo ?? []), ...secondary.flatMap((item) => item.migrationTo ?? [])];
  const byId = new Map(catalog.architectures.map((item) => [item.id, item]));
  const targets = [];

  for (const id of ids) {
    const architecture = byId.get(id);

    if (!architecture || architecture.id === primary.id || targets.some((item) => item.id === architecture.id)) {
      continue;
    }

    const match = matches.find((item) => item.id === architecture.id);
    targets.push(buildTargetOption(architecture, match));
  }

  if (targets.length === 0) {
    for (const match of matches.filter((item) => item.id !== primary.id).slice(0, 3)) {
      const architecture = byId.get(match.id);

      if (architecture) {
        targets.push(buildTargetOption(architecture, match));
      }
    }
  }

  return targets.slice(0, 4);
}

function buildTargetOption(architecture, match) {
  const refactor = architecture.visual_refactors?.[0];

  return {
    id: architecture.id,
    name: architecture.name,
    fit: confidenceFromScore(match?.score ?? 35),
    score: match?.score ?? 0,
    reason: refactor?.intent ?? architecture.description,
    bestFor: architecture.when_to_use?.slice(0, 3).join(" / ") || architecture.project_types?.slice(0, 3).join(" / ") || "evolucion arquitectonica",
    diagramType: architecture.ui_hints?.diagram_type ?? "layers",
    phases: buildMigrationPhases(architecture)
  };
}

function buildMigrationPaths(primary, targets) {
  return targets.map((target) => ({
    from: primary.id,
    fromName: primary.name,
    to: target.id,
    toName: target.name,
    phases: target.phases,
    diagramType: target.diagramType
  }));
}

function buildMigrationPhases(architecture) {
  const diagram = architecture.ui_hints?.diagram_type ?? "layers";

  return [
    {
      title: "Mapear evidencia",
      detail: `Marcar carpetas, archivos y relaciones que ya parecen ${architecture.name}.`,
      focus: "evidence"
    },
    {
      title: "Separar limites visuales",
      detail: `Usar una vista ${diagram} para mostrar contratos y dependencias permitidas sin mover archivos.`,
      focus: diagram
    },
    {
      title: "Medir mejora",
      detail: "Comparar commits o snapshots para validar que bajan acoplamiento, fan-out y hotspots.",
      focus: "antes vs despues"
    }
  ];
}

function buildInconclusiveMatch(bestMatch) {
  return {
    id: "inconclusive",
    name: "Arquitectura no concluyente",
    aliases: [],
    family: "unknown",
    description: "La metadata no alcanza para afirmar una arquitectura dominante.",
    confidence: "baja",
    complexity: "desconocida",
    projectTypes: [],
    score: bestMatch?.score ?? 0,
    evidence: bestMatch?.evidence?.slice(0, 4) ?? [],
    contradictions: bestMatch?.contradictions?.slice(0, 4) ?? [],
    badSmells: [],
    advantages: [],
    risks: ["Conviene revisar estructura y dependencias antes de elegir una migracion."],
    migrationFrom: [],
    migrationTo: ["modular_monolith", "layered_n_tier"],
    visualRefactors: [],
    uiHints: { diagram_type: "layers" },
    explanations: {},
    comparison: {}
  };
}

function matchesPathOrSegment(value, segments, signal) {
  if (signal.match_type === "segment") {
    return segments.includes(String(signal.pattern).toLowerCase()) || String(value).split(/[\\/]+/).includes(String(signal.pattern).toLowerCase());
  }

  return matchesText(value, signal.pattern, signal.match_type);
}

function matchesPathPart(filePath, pattern) {
  const normalized = String(filePath ?? "").toLowerCase();
  const cleanPattern = String(pattern ?? "").replace(/s$/, "");

  return normalized.includes(cleanPattern) || normalized.includes(`${cleanPattern}s`);
}

function matchesText(value, pattern, matchType) {
  const text = String(value ?? "").toLowerCase();
  const rawPattern = String(pattern ?? "").toLowerCase();

  if (!rawPattern) {
    return false;
  }

  if (matchType === "regex") {
    try {
      return new RegExp(rawPattern, "i").test(value);
    } catch {
      return text.includes(rawPattern);
    }
  }

  if (matchType === "segment") {
    return text.split(/[\\/._-]+/).includes(rawPattern);
  }

  return text.includes(rawPattern);
}

function buildSignalLabel(signal, match) {
  const example = signal.examples?.[0];
  const source = example ? `${signal.pattern} (${example})` : signal.pattern;

  return `${source}: ${match.location}`;
}

function confidenceFromScore(score) {
  if (score >= 70) {
    return "alta";
  }

  if (score >= 38) {
    return "media";
  }

  return "baja";
}
