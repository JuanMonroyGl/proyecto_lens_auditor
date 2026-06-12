import fs from "node:fs/promises";
import path from "node:path";

const ENTRYPOINT_NAMES = new Set(["index", "main", "app", "server"]);
const SOURCE_EXTENSIONS = new Set([".js", ".jsx", ".ts", ".tsx", ".py", ".java", ".cs", ".go", ".rb", ".php"]);

export async function enrichProjectInsights({ dependencies, files, root, totals }) {
  const packageManifests = await loadPackageManifests(root, files);
  const projectProfile = buildProjectProfile({ files, packageManifests });
  const reverseDependencies = buildReverseDependencies(files);
  const fileInsights = new Map();

  for (const file of files) {
    fileInsights.set(
      file.relativePath,
      buildFileInsight({
        file,
        files,
        packageManifests,
        projectProfile,
        reverseDependencies
      })
    );
  }

  for (const file of files) {
    file.fileInsights = fileInsights.get(file.relativePath);
  }

  return {
    architectureInsights: buildArchitectureInsights({
      dependencies,
      files,
      packageManifests,
      projectProfile,
      totals
    })
  };
}

function buildFileInsight({ file, files, packageManifests, projectProfile, reverseDependencies }) {
  const role = detectFileRole(file, packageManifests, projectProfile);
  const inbound = reverseDependencies.get(file.relativePath) ?? [];
  const outbound = file.dependencies ?? [];
  const connectsWith = [...outbound.slice(0, 3), ...inbound.slice(0, 3)]
    .filter((item, index, items) => items.indexOf(item) === index)
    .slice(0, 5);
  const importance = getImportance(file, role, inbound);
  const risk = getRisk(file, role, inbound, outbound);

  return {
    role: role.label,
    roleId: role.id,
    confidence: role.confidence,
    inferred: true,
    summary: role.summary,
    purpose: role.purpose,
    connectsWith,
    importance,
    risk,
    signals: buildFriendlySignals(file, inbound, outbound),
    layer: role.layer
  };
}

function buildArchitectureInsights({ dependencies, files, packageManifests, projectProfile, totals }) {
  const layers = buildArchitectureLayers(files);
  const keyFiles = buildKeyFiles(files);
  const flow = buildProjectFlow(projectProfile, keyFiles);
  const relations = buildLayerRelations(files, dependencies);
  const stackLabels = projectProfile.stack.length > 0 ? projectProfile.stack.join(", ") : "estructura local";

  return {
    inferred: true,
    summary: buildArchitectureSummary({ layers, projectProfile, stackLabels, totals }),
    stack: projectProfile.stack,
    packageManagers: packageManifests.map((manifest) => manifest.relativePath),
    layers,
    flow,
    keyFiles,
    relations
  };
}

