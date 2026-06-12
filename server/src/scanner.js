import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { StringDecoder } from "node:string_decoder";
import ignore from "ignore";
import { analyzeCodeFile, buildDependencyGraph } from "./codeAnalysis.js";
import { cleanPatterns, loadProjectLensConfig } from "./config.js";
import { enrichProjectInsights } from "./insights.js";

const DEFAULT_IGNORE_PATTERNS = [
  ".git",
  ".git/",
  ".venv/",
  "venv/",
  "node_modules/",
  "__pycache__/",
  ".cache/",
  "outputs/",
  "inputs/",
  "dist/",
  "build/",
  "coverage/",
  "tmp/",
  ".tmp-tests/",
  "tests_artifacts_tmp/",
  ".project-lens/",
  ".next/",
  "bin/",
  "obj/"
];

const GENERATED_PRESET_PATTERNS = [
  "out/",
  ".turbo/",
  ".vite/",
  "temp/",
  "logs/",
  "playwright-report/",
  "test-results/",
  "reports/",
  "artifacts/"
];

const CATEGORY_LABELS = {
  source: "Codigo productivo",
  tests: "Tests",
  artifacts: "Artefactos generados",
  config: "Configuracion",
  documentation: "Documentacion",
  dependencies_cache: "Dependencias/cache",
  unknown: "Desconocidos"
};

const MAX_IGNORED_EXAMPLES = 30;
const MAX_IGNORED_COUNTED_ENTRIES = 50000;

export async function scanProject(rootInput, options = {}) {
  const root = path.resolve(rootInput);
  const rootStats = await fs.stat(root);

  if (!rootStats.isDirectory()) {
    throw new Error("La ruta indicada no es una carpeta.");
  }

  const projectConfig = await loadProjectLensConfig(root);
  const scanOptions = normalizeScanOptions(options, projectConfig.config);
  const gitignorePatterns = await loadGitignorePatterns(root, scanOptions.useGitignore);
  const ignoreRules = buildIgnoreRules({
    configPatterns: projectConfig.config.exclude,
    disabledPatterns: scanOptions.disabledRules,
    generatedPatterns: scanOptions.useGeneratedPreset ? GENERATED_PRESET_PATTERNS : [],
    gitignorePatterns: gitignorePatterns.patterns,
    manualPatterns: scanOptions.manualIgnorePatterns
  });
  const ignoreMatcher = buildMatcher(ignoreRules.map((rule) => rule.pattern));
  const includeMatcher = buildMatcher(scanOptions.includeOverrides);
  const categoryMatchers = buildCategoryMatchers(projectConfig.config.categories);
  const activeIgnorePatterns = buildActiveIgnorePatterns(ignoreRules, scanOptions);

  const files = [];
  const folders = new Set(["."]);
  const errors = [...projectConfig.errors, ...gitignorePatterns.errors];
  const ignored = {
    ignoredFiles: 0,
    ignoredFolders: 0,
    ignoredExamples: [],
    ignoredByRule: new Map(),
    countedEntries: 0,
    countCapped: false
  };
  const context = {
    activeIgnorePatterns,
    categoryMatchers,
    errors,
    files,
    folders,
    ignored,
    ignoreMatcher,
    ignoreRules,
    includeMatcher,
    includeOverrides: scanOptions.includeOverrides,
    root,
    scanOptions,
    projectConfig: {
      loaded: projectConfig.loaded,
      path: projectConfig.path,
      config: projectConfig.config
    },
    gitignoreLoaded: gitignorePatterns.loaded
  };

  await walkDirectory(root, context, false);

  files.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  const dependencies = buildDependencyGraph(files);

  return buildScanResponse(context, dependencies);
}

