import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const MAX_ANALYSIS_BYTES = 2_000_000;
const CODE_EXTENSIONS = new Set([
  ".py",
  ".js",
  ".jsx",
  ".ts",
  ".tsx",
  ".java",
  ".cs",
  ".go",
  ".rb",
  ".php"
]);

const PYTHON_AST_SCRIPT = String.raw`
import ast
import json
import sys

path = sys.argv[1]
with open(path, "r", encoding="utf-8", errors="ignore") as handle:
    source = handle.read()

tree = ast.parse(source)
functions = []
classes = []
imports = []

complexity_nodes = (
    ast.If, ast.For, ast.AsyncFor, ast.While, ast.Try, ast.ExceptHandler,
    ast.With, ast.AsyncWith, ast.BoolOp, ast.IfExp, ast.Match
)

def span(node):
    start = getattr(node, "lineno", 0) or 0
    end = getattr(node, "end_lineno", start) or start
    return max(1, end - start + 1)

def complexity(node):
    score = 1
    for child in ast.walk(node):
        if isinstance(child, complexity_nodes):
            score += 1
    return score

for node in ast.walk(tree):
    if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
        functions.append({
            "lines": span(node),
            "private": node.name.startswith("_") and not node.name.startswith("__"),
            "complexity": complexity(node)
        })
    elif isinstance(node, ast.ClassDef):
        classes.append({"lines": span(node)})
    elif isinstance(node, ast.Import):
        for alias in node.names:
            imports.append(alias.name)
    elif isinstance(node, ast.ImportFrom):
        module = node.module or ""
        prefix = "." * int(node.level or 0)
        imports.append(prefix + module)

print(json.dumps({
    "method": "python-ast",
    "functions": functions,
    "classes": classes,
    "imports": imports
}))
`;

export async function analyzeCodeFile({ bytes, extension, filePath, isBinary, relativePath }) {
  const empty = createEmptyCodeMetrics();

  if (isBinary || !CODE_EXTENSIONS.has(extension) || bytes > MAX_ANALYSIS_BYTES) {
    return empty;
  }

  if (extension === ".py") {
    const astMetrics = await analyzePythonWithAst(filePath);

    if (astMetrics) {
      return finalizeCodeMetrics(astMetrics, relativePath);
    }
  }

  try {
    const content = await fs.readFile(filePath, "utf8");
    return finalizeCodeMetrics(analyzeWithHeuristics(content, extension), relativePath);
  } catch {
    return empty;
  }
}

export function buildDependencyGraph(files) {
  const byPath = new Map(files.map((file) => [file.relativePath, file]));
  const moduleIndex = buildModuleIndex(files);
  const edges = [];
  const fanIn = new Map();

  for (const file of files) {
    const dependencies = resolveInternalDependencies(file, byPath, moduleIndex);
    file.codeMetrics.dependenciesDirect = dependencies.length;
    file.codeMetrics.importsInternal = dependencies.length;
    file.codeMetrics.importsExternal = Math.max(0, file.codeMetrics.imports - dependencies.length);
    file.codeMetrics.fanOut = dependencies.length;
    file.dependencies = dependencies;

    for (const target of dependencies) {
      edges.push({ from: file.relativePath, to: target });
      fanIn.set(target, (fanIn.get(target) ?? 0) + 1);
    }
  }

  for (const file of files) {
    const importedBy = fanIn.get(file.relativePath) ?? 0;
    file.importedBy = importedBy;
    file.codeMetrics.importedBy = importedBy;
    file.codeMetrics.fanIn = importedBy;
    file.signals = buildSignals(file);
    file.refactorScore = calculateRefactorPriority(file);
  }

  const nodes = files.map((file) => ({
    path: file.relativePath,
    category: file.category,
    fanIn: file.codeMetrics.fanIn,
    fanOut: file.codeMetrics.fanOut,
    centrality: file.codeMetrics.fanIn + file.codeMetrics.fanOut,
    refactorScore: file.refactorScore
  }));
  const cycles = findCycles(files);

  return {
    nodes: nodes.sort((a, b) => b.centrality - a.centrality).slice(0, 80),
    edges: edges.slice(0, 300),
    cycles,
    topFanIn: [...files].sort((a, b) => b.codeMetrics.fanIn - a.codeMetrics.fanIn).slice(0, 20),
    topFanOut: [...files].sort((a, b) => b.codeMetrics.fanOut - a.codeMetrics.fanOut).slice(0, 20),
    splitCandidates: [...files]
      .filter((file) => file.signals.some((signal) => signal.severity === "high"))
      .sort((a, b) => b.refactorScore - a.refactorScore)
      .slice(0, 20)
  };
}