function detectFileRole(file, packageManifests, projectProfile) {
  const lowerPath = file.relativePath.toLowerCase();
  const base = path.posix.basename(lowerPath);
  const name = base.replace(/\.[^.]+$/, "");
  const extension = file.extension;
  const imports = file.codeMetrics?.importSpecifiers ?? [];
  const importText = imports.join(" ").toLowerCase();

  if (base === "package.json") {
    return role("manifest", "Mapa de dependencias", "Define comandos y librerias del proyecto.", "Sirve para instalar, arrancar y construir esta parte del sistema.", "Config");
  }

  if (base === ".gitignore" || lowerPath.endsWith(".env") || lowerPath.includes("config") || lowerPath.includes("settings")) {
    return role("config", "Configuracion", "Ajusta como se comporta el proyecto o una herramienta.", "Cambiarlo puede modificar el arranque, los filtros o la construccion.", "Config");
  }

  if (base === "readme.md" || file.category === "documentation") {
    return role("docs", "Guia", "Explica el proyecto para personas que lo leen o lo instalan.", "Ayuda a entender uso, contexto y decisiones sin tocar el codigo.", "Docs");
  }

  if (file.category === "tests" || lowerPath.includes("test") || lowerPath.includes("spec")) {
    return role("tests", "Prueba", "Comprueba que una parte del proyecto siga funcionando.", "Da confianza cuando cambias codigo relacionado.", "Tests / Quality");
  }

  if (extension === ".css" || extension === ".scss" || extension === ".sass") {
    return role("styles", "Estilos", "Controla la apariencia visual de la interfaz.", "Define colores, espacios, tamanos y comportamiento responsive.", "UI / Frontend");
  }

  if (lowerPath.includes("vite.config") || lowerPath.includes("webpack") || lowerPath.includes("tsconfig")) {
    return role("tooling", "Herramienta de build", "Configura como se prepara o compila el proyecto.", "Es parte del camino para correr la app en desarrollo o produccion.", "Config");
  }

  if (isEntrypoint(file, name) && (importText.includes("react") || extension === ".jsx" || extension === ".tsx")) {
    return role("ui-entry", "Entrada de interfaz", "Arranca la pantalla que ve el usuario.", "Conecta la aplicacion visual con sus componentes principales.", "UI / Frontend");
  }

  if (extension === ".jsx" || extension === ".tsx" || importText.includes("react")) {
    return role("ui", "Pantalla o componente", "Dibuja una parte de la experiencia visual.", "Convierte datos del proyecto en controles, tablas o vistas que se pueden usar.", "UI / Frontend");
  }

  if (isEntrypoint(file, name) && (importText.includes("express") || lowerPath.includes("server"))) {
    return role("api-entry", "Entrada del servidor", "Arranca el servicio que responde a la interfaz.", "Recibe solicitudes locales y devuelve datos del analisis.", "API Backend");
  }

  if (importText.includes("express") || lowerPath.includes("route") || lowerPath.includes("controller")) {
    return role("api", "API", "Expone acciones para que otra parte del proyecto las use.", "Traduce peticiones en respuestas con datos o cambios locales.", "API Backend");
  }

  if (lowerPath.includes("scanner") || lowerPath.includes("analy") || lowerPath.includes("parse")) {
    return role("analysis", "Analizador", "Lee archivos y extrae senales utiles.", "Convierte una carpeta en informacion que Project Lens puede mostrar.", "Analisis");
  }

  if (lowerPath.includes("snapshot") || lowerPath.includes("version") || lowerPath.includes("git")) {
    return role("history", "Historial", "Guarda o compara versiones del proyecto.", "Permite ver que cambio entre un antes y un despues.", "Snapshots");
  }

  if (imports.some((item) => ["fs", "node:fs", "path", "node:path", "os", "node:os"].includes(item))) {
    return role("local-io", "Archivos locales", "Lee o escribe informacion en el computador.", "Hace de puente entre la app y los archivos del proyecto.", "Persistencia");
  }

  if (file.category === "artifacts") {
    return role("artifact", "Artefacto", "Parece ser una salida generada por una herramienta.", "Normalmente se consulta, pero no suele ser el codigo principal.", "Artefactos", "medium");
  }

  if (SOURCE_EXTENSIONS.has(extension)) {
    return role("logic", "Logica", "Contiene reglas o funciones que hacen trabajar al proyecto.", "Suele transformar datos, coordinar piezas o resolver una parte del flujo.", detectLikelyLayer(file, projectProfile));
  }

  return role("support", "Soporte", "Acompana al proyecto con datos o estructura auxiliar.", "Puede ser necesario para que otras piezas funcionen correctamente.", "Soporte", "medium");
}

function buildArchitectureLayers(files) {
  const layerMap = new Map();

  for (const file of files) {
    const insight = file.fileInsights;
    const label = insight?.layer ?? layerFromCategory(file.category);
    const current = layerMap.get(label) ?? {
      id: toId(label),
      label,
      description: describeLayer(label),
      files: 0,
      lines: 0,
      examples: []
    };

    current.files += 1;
    current.lines += file.lines;

    if (current.examples.length < 4) {
      current.examples.push(file.relativePath);
    }

    layerMap.set(label, current);
  }

  return [...layerMap.values()].sort((a, b) => b.lines - a.lines);
}