async function walkDirectory(currentDirectory, context, includeOnly) {
  let entries;

  try {
    entries = await fs.readdir(currentDirectory, { withFileTypes: true });
  } catch (error) {
    context.errors.push({
      path: normalizeRelativePath(path.relative(context.root, currentDirectory)) || ".",
      message: error instanceof Error ? error.message : "No fue posible leer la carpeta."
    });
    return;
  }

  entries.sort((a, b) => a.name.localeCompare(b.name));

  for (const entry of entries) {
    if (entry.isSymbolicLink()) {
      continue;
    }

    const fullPath = path.join(currentDirectory, entry.name);
    const relativePath = normalizeRelativePath(path.relative(context.root, fullPath));

    if (entry.isDirectory()) {
      const ignoredByCombinedMatcher = shouldIgnorePath(context.ignoreMatcher, relativePath, true);
      const ignoreRule = ignoredByCombinedMatcher
        ? findIgnoreRule(context.ignoreRules, relativePath, true) ?? createParentIgnoreRule()
        : null;
      const includeCandidate = mayContainIncludeOverride(relativePath, context.includeOverrides);
      const included = matchesIncludeOverride(context.includeMatcher, relativePath, true);

      if ((includeOnly && !includeCandidate && !included) || (ignoreRule && !included)) {
        recordIgnored(context, relativePath, "folder", ignoreRule);

        if (includeCandidate) {
          await walkDirectory(fullPath, context, true);
        } else {
          await countIgnoredChildren(fullPath, context, ignoreRule);
        }

        continue;
      }

      context.folders.add(relativePath || ".");
      await walkDirectory(fullPath, context, includeOnly);
      continue;
    }

    if (entry.isFile()) {
      const included = matchesIncludeOverride(context.includeMatcher, relativePath, false);
      const ignoredByCombinedMatcher = shouldIgnorePath(context.ignoreMatcher, relativePath, false);
      const ignoreRule = ignoredByCombinedMatcher
        ? findIgnoreRule(context.ignoreRules, relativePath, false) ?? createParentIgnoreRule()
        : null;

      if ((includeOnly && !included) || (ignoreRule && !included)) {
        recordIgnored(context, relativePath, "file", ignoreRule);
        continue;
      }

      const metadata = await buildFileMetadata({
        categoryMatchers: context.categoryMatchers,
        errors: context.errors,
        filePath: fullPath,
        includedByOverride: included,
        root: context.root
      });

      if (metadata) {
        context.files.push(metadata);
      }
    }
  }
}

async function buildFileMetadata({ categoryMatchers, errors, filePath, includedByOverride, root }) {
  try {
    const stats = await fs.stat(filePath);
    const relativePath = normalizeRelativePath(path.relative(root, filePath));
    const extension = path.extname(filePath).toLowerCase() || "sin extension";
    const parentFolder = normalizeParentFolder(relativePath);
    const depth = getFolderDepth(relativePath);
    const lineMetrics = await countLines(filePath, stats.size);
    const category = categorizeFile(relativePath, categoryMatchers);
    const codeMetrics = await analyzeCodeFile({
      bytes: stats.size,
      extension,
      filePath,
      isBinary: lineMetrics.isBinary,
      relativePath
    });

    return {
      relativePath,
      extension,
      bytes: stats.size,
      sizeBytes: stats.size,
      lines: lineMetrics.lines,
      blankLines: lineMetrics.blankLines,
      parentFolder,
      folder: parentFolder,
      modifiedAt: stats.mtime.toISOString(),
      depth,
      isBinary: lineMetrics.isBinary,
      category,
      categoryLabel: CATEGORY_LABELS[category] ?? CATEGORY_LABELS.unknown,
      includedByOverride,
      codeMetrics,
      dependencies: [],
      importedBy: 0,
      signals: [],
      structuralScore: 0,
      categoryWeight: 1,
      refactorScore: 0
    };
  } catch (error) {
    errors.push({
      path: normalizeRelativePath(path.relative(root, filePath)) || filePath,
      message: error instanceof Error ? error.message : "No fue posible leer el archivo."
    });
    return null;
  }
}