function createEmptyCodeMetrics() {
  return {
    analysisMethod: "none",
    functions: 0,
    classes: 0,
    longFunctions: 0,
    largeClasses: 0,
    imports: 0,
    importsInternal: 0,
    importsExternal: 0,
    dependenciesDirect: 0,
    importedBy: 0,
    fanIn: 0,
    fanOut: 0,
    privateFunctions: 0,
    estimatedComplexity: 0,
    maxFunctionLines: 0,
    maxClassLines: 0,
    responsibilitySignals: [],
    mixedResponsibilityScore: 0,
    orchestratorScore: 0,
    importSpecifiers: []
  };
}

async function analyzePythonWithAst(filePath) {
  for (const command of ["python", "py"]) {
    try {
      const args = command === "py" ? ["-3", "-c", PYTHON_AST_SCRIPT, filePath] : ["-c", PYTHON_AST_SCRIPT, filePath];
      const { stdout } = await execFileAsync(command, args, {
        timeout: 2500,
        windowsHide: true,
        maxBuffer: 2_000_000
      });
      const parsed = JSON.parse(stdout);

      return {
        analysisMethod: parsed.method,
        functions: parsed.functions ?? [],
        classes: parsed.classes ?? [],
        imports: parsed.imports ?? []
      };
    } catch {
      // Try the next Python launcher, then fall back to heuristics.
    }
  }

  return null;
}

function analyzeWithHeuristics(content, extension) {
  const imports = extractImports(content, extension);
  const functionLines = estimateFunctionLines(content, extension);
  const classLines = estimateClassLines(content, extension);
  const privateFunctions = estimatePrivateFunctions(content, extension);
  const complexity = estimateComplexity(content);

  return {
    analysisMethod: "heuristic",
    functions: functionLines.map((lines) => ({ lines, private: false, complexity: Math.max(1, Math.round(lines / 18)) })),
    classes: classLines.map((lines) => ({ lines })),
    imports,
    privateFunctions,
    estimatedComplexity: complexity
  };
}

function finalizeCodeMetrics(raw, relativePath) {
  const metrics = createEmptyCodeMetrics();
  const functions = raw.functions ?? [];
  const classes = raw.classes ?? [];
  const importSpecifiers = [...new Set((raw.imports ?? []).filter(Boolean))];
  const responsibilitySignals = detectResponsibilities(importSpecifiers, relativePath);
  const estimatedComplexity =
    raw.estimatedComplexity ?? functions.reduce((total, item) => total + (item.complexity ?? 1), 0);
  const privateFunctions =
    typeof raw.privateFunctions === "number"
      ? raw.privateFunctions
      : functions.filter((item) => item.private).length;
  const longFunctions = functions.filter((item) => item.lines >= 80).length;
  const largeClasses = classes.filter((item) => item.lines >= 300).length;

  return {
    ...metrics,
    analysisMethod: raw.analysisMethod ?? "heuristic",
    functions: functions.length,
    classes: classes.length,
    longFunctions,
    largeClasses,
    imports: importSpecifiers.length,
    privateFunctions,
    estimatedComplexity,
    maxFunctionLines: Math.max(0, ...functions.map((item) => item.lines ?? 0)),
    maxClassLines: Math.max(0, ...classes.map((item) => item.lines ?? 0)),
    responsibilitySignals,
    mixedResponsibilityScore: responsibilitySignals.length,
    orchestratorScore: calculateOrchestratorScore({
      estimatedComplexity,
      imports: importSpecifiers.length,
      longFunctions,
      privateFunctions,
      responsibilitySignals
    }),
    importSpecifiers
  };
}