function buildKeyFiles(files) {
  return [...files]
    .map((file) => ({
      importance: file.fileInsights?.importance ?? "Media",
      layer: file.fileInsights?.layer ?? layerFromCategory(file.category),
      path: file.relativePath,
      role: file.fileInsights?.role ?? "Archivo",
      reason: keyFileReason(file),
      risk: file.fileInsights?.risk ?? "",
      score: keyFileScore(file)
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 10);
}

function buildProjectFlow(projectProfile, keyFiles) {
  const flow = [];

  if (projectProfile.hasFrontend) {
    flow.push({
      title: "La persona usa la interfaz",
      detail: "El frontend muestra controles, tablas y vistas para explorar el proyecto."
    });
  }

  if (projectProfile.hasBackend) {
    flow.push({
      title: "La interfaz pide datos locales",
      detail: "El servidor recibe la ruta del proyecto y prepara una respuesta para la pantalla."
    });
  }

  flow.push({
    title: "El analisis recorre archivos",
    detail: "Project Lens lee nombres, tamanos, lineas, imports y relaciones sin mostrar contenido fuente largo."
  });

  if (projectProfile.hasGit) {
    flow.push({
      title: "Git aporta contexto historico",
      detail: "Los commits y el working tree permiten comparar versiones sin depender solo de snapshots manuales."
    });
  }

  flow.push({
    title: "La app resume lo importante",
    detail: "Los resultados se convierten en metricas, roles de archivo, arquitectura y recomendaciones."
  });

  if (flow.length < 4 && keyFiles.length > 0) {
    flow.unshift({
      title: "Archivo de entrada detectado",
      detail: `${keyFiles[0].path} parece ser una pieza central para entender por donde empieza el proyecto.`
    });
  }

  return flow.slice(0, 6);
}

function buildLayerRelations(files, dependencies) {
  const byPath = new Map(files.map((file) => [file.relativePath, file]));
  const counts = new Map();

  for (const edge of dependencies.edges ?? []) {
    const from = byPath.get(edge.from);
    const to = byPath.get(edge.to);
    const fromLayer = from?.fileInsights?.layer;
    const toLayer = to?.fileInsights?.layer;

    if (!fromLayer || !toLayer || fromLayer === toLayer) {
      continue;
    }

    const key = `${fromLayer}->${toLayer}`;
    const current = counts.get(key) ?? { from: fromLayer, to: toLayer, count: 0, examples: [] };
    current.count += 1;

    if (current.examples.length < 3) {
      current.examples.push(`${edge.from} -> ${edge.to}`);
    }

    counts.set(key, current);
  }

  return [...counts.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, 8)
    .map((item) => ({
      ...item,
      detail: describeRelation(item)
    }));
}

function buildArchitectureSummary({ layers, projectProfile, stackLabels, totals }) {
  const layerText = layers
    .slice(0, 3)
    .map((layer) => layer.label.toLowerCase())
    .join(", ");
  const shape = layerText || "varias piezas";

  if (projectProfile.hasFrontend && projectProfile.hasBackend) {
    return `Proyecto con interfaz y servidor local. Combina ${shape} para analizar ${totals.files} archivos y mostrar una lectura visual del sistema. Stack detectado: ${stackLabels}.`;
  }

  if (projectProfile.hasFrontend) {
    return `Proyecto centrado en interfaz. La mayor parte de la lectura cae en ${shape}, con ${totals.files} archivos analizados. Stack detectado: ${stackLabels}.`;
  }

  if (projectProfile.hasBackend) {
    return `Proyecto centrado en backend o herramientas locales. Organiza ${shape} para procesar datos y exponer resultados. Stack detectado: ${stackLabels}.`;
  }

  return `Proyecto local con ${totals.files} archivos analizados. La estructura principal aparece repartida en ${shape}. Stack detectado: ${stackLabels}.`;
}

function buildProjectProfile({ files, packageManifests }) {
  const allDeps = new Set(packageManifests.flatMap((manifest) => manifest.dependencies));
  const paths = files.map((file) => file.relativePath.toLowerCase());
  const imports = files.flatMap((file) => file.codeMetrics?.importSpecifiers ?? []).map((item) => item.toLowerCase());
  const stack = [];
  const hasReact = allDeps.has("react") || imports.includes("react") || files.some((file) => [".jsx", ".tsx"].includes(file.extension));
  const hasExpress = allDeps.has("express") || imports.includes("express");
  const hasVite = allDeps.has("vite") || paths.some((item) => item.includes("vite.config"));
  const hasNode = packageManifests.length > 0 || files.some((file) => [".js", ".jsx", ".ts", ".tsx"].includes(file.extension));
  const hasPython = files.some((file) => file.extension === ".py");

  if (hasReact) {
    stack.push("React");
  }

  if (hasExpress) {
    stack.push("Express");
  }

  if (hasVite) {
    stack.push("Vite");
  }

  if (hasNode) {
    stack.push("Node");
  }

  if (hasPython) {
    stack.push("Python");
  }

  return {
    hasBackend: hasExpress || paths.some((item) => item.includes("server/") || item.includes("api/")),
    hasFrontend: hasReact || paths.some((item) => item.includes("client/") || item.includes("frontend/") || item.includes("components/")),
    hasGit: paths.some((item) => item.includes("git")),
    stack
  };
}

async function loadPackageManifests(root, files) {
  const packageFiles = files.filter((file) => path.posix.basename(file.relativePath).toLowerCase() === "package.json").slice(0, 8);
  const manifests = [];

  for (const file of packageFiles) {
    try {
      const content = await fs.readFile(path.join(root, file.relativePath), "utf8");
      const parsed = JSON.parse(content);
      const dependencyNames = [
        ...Object.keys(parsed.dependencies ?? {}),
        ...Object.keys(parsed.devDependencies ?? {}),
        ...Object.keys(parsed.peerDependencies ?? {})
      ];

      manifests.push({
        relativePath: file.relativePath,
        name: parsed.name ?? file.relativePath,
        scripts: Object.keys(parsed.scripts ?? {}),
        dependencies: [...new Set(dependencyNames)]
      });
    } catch {
      // A malformed package.json should not block the scan.
    }
  }

  return manifests;
}

function buildReverseDependencies(files) {
  const reverse = new Map();

  for (const file of files) {
    for (const dependency of file.dependencies ?? []) {
      const current = reverse.get(dependency) ?? [];
      current.push(file.relativePath);
      reverse.set(dependency, current);
    }
  }

  return reverse;
}

function getImportance(file, role, inbound) {
  const centrality = (file.codeMetrics?.fanOut ?? 0) + inbound.length;

  if (role.id.includes("entry") || role.id === "manifest" || centrality >= 8 || file.refactorScore >= 60) {
    return "Alta";
  }

  if (file.category === "source" || centrality >= 3 || file.refactorScore >= 30) {
    return "Media";
  }

  return "Baja";
}

function getRisk(file, role, inbound, outbound) {
  if (role.id === "manifest" || role.id === "tooling" || role.id === "config") {
    return "Cambios aqui pueden afectar como arranca, se instala o se construye el proyecto.";
  }

  if (inbound.length >= 5) {
    return "Varias piezas dependen de este archivo; conviene probar lo que lo usa.";
  }

  if (outbound.length >= 8 || file.signals?.some((signal) => signal.severity === "high")) {
    return "Conecta varias responsabilidades; un cambio pequeno puede tener efectos cruzados.";
  }

  if (file.category === "tests" || file.category === "documentation") {
    return "Riesgo bajo para la app principal, pero puede afectar confianza o claridad.";
  }

  return "Riesgo moderado; revisa la pantalla o flujo relacionado despues de tocarlo.";
}

function buildFriendlySignals(file, inbound, outbound) {
  const signals = [];

  if (inbound.length > 0) {
    signals.push(`${inbound.length} archivos lo usan`);
  }

  if (outbound.length > 0) {
    signals.push(`se conecta con ${outbound.length} archivos`);
  }

  if (file.lines >= 500) {
    signals.push("archivo grande");
  }

  if ((file.signals ?? []).length > 0) {
    signals.push(`${file.signals.length} senales de revision`);
  }

  return signals.slice(0, 4);
}

function isEntrypoint(file, name) {
  return ENTRYPOINT_NAMES.has(name) && file.category === "source";
}

function keyFileReason(file) {
  const roleId = file.fileInsights?.roleId ?? "";

  if (roleId.includes("entry")) {
    return "Parece ser una puerta de entrada del proyecto.";
  }

  if (roleId === "manifest" || roleId === "tooling") {
    return "Define como se instala, arranca o construye una parte del proyecto.";
  }

  if ((file.codeMetrics?.fanIn ?? 0) >= 5) {
    return "Varios archivos dependen de esta pieza.";
  }

  if ((file.codeMetrics?.fanOut ?? 0) >= 6) {
    return "Coordina varias piezas internas.";
  }

  if (file.refactorScore >= 45) {
    return "Concentra senales de complejidad o tamano.";
  }

  return file.fileInsights?.summary ?? "Ayuda a entender una parte relevante del sistema.";
}

function keyFileScore(file) {
  const roleId = file.fileInsights?.roleId ?? "";
  const roleScore = roleId.includes("entry") ? 70 : roleId === "manifest" || roleId === "tooling" ? 55 : 0;

  return roleScore + (file.codeMetrics?.fanIn ?? 0) * 8 + (file.codeMetrics?.fanOut ?? 0) * 5 + file.refactorScore;
}

function detectLikelyLayer(file, projectProfile) {
  const lowerPath = file.relativePath.toLowerCase();

  if (lowerPath.includes("web_scraping") || lowerPath.includes("scraper") || lowerPath.includes("crawl")) {
    return "Web Scraping";
  }

  if (lowerPath.includes("selector")) {
    return "Selectors";
  }

  if (lowerPath.includes("snapshot") || lowerPath.includes("version") || lowerPath.includes("git")) {
    return "Snapshots";
  }

  if (lowerPath.includes("image_parse") || lowerPath.includes("image_read") || lowerPath.includes("vision")) {
    return "AI / Image Reading";
  }

  if (lowerPath.includes("core/ai") || lowerPath.includes("/ai/")) {
    return "AI / Image Reading";
  }

  if (lowerPath.includes("core/processing") || lowerPath.includes("/processing/") || lowerPath.includes("processor")) {
    return "Core / Processing";
  }

  if (lowerPath.includes("core/application") || lowerPath.includes("/application/")) {
    return "Core / Processing";
  }

  if (lowerPath.includes("client/") || lowerPath.includes("frontend/") || lowerPath.includes("component")) {
    return "UI / Frontend";
  }

  if (lowerPath.includes("server/") || lowerPath.includes("api/") || lowerPath.includes("controller")) {
    return "API Backend";
  }

  if (lowerPath.includes("test") || lowerPath.includes("spec")) {
    return "Tests / Quality";
  }

  if (projectProfile.hasFrontend && !projectProfile.hasBackend) {
    return "UI / Frontend";
  }

  return "Logica";
}

function layerFromCategory(category) {
  const labels = {
    artifacts: "Artefactos",
    config: "Config",
    dependencies_cache: "Dependencias",
    documentation: "Docs",
    source: "Logica",
    tests: "Tests / Quality",
    unknown: "Soporte"
  };

  return labels[category] ?? "Soporte";
}

function describeLayer(label) {
  const descriptions = {
    "AI / Image Reading": "Interpreta informacion visual o respuestas de modelos. Revisala cuando el proyecto dependa de imagenes, prompts o resultados de IA.",
    "API Backend": "Recibe solicitudes, coordina reglas y entrega respuestas a otras partes. Es clave para entender como se mueve la informacion.",
    Analisis: "Lee el proyecto y convierte archivos en senales faciles de revisar. Conviene mirarla si crecen imports, lineas o responsabilidades mezcladas.",
    Artefactos: "Salidas o archivos generados que suelen ser resultado de otras herramientas.",
    Backend: "Procesa solicitudes, coordina reglas y entrega datos a otras partes.",
    Calidad: "Pruebas y verificaciones que ayudan a cambiar con confianza.",
    "Core / Processing": "Concentra el trabajo principal del sistema. Suele ser el primer lugar para revisar complejidad, fan-out y archivos grandes.",
    Config: "Ajustes que definen como se instala, arranca o se comporta el proyecto.",
    Dependencias: "Codigo externo o cache que normalmente no se edita a mano.",
    Docs: "Explicaciones para entender o usar el proyecto. Ayuda a alinear equipos sin entrar al codigo.",
    Logica: "Reglas, funciones y procesos principales del sistema.",
    Persistencia: "Guarda, lee o compara informacion entre ejecuciones.",
    Selectors: "Agrupa reglas para ubicar o elegir datos. Es sensible cuando cambian pantallas, HTML o estructuras externas.",
    Snapshots: "Gestiona snapshots y comparaciones entre versiones. Es clave para medir si un refactor realmente mejoro la estructura.",
    Soporte: "Archivos auxiliares que complementan el sistema.",
    "Tests / Quality": "Pruebas y verificaciones que ayudan a cambiar con confianza. Muestra que partes protegen el comportamiento.",
    UI: "Pantallas, componentes y estilos que ve la persona usuaria.",
    "UI / Frontend": "Pantallas, componentes y estilos que ve la persona usuaria. Conecta datos tecnicos con una experiencia entendible.",
    "Web Scraping": "Extrae informacion de paginas o fuentes externas. Conviene revisarla cuando cambian selectores, tiempos o formatos."
  };

  return descriptions[label] ?? "Parte del proyecto detectada por ruta, nombre o imports.";
}

function describeRelation(relation) {
  if (relation.from === "Tests / Quality") {
    return `Calidad valida ${relation.to} en ${relation.count} conexiones detectadas.`;
  }

  if (relation.to === "Config") {
    return `${relation.from} depende de ajustes de configuracion en ${relation.count} puntos.`;
  }

  if (relation.to === "Snapshots" || relation.from === "Snapshots") {
    return `La lectura historica toca ${relation.from === "Snapshots" ? relation.to : relation.from} en ${relation.count} conexiones.`;
  }

  return `${relation.from} usa ${relation.to} en ${relation.count} conexiones internas.`;
}

function role(id, label, summary, purpose, layer, confidence = "high") {
  return { confidence, id, label, layer, purpose, summary };
}

function toId(value) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}