async function countLines(filePath, bytes) {
  if (bytes === 0) {
    return { lines: 0, blankLines: 0, isBinary: false };
  }

  if (await looksBinary(filePath, bytes)) {
    return { lines: 0, blankLines: 0, isBinary: true };
  }

  return countTextLines(filePath);
}

async function looksBinary(filePath, bytes) {
  const sampleSize = Math.min(bytes, 4096);
  const handle = await fs.open(filePath, "r");

  try {
    const buffer = Buffer.alloc(sampleSize);
    const { bytesRead } = await handle.read(buffer, 0, sampleSize, 0);

    for (let index = 0; index < bytesRead; index += 1) {
      if (buffer[index] === 0) {
        return true;
      }
    }

    return false;
  } finally {
    await handle.close();
  }
}

function countTextLines(filePath) {
  return new Promise((resolve, reject) => {
    const decoder = new StringDecoder("utf8");
    const stream = createReadStream(filePath);
    let carry = "";
    let lines = 0;
    let blankLines = 0;

    const processText = (text) => {
      const parts = `${carry}${text}`.split("\n");
      carry = parts.pop() ?? "";

      for (const rawLine of parts) {
        const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
        lines += 1;

        if (line.trim().length === 0) {
          blankLines += 1;
        }
      }
    };

    stream.on("data", (chunk) => {
      processText(decoder.write(chunk));
    });

    stream.on("error", reject);

    stream.on("end", () => {
      processText(decoder.end());

      if (carry.length > 0) {
        const line = carry.endsWith("\r") ? carry.slice(0, -1) : carry;
        lines += 1;

        if (line.trim().length === 0) {
          blankLines += 1;
        }
      }

      resolve({ lines, blankLines, isBinary: false });
    });
  });
}

async function buildScanResponse(context, dependencies) {
  const totals = context.files.reduce(
    (accumulator, file) => {
      accumulator.files += 1;
      accumulator.lines += file.lines;
      accumulator.blankLines += file.blankLines;
      accumulator.bytes += file.bytes;
      return accumulator;
    },
    { files: 0, lines: 0, blankLines: 0, bytes: 0, folders: context.folders.size }
  );

  const byExtension = aggregateByExtension(context.files);
  const byCategory = aggregateByCategory(context.files);
  const foldersByLines = aggregateByFolder(context.files);
  const topByLines = [...context.files].sort(sortByNumber("lines")).slice(0, 20);
  const topBySize = [...context.files].sort(sortByNumber("bytes")).slice(0, 20);
  const refactorHotspots = [...context.files].sort(sortByNumber("refactorScore")).slice(0, 20);
  const couplingAlerts = buildCouplingAlerts(context.files);
  const recommendations = buildRecommendations({ dependencies, files: context.files });
  const { architectureInsights } = await enrichProjectInsights({
    dependencies,
    files: context.files,
    root: context.root,
    totals
  });
  const ignoredByRule = [...context.ignored.ignoredByRule.values()].sort(
    (a, b) => b.ignoredFiles + b.ignoredFolders - (a.ignoredFiles + a.ignoredFolders)
  );
  const ignoreSummary = {
    ignoredFiles: context.ignored.ignoredFiles,
    ignoredFolders: context.ignored.ignoredFolders,
    ignoredExamples: context.ignored.ignoredExamples,
    ignoredByRule,
    activePatternCount: context.activeIgnorePatterns.all.length,
    gitignoreLoaded: context.gitignoreLoaded,
    countCapped: context.ignored.countCapped
  };

  return {
    root: context.root,
    scannedAt: new Date().toISOString(),
    ignoredDirectories: DEFAULT_IGNORE_PATTERNS,
    scanOptions: context.scanOptions,
    projectLensConfig: context.projectConfig,
    activeIgnorePatterns: context.activeIgnorePatterns,
    gitignoreLoaded: context.gitignoreLoaded,
    ignoredFiles: context.ignored.ignoredFiles,
    ignoredFolders: context.ignored.ignoredFolders,
    ignoreSummary,
    totals,
    byExtension,
    byCategory,
    topByLines,
    topBySize,
    foldersByLines,
    refactorHotspots,
    couplingAlerts,
    dependencies,
    architectureInsights,
    recommendations,
    files: context.files,
    errors: context.errors
  };
}