function extractImports(content, extension) {
  const imports = [];
  const patterns =
    extension === ".py"
      ? [
          /^\s*import\s+([A-Za-z0-9_.,\s]+)/gm,
          /^\s*from\s+([A-Za-z0-9_\.]+)\s+import\s+/gm
        ]
      : [
          /import\s+(?:[^'"]+\s+from\s+)?["']([^"']+)["']/g,
          /require\(\s*["']([^"']+)["']\s*\)/g,
          /import\(\s*["']([^"']+)["']\s*\)/g,
          /using\s+([A-Za-z0-9_.]+)/g
        ];

  for (const pattern of patterns) {
    let match = pattern.exec(content);

    while (match) {
      imports.push(...String(match[1]).split(",").map((item) => item.trim().split(/\s+/)[0]));
      match = pattern.exec(content);
    }
  }

  return imports.filter(Boolean);
}

function estimateFunctionLines(content, extension) {
  const lines = content.split(/\r?\n/);
  const starts = [];
  const functionPattern =
    extension === ".py"
      ? /^\s*(async\s+def|def)\s+[A-Za-z0-9_]+\s*\(/
      : /^\s*(export\s+)?(async\s+)?(function\s+[A-Za-z0-9_]+|const\s+[A-Za-z0-9_]+\s*=\s*(async\s*)?\(|[A-Za-z0-9_]+\s*\([^)]*\)\s*\{)/;

  lines.forEach((line, index) => {
    if (functionPattern.test(line)) {
      starts.push(index);
    }
  });

  if (extension === ".py") {
    return starts.map((start, index) => {
      const indent = lines[start].match(/^\s*/)?.[0].length ?? 0;
      const next = starts.slice(index + 1).find((lineNumber) => {
        const line = lines[lineNumber];
        const nextIndent = line.match(/^\s*/)?.[0].length ?? 0;
        return nextIndent <= indent;
      });

      return Math.max(1, (next ?? lines.length) - start);
    });
  }

  return starts.map((start) => estimateBraceBlockLength(lines, start));
}

function estimateClassLines(content, extension) {
  const lines = content.split(/\r?\n/);
  const starts = [];
  const classPattern = extension === ".py" ? /^\s*class\s+[A-Za-z0-9_]+/ : /^\s*(export\s+)?class\s+[A-Za-z0-9_]+/;

  lines.forEach((line, index) => {
    if (classPattern.test(line)) {
      starts.push(index);
    }
  });

  return starts.map((start) => (extension === ".py" ? Math.max(1, lines.length - start) : estimateBraceBlockLength(lines, start)));
}

function estimateBraceBlockLength(lines, start) {
  let depth = 0;
  let opened = false;

  for (let index = start; index < lines.length; index += 1) {
    const line = lines[index];

    for (const char of line) {
      if (char === "{") {
        depth += 1;
        opened = true;
      } else if (char === "}") {
        depth -= 1;
      }
    }

    if (opened && depth <= 0) {
      return Math.max(1, index - start + 1);
    }
  }

  return Math.max(1, Math.min(120, lines.length - start));
}

function estimatePrivateFunctions(content, extension) {
  if (extension === ".py") {
    return (content.match(/^\s*(async\s+def|def)\s+_[A-Za-z0-9_]+\s*\(/gm) ?? []).length;
  }

  return (content.match(/^\s*(const|function)\s+_[A-Za-z0-9_]+/gm) ?? []).length;
}

function estimateComplexity(content) {
  return (content.match(/\b(if|for|while|switch|case|catch|except|elif|and|or)\b/g) ?? []).length + 1;
}

function detectResponsibilities(importSpecifiers, relativePath) {
  const haystack = `${relativePath} ${importSpecifiers.join(" ")}`.toLowerCase();
  const groups = {
    io: ["fs", "path", "os", "file", "requests", "axios", "fetch", "http", "sql", "db", "postgres", "s3"],
    parsing: ["json", "csv", "yaml", "xml", "html", "parser", "beautifulsoup", "cheerio"],
    validation: ["validate", "schema", "pydantic", "joi", "zod", "marshmallow"],
    output: ["report", "export", "write", "pdf", "excel", "screenshot", "render", "template"],
    business: ["service", "domain", "usecase", "rule", "policy", "workflow"],
    ui: ["react", "vue", "component", "screen", "page"]
  };

  return Object.entries(groups)
    .filter(([, words]) => words.some((word) => haystack.includes(word)))
    .map(([key]) => key);
}

function calculateOrchestratorScore({ estimatedComplexity, imports, longFunctions, privateFunctions, responsibilitySignals }) {
  return Math.min(
    100,
    Math.round(
      imports * 1.5 +
        estimatedComplexity * 1.2 +
        longFunctions * 12 +
        privateFunctions * 2 +
        responsibilitySignals.length * 9
    )
  );
}

function buildModuleIndex(files) {
  const index = new Map();

  for (const file of files) {
    const withoutExtension = file.relativePath.replace(/\.[^.]+$/, "");
    const dotted = withoutExtension.replace(/\//g, ".");
    index.set(withoutExtension, file.relativePath);
    index.set(dotted, file.relativePath);
    index.set(path.posix.basename(withoutExtension), file.relativePath);
  }

  return index;
}

function resolveInternalDependencies(file, byPath, moduleIndex) {
  const dependencies = new Set();

  for (const specifier of file.codeMetrics.importSpecifiers) {
    const resolved = resolveImportSpecifier(file.relativePath, specifier, byPath, moduleIndex);

    if (resolved && resolved !== file.relativePath) {
      dependencies.add(resolved);
    }
  }

  return [...dependencies].sort();
}

function resolveImportSpecifier(fromPath, specifier, byPath, moduleIndex) {
  if (!specifier) {
    return "";
  }

  if (specifier.startsWith(".")) {
    const base = path.posix.dirname(fromPath);
    const normalized = path.posix.normalize(path.posix.join(base, specifier));
    return resolveCandidatePath(normalized, byPath) || moduleIndex.get(normalized.replace(/\//g, ".")) || "";
  }

  const clean = specifier.replace(/^\.+/, "");

  if (moduleIndex.has(clean)) {
    return moduleIndex.get(clean);
  }

  const parts = clean.split(".");

  while (parts.length > 0) {
    const candidate = parts.join(".");

    if (moduleIndex.has(candidate)) {
      return moduleIndex.get(candidate);
    }

    parts.pop();
  }

  return "";
}

function resolveCandidatePath(candidate, byPath) {
  const extensions = ["", ".py", ".js", ".jsx", ".ts", ".tsx", ".java", ".cs", "/index.js", "/index.ts", "/__init__.py"];

  for (const extension of extensions) {
    const full = `${candidate}${extension}`;

    if (byPath.has(full)) {
      return full;
    }
  }

  return "";
}

function buildSignals(file) {
  const metrics = file.codeMetrics;
  const signals = [];

  if (metrics.imports >= 25) {
    signals.push({ code: "too_many_imports", label: "Demasiados imports", severity: "high" });
  } else if (metrics.imports >= 15) {
    signals.push({ code: "many_imports", label: "Muchos imports", severity: "medium" });
  }

  if (metrics.privateFunctions >= 10) {
    signals.push({ code: "too_many_private_functions", label: "Muchas funciones privadas", severity: "high" });
  }

  if (metrics.longFunctions > 0) {
    signals.push({ code: "long_functions", label: "Funciones demasiado largas", severity: metrics.longFunctions > 2 ? "high" : "medium" });
  }

  if (metrics.largeClasses > 0) {
    signals.push({ code: "large_classes", label: "Clases demasiado grandes", severity: "high" });
  }

  if (metrics.mixedResponsibilityScore >= 4) {
    signals.push({ code: "mixed_responsibilities", label: "Responsabilidades mezcladas", severity: "high" });
  } else if (metrics.mixedResponsibilityScore >= 3) {
    signals.push({ code: "mixed_responsibilities", label: "Varias responsabilidades", severity: "medium" });
  }

  if (metrics.fanOut >= 12) {
    signals.push({ code: "high_fan_out", label: "Alto fan-out", severity: "high" });
  }

  if (metrics.fanIn >= 8) {
    signals.push({ code: "high_fan_in", label: "Alto fan-in", severity: "medium" });
  }

  if (metrics.orchestratorScore >= 70 && file.lines >= 500) {
    signals.push({ code: "giant_orchestrator", label: "Orquestador gigante", severity: "high" });
  }

  return signals;
}

function calculateRefactorPriority(file) {
  const categoryWeights = {
    source: 1,
    tests: 0.45,
    artifacts: 0.08,
    config: 0.2,
    documentation: 0.12,
    dependencies_cache: 0.04,
    unknown: 0.35
  };
  const metrics = file.codeMetrics;
  const structuralScore =
    Math.min(file.lines / 800, 1) * 22 +
    Math.min(file.bytes / 200000, 1) * 10 +
    Math.min(file.depth / 8, 1) * 8 +
    Math.min(metrics.imports / 30, 1) * 14 +
    Math.min(metrics.estimatedComplexity / 60, 1) * 14 +
    Math.min(metrics.longFunctions / 4, 1) * 12 +
    Math.min(metrics.largeClasses / 2, 1) * 8 +
    Math.min(metrics.fanOut / 14, 1) * 8 +
    Math.min(metrics.fanIn / 12, 1) * 4;
  const weight = categoryWeights[file.category] ?? categoryWeights.unknown;

  file.structuralScore = Math.round(Math.min(100, structuralScore));
  file.categoryWeight = weight;

  return Math.round(Math.min(100, structuralScore * weight));
}

function findCycles(files) {
  const byPath = new Map(files.map((file) => [file.relativePath, file]));
  const cycles = [];

  for (const file of files) {
    visit(file.relativePath, [], new Set());

    if (cycles.length >= 12) {
      break;
    }
  }

  return cycles;

  function visit(current, stack, seen) {
    if (cycles.length >= 12 || seen.has(current)) {
      return;
    }

    const cycleStart = stack.indexOf(current);

    if (cycleStart >= 0) {
      const cycle = stack.slice(cycleStart);
      cycle.push(current);

      if (cycle.length > 2 && !cycles.some((item) => item.join(">") === cycle.join(">"))) {
        cycles.push(cycle);
      }

      return;
    }

    const file = byPath.get(current);

    if (!file) {
      return;
    }

    seen.add(current);
    for (const dependency of file.dependencies ?? []) {
      visit(dependency, [...stack, current], seen);
    }
    seen.delete(current);
  }
}