function aggregateByExtension(files) {
  const map = new Map();

  for (const file of files) {
    const current = map.get(file.extension) ?? {
      extension: file.extension,
      files: 0,
      lines: 0,
      blankLines: 0,
      bytes: 0,
      refactorScore: 0
    };

    current.files += 1;
    current.lines += file.lines;
    current.blankLines += file.blankLines;
    current.bytes += file.bytes;
    current.refactorScore += file.refactorScore;
    map.set(file.extension, current);
  }

  return [...map.values()]
    .map((item) => ({ ...item, averageScore: item.files > 0 ? Math.round(item.refactorScore / item.files) : 0 }))
    .sort(sortByNumber("files"));
}

function aggregateByCategory(files) {
  const map = new Map();

  for (const file of files) {
    const current = map.get(file.category) ?? {
      category: file.category,
      label: file.categoryLabel,
      files: 0,
      lines: 0,
      bytes: 0,
      refactorScore: 0,
      signals: 0
    };

    current.files += 1;
    current.lines += file.lines;
    current.bytes += file.bytes;
    current.refactorScore += file.refactorScore;
    current.signals += file.signals.length;
    map.set(file.category, current);
  }

  return [...map.values()]
    .map((item) => ({
      ...item,
      averageScore: item.files > 0 ? Math.round(item.refactorScore / item.files) : 0
    }))
    .sort(sortByNumber("lines"));
}

function aggregateByFolder(files) {
  const map = new Map();

  for (const file of files) {
    const current = map.get(file.parentFolder) ?? {
      folder: file.parentFolder,
      files: 0,
      lines: 0,
      bytes: 0
    };

    current.files += 1;
    current.lines += file.lines;
    current.bytes += file.bytes;
    map.set(file.parentFolder, current);
  }

  return [...map.values()].sort(sortByNumber("lines")).slice(0, 20);
}

function buildCouplingAlerts(files) {
  return files
    .flatMap((file) =>
      file.signals.map((signal) => ({
        path: file.relativePath,
        category: file.category,
        refactorScore: file.refactorScore,
        signal
      }))
    )
    .sort((a, b) => b.refactorScore - a.refactorScore)
    .slice(0, 40);
}

function buildRecommendations({ dependencies, files }) {
  const recommendations = [];
  const sourceHotspots = files.filter((file) => file.category === "source" && file.refactorScore >= 45);

  if (sourceHotspots.length > 0) {
    recommendations.push({
      title: "Prioriza codigo productivo con score alto",
      detail: `${sourceHotspots.length} archivos productivos concentran senales de complejidad. Empieza por los primeros hotspots antes que tests o artefactos.`,
      severity: "high"
    });
  }

  if (dependencies.cycles.length > 0) {
    recommendations.push({
      title: "Revisar ciclos de imports",
      detail: `${dependencies.cycles.length} ciclos detectados. Son buenos candidatos para extraer contratos o invertir dependencias.`,
      severity: "high"
    });
  }

  if (dependencies.topFanOut.some((file) => file.codeMetrics.fanOut >= 10)) {
    recommendations.push({
      title: "Separar orquestadores",
      detail: "Hay archivos que importan demasiados modulos internos. Revisa si mezclan IO, parsing, validacion y reglas de negocio.",
      severity: "medium"
    });
  }

  if (recommendations.length === 0) {
    recommendations.push({
      title: "No hay alertas fuertes",
      detail: "El proyecto no muestra senales criticas con las reglas actuales. Guarda un snapshot para medir la proxima mejora.",
      severity: "low"
    });
  }

  return recommendations;
}

function buildIgnoreRules({ configPatterns, disabledPatterns, generatedPatterns, gitignorePatterns, manualPatterns }) {
  const disabled = new Set(cleanPatterns(disabledPatterns));
  const ruleInputs = [
    ...DEFAULT_IGNORE_PATTERNS.map((pattern) => ({ pattern, source: "default", sourceLabel: "default" })),
    ...generatedPatterns.map((pattern) => ({ pattern, source: "default", sourceLabel: "default" })),
    ...gitignorePatterns.map((pattern) => ({ pattern, source: "gitignore", sourceLabel: ".gitignore" })),
    ...configPatterns.map((pattern) => ({ pattern, source: "config", sourceLabel: "config manual" })),
    ...manualPatterns.map((pattern) => ({ pattern, source: "manual", sourceLabel: "config manual" }))
  ];

  const seen = new Set();

  return ruleInputs
    .filter((rule) => {
      const key = `${rule.source}:${rule.pattern}`;

      if (disabled.has(rule.pattern) || seen.has(key)) {
        return false;
      }

      seen.add(key);
      return true;
    })
    .map((rule, index) => ({
      ...rule,
      id: `${rule.source}:${index}:${rule.pattern}`,
      matcher: buildMatcher([rule.pattern])
    }));
}

function buildActiveIgnorePatterns(ignoreRules, scanOptions) {
  const rules = ignoreRules.map(({ id, pattern, source, sourceLabel }) => ({
    id,
    pattern,
    source,
    sourceLabel
  }));
  const bySource = (source) => rules.filter((rule) => rule.source === source).map((rule) => rule.pattern);

  return {
    default: bySource("default"),
    gitignore: bySource("gitignore"),
    config: bySource("config"),
    manual: bySource("manual"),
    includeOverrides: scanOptions.includeOverrides,
    disabled: scanOptions.disabledRules,
    rules,
    all: rules.map((rule) => rule.pattern)
  };
}

function buildCategoryMatchers(categories) {
  return Object.entries(categories).map(([category, patterns]) => ({
    category,
    matcher: buildMatcher(patterns)
  }));
}

function categorizeFile(relativePath, categoryMatchers) {
  const order = ["dependencies_cache", "artifacts", "tests", "source", "config", "documentation"];

  for (const category of order) {
    const entry = categoryMatchers.find((item) => item.category === category);

    if (entry && shouldIgnorePath(entry.matcher, relativePath, false)) {
      return category;
    }
  }

  return "unknown";
}

async function loadGitignorePatterns(root, useGitignore) {
  if (!useGitignore) {
    return { loaded: false, patterns: [], errors: [] };
  }

  try {
    const content = await fs.readFile(path.join(root, ".gitignore"), "utf8");

    return {
      loaded: true,
      patterns: cleanIgnorePatterns(content.split(/\r?\n/)),
      errors: []
    };
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return { loaded: false, patterns: [], errors: [] };
    }

    return {
      loaded: false,
      patterns: [],
      errors: [
        {
          path: ".gitignore",
          message: error instanceof Error ? error.message : "No fue posible leer .gitignore."
        }
      ]
    };
  }
}

function normalizeScanOptions(options, config) {
  return {
    useGitignore: options.useGitignore !== false,
    useGeneratedPreset: options.useGeneratedPreset !== false,
    manualIgnorePatterns: cleanIgnorePatterns(options.manualIgnorePatterns ?? []),
    includeOverrides: cleanIgnorePatterns([...(config.includeOverrides ?? []), ...(options.includeOverrides ?? [])]),
    disabledRules: cleanIgnorePatterns([...(config.disabledRules ?? []), ...(options.disabledRules ?? [])])
  };
}

function cleanIgnorePatterns(patterns) {
  return [...new Set(patterns.map((item) => item.trim()).filter((item) => item && !item.startsWith("#")))];
}

function buildMatcher(patterns) {
  return ignore().add(expandPatternsForMatcher(cleanPatterns(patterns)));
}

function expandPatternsForMatcher(patterns) {
  const expanded = [];

  for (const pattern of patterns) {
    expanded.push(pattern);

    if (pattern.endsWith("/**")) {
      expanded.push(pattern.slice(0, -2));
    }

    if (pattern.endsWith("/")) {
      expanded.push(`${pattern}**`);
    }
  }

  return [...new Set(expanded)];
}

function findIgnoreRule(ignoreRules, relativePath, isDirectory) {
  for (const rule of ignoreRules) {
    if (shouldIgnorePath(rule.matcher, relativePath, isDirectory)) {
      return rule;
    }
  }

  return null;
}

function matchesIncludeOverride(includeMatcher, relativePath, isDirectory) {
  return shouldIgnorePath(includeMatcher, relativePath, isDirectory);
}

function shouldIgnorePath(matcher, relativePath, isDirectory) {
  if (!relativePath) {
    return false;
  }

  return matcher.ignores(isDirectory ? `${relativePath}/` : relativePath);
}

function mayContainIncludeOverride(relativePath, includeOverrides) {
  if (includeOverrides.length === 0) {
    return false;
  }

  const directory = relativePath.replace(/\/+$/, "");

  return includeOverrides.some((pattern) => {
    const staticPrefix = pattern.split(/[*?[{]/)[0].replace(/\/+$/, "");

    if (!staticPrefix) {
      return true;
    }

    return staticPrefix === directory || staticPrefix.startsWith(`${directory}/`) || directory.startsWith(`${staticPrefix}/`);
  });
}

function createParentIgnoreRule() {
  return {
    pattern: "(carpeta padre ignorada)",
    source: "parent",
    sourceLabel: "regla padre"
  };
}

async function countIgnoredChildren(directory, context, rule) {
  if (context.ignored.countCapped) {
    return;
  }

  let entries;

  try {
    entries = await fs.readdir(directory, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (context.ignored.countedEntries >= MAX_IGNORED_COUNTED_ENTRIES) {
      context.ignored.countCapped = true;
      return;
    }

    if (entry.isSymbolicLink()) {
      continue;
    }

    const fullPath = path.join(directory, entry.name);
    const relativePath = normalizeRelativePath(path.relative(context.root, fullPath));

    context.ignored.countedEntries += 1;

    if (entry.isDirectory()) {
      recordIgnored(context, relativePath, "folder", rule);
      await countIgnoredChildren(fullPath, context, rule);
    } else if (entry.isFile()) {
      recordIgnored(context, relativePath, "file", rule);
    }
  }
}

function recordIgnored(context, relativePath, type, rule) {
  if (type === "folder") {
    context.ignored.ignoredFolders += 1;
  } else {
    context.ignored.ignoredFiles += 1;
  }

  const key = `${rule.source}:${rule.pattern}`;
  const current = context.ignored.ignoredByRule.get(key) ?? {
    pattern: rule.pattern,
    source: rule.source,
    sourceLabel: rule.sourceLabel,
    ignoredFiles: 0,
    ignoredFolders: 0
  };

  if (type === "folder") {
    current.ignoredFolders += 1;
  } else {
    current.ignoredFiles += 1;
  }

  context.ignored.ignoredByRule.set(key, current);

  if (context.ignored.ignoredExamples.length < MAX_IGNORED_EXAMPLES) {
    context.ignored.ignoredExamples.push({
      path: relativePath,
      type,
      reason: rule.sourceLabel,
      pattern: rule.pattern,
      source: rule.source
    });
  }
}

function sortByNumber(key) {
  return (a, b) => b[key] - a[key];
}

function normalizeParentFolder(relativePath) {
  const parent = path.dirname(relativePath);
  return parent === "." ? "." : normalizeRelativePath(parent);
}

function normalizeRelativePath(relativePath) {
  return relativePath.split(path.sep).join("/");
}

function getFolderDepth(relativePath) {
  return Math.max(0, relativePath.split("/").length - 1);
}
