import {
  AlertTriangle,
  ArrowLeft,
  BarChart3,
  BookOpen,
  ChevronDown,
  Code2,
  Database,
  FileCode2,
  FileSearch,
  FileText,
  Folder,
  FolderTree,
  Gauge,
  GitBranch,
  Info,
  Layers,
  LockKeyhole,
  Map as MapIcon,
  Maximize2,
  Minimize2,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  Target
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

const examplePath = String.raw`C:\Users\juan.monroy\Desktop\Visualizador de proyectos\project-lens`;
const placeholderPath = String.raw`C:\Users\TuUsuario\Desktop\mi-proyecto`;
const storageKey = "project-lens:scan-settings";
const quickPatternExamples = ["outputs/**", "reports/**", "artifacts/**", ".tmp/**", "*.log"];
const maxNodesPerColumn = 7;
const maxFilesPerFolder = 4;

const stackPresets = [
  {
    id: "node",
    label: "Node/React",
    patterns: [".next/**", ".turbo/**", ".vite/**", "storybook-static/**", "coverage/**"]
  },
  {
    id: "python",
    label: "Python",
    patterns: [".venv/**", "venv/**", "__pycache__/**", ".pytest_cache/**", ".mypy_cache/**", "htmlcov/**"]
  },
  {
    id: "java",
    label: "Java/Spring",
    patterns: ["target/**", ".gradle/**", "out/**", "logs/**"]
  },
  {
    id: "dotnet",
    label: ".NET",
    patterns: ["bin/**", "obj/**", "TestResults/**", "packages/**"]
  },
  {
    id: "data",
    label: "Data/ML",
    patterns: ["data/raw/**", "data/processed/**", "models/**", "mlruns/**", ".ipynb_checkpoints/**"]
  },
  {
    id: "mobile",
    label: "Mobile",
    patterns: ["android/build/**", "ios/build/**", ".expo/**", ".gradle/**", "DerivedData/**"]
  }
];

const generatedFolderHints = [
  "artifact",
  "artifacts",
  "dump",
  "dumps",
  "export",
  "exports",
  "generated",
  "output",
  "outputs",
  "report",
  "reports",
  "screenshot",
  "screenshots",
  "snapshot",
  "snapshots"
];

const emptyGitVersions = { available: false, commits: [] };
const workingVersionValue = "working:current";
const initialSettings = loadInitialSettings();

function App() {
  const [root, setRoot] = useState(initialSettings.root);
  const [scan, setScan] = useState(null);
  const [view, setView] = useState("dashboard");
  const [filter, setFilter] = useState("");
  const [extensionFilter, setExtensionFilter] = useState("all");
  const [useGitignore, setUseGitignore] = useState(initialSettings.useGitignore);
  const [useGeneratedPreset, setUseGeneratedPreset] = useState(initialSettings.useGeneratedPreset);
  const [secureMode, setSecureMode] = useState(initialSettings.secureMode);
  const [manualIgnoreText, setManualIgnoreText] = useState(initialSettings.manualIgnoreText);
  const [includeOverridesText, setIncludeOverridesText] = useState(initialSettings.includeOverridesText);
  const [disabledRules, setDisabledRules] = useState(initialSettings.disabledRules);
  const [optionsOpen, setOptionsOpen] = useState(true);
  const [activeTab, setActiveTab] = useState("summary");
  const [mapMetric, setMapMetric] = useState("lines");
  const [snapshots, setSnapshots] = useState([]);
  const [gitVersions, setGitVersions] = useState(emptyGitVersions);
  const [snapshotBase, setSnapshotBase] = useState("");
  const [snapshotTarget, setSnapshotTarget] = useState("");
  const [snapshotComparison, setSnapshotComparison] = useState(null);
  const [snapshotStatus, setSnapshotStatus] = useState("");
  const [selectedFilePath, setSelectedFilePath] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const manualIgnorePatterns = useMemo(() => parsePatternText(manualIgnoreText), [manualIgnoreText]);
  const includeOverrides = useMemo(() => parsePatternText(includeOverridesText), [includeOverridesText]);

  const extensionOptions = useMemo(() => {
    if (!scan) {
      return [];
    }

    return scan.byExtension.map((item) => item.extension);
  }, [scan]);

  const quickIgnoreSuggestions = useMemo(
    () => buildQuickIgnoreSuggestions(scan, manualIgnorePatterns),
    [manualIgnorePatterns, scan]
  );

  const filteredFiles = useMemo(() => {
    if (!scan) {
      return [];
    }

    const search = filter.trim().toLowerCase();

    return scan.files.filter((file) => {
      const matchesText =
        !search ||
        file.relativePath.toLowerCase().includes(search) ||
        file.parentFolder.toLowerCase().includes(search) ||
        file.extension.toLowerCase().includes(search);
      const matchesExtension = extensionFilter === "all" || file.extension === extensionFilter;

      return matchesText && matchesExtension;
    });
  }, [extensionFilter, filter, scan]);

  const selectedFile = useMemo(() => {
    if (!scan || !selectedFilePath) {
      return null;
    }

    return scan.files.find((file) => file.relativePath === selectedFilePath) ?? null;
  }, [scan, selectedFilePath]);

  useEffect(() => {
    saveSettings({
      manualIgnoreText,
      includeOverridesText,
      disabledRules,
      root,
      secureMode,
      useGeneratedPreset,
      useGitignore
    });
  }, [disabledRules, includeOverridesText, manualIgnoreText, root, secureMode, useGeneratedPreset, useGitignore]);

  const addManualPattern = (pattern) => {
    setManualIgnoreText((current) => mergePatternText(current, [pattern]));
  };

  const applyStackPreset = (preset) => {
    setUseGeneratedPreset(true);
    setManualIgnoreText((current) => mergePatternText(current, preset.patterns));
  };

  const scanRoot = async () => {
    if (!root.trim()) {
      setError("Ingresa una ruta local.");
      return;
    }

    setLoading(true);
    setError("");

    try {
      const params = new URLSearchParams({
        root: root.trim(),
        useGeneratedPreset: String(useGeneratedPreset),
        useGitignore: String(useGitignore)
      });

      manualIgnorePatterns.forEach((pattern) => {
        params.append("ignore", pattern);
      });
      includeOverrides.forEach((pattern) => {
        params.append("include", pattern);
      });
      disabledRules.forEach((pattern) => {
        params.append("disabledRule", pattern);
      });

      const response = await fetch(`/api/scan?${params.toString()}`);
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.error || "No fue posible escanear la carpeta.");
      }

      setScan(payload);
      setFilter("");
      setExtensionFilter("all");
      setActiveTab("summary");
      setView("dashboard");
      setSnapshotComparison(null);
      setSelectedFilePath("");

      const [nextSnapshots, nextGitVersions] = await Promise.all([
        loadSnapshots(root.trim()),
        loadGitVersions(root.trim())
      ]);
      const defaults = getDefaultVersionSelection(nextSnapshots, nextGitVersions);

      setSnapshotBase(defaults.base);
      setSnapshotTarget(defaults.target);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Error inesperado.");
    } finally {
      setLoading(false);
    }
  };

  const loadSnapshots = async (rootValue = root.trim()) => {
    if (!rootValue) {
      return [];
    }

    try {
      const params = new URLSearchParams({ root: rootValue });
      const response = await fetch(`/api/snapshots?${params.toString()}`);
      const payload = await response.json();

      if (response.ok) {
        const nextSnapshots = payload.snapshots ?? [];
        setSnapshots(nextSnapshots);
        return nextSnapshots;
      }
    } catch {
      setSnapshots([]);
      return [];
    }

    setSnapshots([]);
    return [];
  };

  const loadGitVersions = async (rootValue = root.trim()) => {
    if (!rootValue) {
      return emptyGitVersions;
    }

    try {
      const params = new URLSearchParams({ limit: "30", root: rootValue });
      const response = await fetch(`/api/git/versions?${params.toString()}`);
      const payload = await response.json();

      if (response.ok) {
        const nextGitVersions = payload.git ?? emptyGitVersions;
        setGitVersions(nextGitVersions);
        return nextGitVersions;
      }
    } catch {
      setGitVersions(emptyGitVersions);
      return emptyGitVersions;
    }

    setGitVersions(emptyGitVersions);
    return emptyGitVersions;
  };

  const saveProjectConfig = async () => {
    if (!root.trim()) {
      setError("Ingresa una ruta local antes de guardar configuracion.");
      return;
    }

    setSnapshotStatus("Guardando .project-lens.json...");

    try {
      const params = new URLSearchParams({ root: root.trim() });
      const response = await fetch(`/api/config?${params.toString()}`, {
        body: JSON.stringify({
          exclude: manualIgnorePatterns,
          includeOverrides,
          disabledRules,
          categories: scan?.projectLensConfig?.config?.categories
        }),
        headers: { "Content-Type": "application/json" },
        method: "PUT"
      });
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.error || "No fue posible guardar la configuracion.");
      }

      setSnapshotStatus("Configuracion guardada en .project-lens.json");
    } catch (requestError) {
      setSnapshotStatus("");
      setError(requestError instanceof Error ? requestError.message : "Error guardando configuracion.");
    }
  };

  const toggleDisabledRule = (pattern) => {
    setDisabledRules((current) =>
      current.includes(pattern) ? current.filter((item) => item !== pattern) : [...current, pattern]
    );
  };

  const saveCurrentSnapshot = async () => {
    if (!scan) {
      return;
    }

    setSnapshotStatus("Guardando snapshot...");

    try {
      const response = await fetch("/api/snapshots", {
        body: JSON.stringify({ root: scan.root, scan }),
        headers: { "Content-Type": "application/json" },
        method: "POST"
      });
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.error || "No fue posible guardar el snapshot.");
      }

      const nextSnapshots = [payload.snapshot, ...snapshots.filter((item) => item.id !== payload.snapshot.id)];
      const nextDefaults = getDefaultVersionSelection(nextSnapshots, gitVersions);
      const savedSnapshotValue = encodeVersionValue("snapshot", payload.snapshot.id);

      setSnapshots(nextSnapshots);
      setSnapshotStatus("Snapshot guardado");
      setSnapshotBase((current) => current || nextDefaults.base || savedSnapshotValue);
      setSnapshotTarget(savedSnapshotValue);
    } catch (requestError) {
      setSnapshotStatus("");
      setError(requestError instanceof Error ? requestError.message : "Error guardando snapshot.");
    }
  };

  const compareSelectedSnapshots = async () => {
    if (!scan || !snapshotBase || !snapshotTarget) {
      setSnapshotStatus("Selecciona dos versiones para comparar.");
      return;
    }

    setSnapshotStatus("Comparando versiones...");

    try {
      const response = await fetch("/api/versions/compare", {
        body: JSON.stringify({
          base: parseVersionValue(snapshotBase),
          currentScan: scan,
          root: scan.root,
          scanOptions: scan.scanOptions,
          target: parseVersionValue(snapshotTarget)
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST"
      });
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.error || "No fue posible comparar versiones.");
      }

      setSnapshotComparison(payload.comparison);
      setSnapshotStatus("Comparacion lista");
    } catch (requestError) {
      setSnapshotStatus("");
      setError(requestError instanceof Error ? requestError.message : "Error comparando versiones.");
    }
  };

  const handleScanSubmit = (event) => {
    event.preventDefault();
    scanRoot();
  };

  if (view === "visual-map" && scan) {
    return (
      <VisualMapPage
        metric={mapMetric}
        onBack={() => setView("dashboard")}
        scan={scan}
        secureMode={secureMode}
        setMetric={setMapMetric}
      />
    );
  }

  return (
    <main className="shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Local dashboard</p>
          <h1>Project Lens</h1>
        </div>
        <form className="scan-form" onSubmit={handleScanSubmit}>
          <label className="path-field">
            <span>Ruta local</span>
            <input
              value={root}
              onChange={(event) => setRoot(event.target.value)}
              spellCheck="false"
              placeholder={placeholderPath}
            />
          </label>
          <button className="primary-button" disabled={loading} type="submit">
            {loading ? <RefreshCw className="spin" size={18} /> : <FileSearch size={18} />}
            <span>{loading ? "Escaneando" : "Escanear"}</span>
          </button>
        </form>
      </header>

      <SecureModeBanner secureMode={secureMode} />

      <ScanOptionsPanel
        loading={loading}
        includeOverridesText={includeOverridesText}
        manualIgnorePatterns={manualIgnorePatterns}
        manualIgnoreText={manualIgnoreText}
        onAddPattern={addManualPattern}
        onApplyPreset={applyStackPreset}
        onRescan={scanRoot}
        onSaveConfig={saveProjectConfig}
        open={optionsOpen}
        quickIgnoreSuggestions={quickIgnoreSuggestions}
        secureMode={secureMode}
        setIncludeOverridesText={setIncludeOverridesText}
        setManualIgnoreText={setManualIgnoreText}
        setOpen={setOptionsOpen}
        setSecureMode={setSecureMode}
        setUseGeneratedPreset={setUseGeneratedPreset}
        setUseGitignore={setUseGitignore}
        useGeneratedPreset={useGeneratedPreset}
        useGitignore={useGitignore}
      />

      {error ? <div className="alert">{error}</div> : null}

      {scan ? (
        <Dashboard
          extensionFilter={extensionFilter}
          extensionOptions={extensionOptions}
          filteredFiles={filteredFiles}
          filter={filter}
          activeTab={activeTab}
          disabledRules={disabledRules}
          includeOverridesText={includeOverridesText}
          onOpenMap={() => setView("visual-map")}
          onCompareSnapshots={compareSelectedSnapshots}
          onSaveConfig={saveProjectConfig}
          onSaveSnapshot={saveCurrentSnapshot}
          gitVersions={gitVersions}
          scan={scan}
          secureMode={secureMode}
          selectedFile={selectedFile}
          selectedFilePath={selectedFilePath}
          setExtensionFilter={setExtensionFilter}
          setFilter={setFilter}
          setActiveTab={setActiveTab}
          setIncludeOverridesText={setIncludeOverridesText}
          setSelectedFilePath={setSelectedFilePath}
          snapshotBase={snapshotBase}
          snapshotComparison={snapshotComparison}
          snapshots={snapshots}
          snapshotStatus={snapshotStatus}
          snapshotTarget={snapshotTarget}
          setSnapshotBase={setSnapshotBase}
          setSnapshotTarget={setSnapshotTarget}
          toggleDisabledRule={toggleDisabledRule}
        />
      ) : (
        <EmptyState />
      )}
    </main>
  );
}

function SecureModeBanner({ secureMode }) {
  if (!secureMode) {
    return null;
  }

  return (
    <section className="secure-banner">
      <LockKeyhole size={20} />
      <div>
        <strong>Modo Banco Seguro</strong>
        <span>Operacion local, sin subir datos, sin mostrar contenido fuente: solo rutas, tamanos, fechas y conteos.</span>
      </div>
    </section>
  );
}

function ScanOptionsPanel({
  includeOverridesText,
  loading,
  manualIgnorePatterns,
  manualIgnoreText,
  onAddPattern,
  onApplyPreset,
  onRescan,
  onSaveConfig,
  open,
  quickIgnoreSuggestions,
  secureMode,
  setIncludeOverridesText,
  setManualIgnoreText,
  setOpen,
  setSecureMode,
  setUseGeneratedPreset,
  setUseGitignore,
  useGeneratedPreset,
  useGitignore
}) {
  return (
    <section className="options-panel">
      <button
        aria-expanded={open}
        className="options-toggle"
        onClick={() => setOpen(!open)}
        type="button"
      >
        <span className="options-title">
          <Settings2 size={18} />
          <strong>Opciones de escaneo</strong>
        </span>
        <ChevronDown className={open ? "chevron open" : "chevron"} size={18} />
      </button>

      {open ? (
        <div className="options-body">
          <div className="toggle-grid">
            <ToggleRow
              checked={secureMode}
              icon={<LockKeyhole size={18} />}
              label="Banco Seguro"
              onChange={setSecureMode}
            />
            <ToggleRow
              checked={useGitignore}
              icon={<GitBranch size={18} />}
              label="Usar .gitignore"
              onChange={setUseGitignore}
            />
            <ToggleRow
              checked={useGeneratedPreset}
              icon={<Sparkles size={18} />}
              label="Outputs comunes"
              onChange={setUseGeneratedPreset}
            />
          </div>

          <div className="preset-block">
            <div>
              <span>Presets por stack</span>
            </div>
            <div className="preset-grid">
              {stackPresets.map((preset) => (
                <button className="preset-button" key={preset.id} onClick={() => onApplyPreset(preset)} type="button">
                  <Layers size={15} />
                  <span>{preset.label}</span>
                </button>
              ))}
            </div>
          </div>

          <label className="ignore-editor">
            <span>Ignorar adicionalmente</span>
            <textarea
              onChange={(event) => setManualIgnoreText(event.target.value)}
              placeholder={"outputs/**\nreports/**\nartifacts/**"}
              rows={4}
              spellCheck="false"
              value={manualIgnoreText}
            />
          </label>

          <label className="ignore-editor include-editor">
            <span>Incluir aunque este ignorado</span>
            <textarea
              onChange={(event) => setIncludeOverridesText(event.target.value)}
              placeholder={"outputs/case_demo9/report.md\noutputs/case_123/**/*.json"}
              rows={3}
              spellCheck="false"
              value={includeOverridesText}
            />
          </label>

          <div className="quick-patterns">
            {quickPatternExamples.map((pattern) => (
              <button className="chip-button" key={pattern} onClick={() => onAddPattern(pattern)} type="button">
                <Plus size={14} />
                <span>{pattern}</span>
              </button>
            ))}
          </div>

          {quickIgnoreSuggestions.length > 0 ? (
            <div className="quick-patterns suggested">
              {quickIgnoreSuggestions.map((pattern) => (
                <button className="chip-button strong" key={pattern} onClick={() => onAddPattern(pattern)} type="button">
                  <Plus size={14} />
                  <span>{pattern}</span>
                </button>
              ))}
            </div>
          ) : null}

          <div className="options-footer">
            <span>{formatNumber(manualIgnorePatterns.length)} reglas manuales</span>
            <div className="option-actions">
              <button className="secondary-button" disabled={loading} onClick={onSaveConfig} type="button">
                <ShieldCheck size={16} />
                <span>Guardar config</span>
              </button>
              <button className="secondary-button" disabled={loading} onClick={onRescan} type="button">
                {loading ? <RefreshCw className="spin" size={16} /> : <ShieldCheck size={16} />}
                <span>{loading ? "Escaneando" : "Re-escanear"}</span>
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function ToggleRow({ checked, icon, label, onChange }) {
  return (
    <label className="toggle-row">
      <input checked={checked} onChange={(event) => onChange(event.target.checked)} type="checkbox" />
      <span className={checked ? "toggle-switch checked" : "toggle-switch"} />
      <span className="toggle-copy">
        <span className="toggle-label">
          {icon}
          <strong>{label}</strong>
        </span>
        <span>{checked ? "activo" : "inactivo"}</span>
      </span>
    </label>
  );
}

function Dashboard({
  activeTab,
  disabledRules,
  extensionFilter,
  extensionOptions,
  filteredFiles,
  filter,
  gitVersions,
  includeOverridesText,
  onCompareSnapshots,
  onOpenMap,
  onSaveConfig,
  onSaveSnapshot,
  scan,
  secureMode,
  selectedFile,
  selectedFilePath,
  setActiveTab,
  setExtensionFilter,
  setFilter,
  setIncludeOverridesText,
  setSelectedFilePath,
  setSnapshotBase,
  setSnapshotTarget,
  snapshotBase,
  snapshotComparison,
  snapshots,
  snapshotStatus,
  snapshotTarget,
  toggleDisabledRule
}) {
  return (
    <>
      <section className="metrics-grid">
        <Metric icon={<FileCode2 size={20} />} label="Archivos" value={formatNumber(scan.totals.files)} />
        <Metric icon={<BarChart3 size={20} />} label="Lineas" value={formatNumber(scan.totals.lines)} />
        <Metric icon={<Database size={20} />} label="Tamano" value={formatBytes(scan.totals.bytes)} />
        <Metric icon={<FolderTree size={20} />} label="Carpetas" value={formatNumber(scan.totals.folders)} />
      </section>

      <DashboardActions onOpenMap={onOpenMap} scan={scan} secureMode={secureMode} />

      <DashboardTabs activeTab={activeTab} setActiveTab={setActiveTab} />

      {activeTab === "summary" ? (
        <SummaryTab scan={scan} />
      ) : null}

      {activeTab === "critical" ? (
        <CriticalTab
          extensionFilter={extensionFilter}
          extensionOptions={extensionOptions}
          filteredFiles={filteredFiles}
          filter={filter}
          scan={scan}
          selectedFile={selectedFile}
          selectedFilePath={selectedFilePath}
          setExtensionFilter={setExtensionFilter}
          setFilter={setFilter}
          setSelectedFilePath={setSelectedFilePath}
        />
      ) : null}

      {activeTab === "architecture" ? <ArchitectureTab scan={scan} /> : null}

      {activeTab === "categories" ? <CategoriesTab scan={scan} /> : null}

      {activeTab === "ignored" ? (
        <IgnoredFiltersTab
          disabledRules={disabledRules}
          includeOverridesText={includeOverridesText}
          onSaveConfig={onSaveConfig}
          scan={scan}
          setIncludeOverridesText={setIncludeOverridesText}
          toggleDisabledRule={toggleDisabledRule}
        />
      ) : null}

      {activeTab === "dependencies" ? <DependenciesTab scan={scan} /> : null}

      {activeTab === "snapshots" ? (
        <SnapshotsTab
          onCompareSnapshots={onCompareSnapshots}
          onSaveSnapshot={onSaveSnapshot}
          setSnapshotBase={setSnapshotBase}
          setSnapshotTarget={setSnapshotTarget}
          gitVersions={gitVersions}
          snapshotBase={snapshotBase}
          snapshotComparison={snapshotComparison}
          snapshots={snapshots}
          snapshotStatus={snapshotStatus}
          snapshotTarget={snapshotTarget}
        />
      ) : null}

      {activeTab === "recommendations" ? <RecommendationsTab scan={scan} /> : null}

      {scan.errors.length > 0 ? (
        <section className="table-panel">
          <div className="table-heading compact">
            <div>
              <p className="eyebrow">Avisos</p>
              <h2>Rutas omitidas por error</h2>
            </div>
            <AlertTriangle size={20} />
          </div>
          <ul className="error-list">
            {scan.errors.map((item) => (
              <li key={`${item.path}-${item.message}`}>
                <strong>{item.path}</strong>
                <span>{item.message}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </>
  );
}

const dashboardTabs = [
  { id: "summary", label: "Resumen" },
  { id: "critical", label: "Archivos criticos" },
  { id: "architecture", label: "Arquitectura" },
  { id: "categories", label: "Categorias" },
  { id: "ignored", label: "Ignorados / filtros" },
  { id: "dependencies", label: "Dependencias" },
  { id: "snapshots", label: "Antes vs despues" },
  { id: "recommendations", label: "Recomendaciones" }
];

function DashboardTabs({ activeTab, setActiveTab }) {
  return (
    <nav className="dashboard-tabs" aria-label="Secciones de Project Lens">
      {dashboardTabs.map((tab) => (
        <button
          className={activeTab === tab.id ? "tab-button active" : "tab-button"}
          key={tab.id}
          onClick={() => setActiveTab(tab.id)}
          type="button"
        >
          {tab.label}
        </button>
      ))}
    </nav>
  );
}

function SummaryTab({ scan }) {
  return (
    <>
      <IgnoreSummary scan={scan} />

      <section className="workspace-grid">
        <Panel icon={<Gauge size={18} />} title="Archivos criticos para refactor">
          <HotspotList files={scan.refactorHotspots} />
        </Panel>

        <Panel icon={<BarChart3 size={18} />} title="Distribucion por extension">
          <ExtensionDistribution items={scan.byExtension} />
        </Panel>
      </section>

      <section className="workspace-grid three-columns">
        <Panel icon={<BarChart3 size={18} />} title="Top 20 por lineas">
          <RankedList files={scan.topByLines} metric="lines" metricLabel="lineas" />
        </Panel>

        <Panel icon={<Database size={18} />} title="Top 20 por tamano">
          <RankedList files={scan.topBySize} metric="bytes" metricLabel="tamano" formatter={formatBytes} />
        </Panel>

        <Panel icon={<FolderTree size={18} />} title="Carpetas con mas lineas">
          <FolderList folders={scan.foldersByLines} />
        </Panel>
      </section>
    </>
  );
}

function CriticalTab({
  extensionFilter,
  extensionOptions,
  filteredFiles,
  filter,
  scan,
  selectedFile,
  selectedFilePath,
  setExtensionFilter,
  setFilter,
  setSelectedFilePath
}) {
  return (
    <>
      <section className="workspace-grid">
        <Panel icon={<Gauge size={18} />} title="Prioridad de refactor">
          <HotspotList files={scan.refactorHotspots} />
        </Panel>
        <Panel icon={<AlertTriangle size={18} />} title="Alertas de acoplamiento">
          <SignalList alerts={scan.couplingAlerts ?? []} />
        </Panel>
      </section>

      <FilesPanel
        extensionFilter={extensionFilter}
        extensionOptions={extensionOptions}
        files={filteredFiles}
        filter={filter}
        selectedFile={selectedFile}
        selectedFilePath={selectedFilePath}
        setExtensionFilter={setExtensionFilter}
        setFilter={setFilter}
        setSelectedFilePath={setSelectedFilePath}
      />
    </>
  );
}

function ArchitectureTab({ scan }) {
  const insights = scan.architectureInsights;
  const layers = insights?.layers ?? [];
  const files = scan.files ?? [];
  const firstLayerId = layers[0]?.id ?? "";
  const [expandedLayerId, setExpandedLayerId] = useState(firstLayerId);
  const [selectedItem, setSelectedItem] = useState({ type: "layer", id: firstLayerId });
  const filesByLayer = useMemo(() => groupFilesByLayer(files), [files]);

  useEffect(() => {
    if (!firstLayerId) {
      return;
    }

    if (!layers.some((layer) => layer.id === expandedLayerId)) {
      setExpandedLayerId(firstLayerId);
    }

    const selectedExists =
      selectedItem.type === "file"
        ? files.some((file) => file.relativePath === selectedItem.id)
        : layers.some((layer) => layer.id === selectedItem.id);

    if (!selectedExists) {
      setSelectedItem({ type: "layer", id: firstLayerId });
    }
  }, [expandedLayerId, files, firstLayerId, layers, selectedItem.id, selectedItem.type]);

  if (!insights) {
    return (
      <section className="table-panel">
        <p className="empty-copy">Aun no hay lectura de arquitectura para este scan.</p>
      </section>
    );
  }

  const expandedLayer = layers.find((layer) => layer.id === expandedLayerId) ?? layers[0];
  const selectedDetail = buildArchitectureDetail({
    files,
    layers,
    relations: insights.relations ?? [],
    selectedItem
  });
  const selectLayer = (layer) => {
    setExpandedLayerId(layer.id);
    setSelectedItem({ type: "layer", id: layer.id });
  };
  const selectFile = (filePath) => {
    setSelectedItem({ type: "file", id: filePath });
  };

  return (
    <>
      <section className="architecture-hero">
        <div>
          <p className="eyebrow">Arquitectura</p>
          <h2>Lectura simple del proyecto</h2>
          <p>{insights.summary}</p>
        </div>
        <div className="architecture-stack">
          {(insights.stack?.length ? insights.stack : ["Inferido localmente"]).map((item) => (
            <span key={item}>{item}</span>
          ))}
        </div>
      </section>

      <ArchitectureJourney flow={insights.flow ?? []} />

      <section className="architecture-explorer">
        <div className="architecture-map-panel">
          <div className="architecture-map-heading">
            <div>
              <p className="eyebrow">Explorer</p>
              <h2>Mapa de capas</h2>
            </div>
            <span>{formatNumber(layers.length)} zonas detectadas</span>
          </div>

          <ArchitectureMap
            expandedLayerId={expandedLayer?.id ?? ""}
            filesByLayer={filesByLayer}
            layers={layers}
            onFileSelect={selectFile}
            onLayerSelect={selectLayer}
            relations={insights.relations ?? []}
            selectedItem={selectedItem}
          />
        </div>

        <ArchitectureDetailPanel detail={selectedDetail} onFileSelect={selectFile} />
      </section>
    </>
  );
}

function ArchitectureJourney({ flow }) {
  if (flow.length === 0) {
    return null;
  }

  return (
    <section className="architecture-journey" aria-label="Flujo principal del sistema">
      {flow.slice(0, 5).map((step, index) => (
        <article className="journey-step" key={`${step.title}-${index}`}>
          <span>{index + 1}</span>
          <div>
            <strong>{step.title}</strong>
            <em>{step.detail}</em>
          </div>
        </article>
      ))}
    </section>
  );
}

function ArchitectureMap({
  expandedLayerId,
  filesByLayer,
  layers,
  onFileSelect,
  onLayerSelect,
  relations,
  selectedItem
}) {
  if (layers.length === 0) {
    return <p className="empty-copy">No se detectaron capas claras en este proyecto.</p>;
  }

  return (
    <div className="architecture-map">
      {layers.map((layer) => {
        const layerFiles = filesByLayer.get(layer.label) ?? [];
        const expanded = layer.id === expandedLayerId;

        return (
          <ArchitectureLayerNode
            expanded={expanded}
            key={layer.id}
            layer={layer}
            layerFiles={layerFiles}
            onFileSelect={onFileSelect}
            onLayerSelect={onLayerSelect}
            relatedRelations={getLayerRelations(relations, layer.label)}
            selectedItem={selectedItem}
          />
        );
      })}
    </div>
  );
}

function ArchitectureLayerNode({
  expanded,
  layer,
  layerFiles,
  onFileSelect,
  onLayerSelect,
  relatedRelations,
  selectedItem
}) {
  const LayerIcon = getLayerIcon(layer.label);
  const visibleFiles = layerFiles.slice(0, 5);
  const extraCount = Math.max(0, layerFiles.length - visibleFiles.length);

  return (
    <article className={expanded ? "architecture-node expanded" : "architecture-node"}>
      <button className="architecture-node-main" onClick={() => onLayerSelect(layer)} type="button">
        <span className="architecture-node-icon">
          <LayerIcon size={18} />
        </span>
        <span className="architecture-node-copy">
          <strong>{layer.label}</strong>
          <em>{getLayerShortDescription(layer.description)}</em>
        </span>
        <span className="architecture-node-score">{formatNumber(layer.files)}</span>
      </button>

      {expanded ? (
        <div className="architecture-node-open">
          <div className="architecture-node-metrics">
            <span>{formatNumber(layer.files)} archivos</span>
            <span>{formatNumber(layer.lines)} lineas</span>
            <span>{getLayerRiskLabel(layerFiles)}</span>
          </div>

          <div className="architecture-file-cloud">
            {visibleFiles.map((file) => (
              <button
                className={selectedItem.type === "file" && selectedItem.id === file.relativePath ? "file-badge active" : "file-badge"}
                key={file.relativePath}
                onClick={() => onFileSelect(file.relativePath)}
                title={file.relativePath}
                type="button"
              >
                {getCompactFileName(file.relativePath)}
              </button>
            ))}
            {extraCount > 0 ? <span className="more-files-badge">+ {formatNumber(extraCount)} archivos mas</span> : null}
          </div>

          <LayerConnectionStrip layer={layer} relations={relatedRelations} />
        </div>
      ) : null}
    </article>
  );
}

function LayerConnectionStrip({ layer, relations }) {
  if (relations.length === 0) {
    return <span className="connection-empty">Sin conexiones fuertes fuera de esta capa.</span>;
  }

  return (
    <div className="layer-connection-strip">
      {relations.slice(0, 4).map((relation) => {
        const target = relation.from === layer.label ? relation.to : relation.from;

        return (
          <span className="connection-path" key={`${relation.from}-${relation.to}`}>
            <em>{layer.label}</em>
            <i />
            <strong>{target}</strong>
            <small>{formatNumber(relation.count)}</small>
          </span>
        );
      })}
    </div>
  );
}

function ArchitectureDetailPanel({ detail, onFileSelect }) {
  if (!detail) {
    return (
      <aside className="architecture-detail-panel">
        <p className="empty-copy">Selecciona una capa o archivo para ver contexto.</p>
      </aside>
    );
  }

  return (
    <aside className="architecture-detail-panel">
      <div className="architecture-detail-heading">
        <p className="eyebrow">{detail.eyebrow}</p>
        <h2>{detail.title}</h2>
        <span>{detail.badge}</span>
      </div>

      <div className="architecture-detail-section">
        <strong>Que hace</strong>
        <p>{detail.summary}</p>
      </div>

      <div className="architecture-detail-section">
        <strong>Por que importa</strong>
        <p>{detail.importance}</p>
      </div>

      <div className="architecture-detail-section">
        <strong>Archivos clave</strong>
        <div className="detail-file-list">
          {detail.keyFiles.length > 0 ? (
            detail.keyFiles.map((file) => (
              <button key={file.relativePath} onClick={() => onFileSelect(file.relativePath)} title={file.relativePath} type="button">
                <span>{getCompactFileName(file.relativePath)}</span>
                <em>{file.fileInsights?.role ?? "Archivo"}</em>
              </button>
            ))
          ) : (
            <span className="empty-inline">Sin archivos clave destacados.</span>
          )}
        </div>
      </div>

      <div className="architecture-detail-section">
        <strong>Relaciones principales</strong>
        <div className="detail-relation-list">
          {detail.relations.length > 0 ? (
            detail.relations.map((relation) => (
              <span key={`${relation.from}-${relation.to}`}>
                {relation.from} -&gt; {relation.to}
                <em>{formatNumber(relation.count)}</em>
              </span>
            ))
          ) : (
            <span className="empty-inline">Sin relaciones externas fuertes.</span>
          )}
        </div>
      </div>

      <div className="architecture-detail-section">
        <strong>Riesgos detectados</strong>
        <div className="detail-risk-list">
          {detail.risks.map((risk) => (
            <span key={risk}>{risk}</span>
          ))}
        </div>
      </div>

      <div className="architecture-recommendation">
        <Sparkles size={16} />
        <span>{detail.recommendation}</span>
      </div>
    </aside>
  );
}

function groupFilesByLayer(files) {
  const groups = new Map();

  for (const file of files) {
    const layer = file.fileInsights?.layer ?? file.categoryLabel ?? "Soporte";
    const current = groups.get(layer) ?? [];
    current.push(file);
    groups.set(layer, current);
  }

  for (const [layer, layerFiles] of groups.entries()) {
    groups.set(layer, [...layerFiles].sort((a, b) => getFileFocusScore(b) - getFileFocusScore(a)));
  }

  return groups;
}

function buildArchitectureDetail({ files, layers, relations, selectedItem }) {
  if (selectedItem.type === "file") {
    const file = files.find((item) => item.relativePath === selectedItem.id);

    if (!file) {
      return null;
    }

    const related = relations.filter(
      (relation) => relation.from === file.fileInsights?.layer || relation.to === file.fileInsights?.layer
    );

    return {
      badge: file.fileInsights?.role ?? "Archivo",
      eyebrow: "Archivo",
      importance: file.fileInsights?.purpose ?? "Ayuda a sostener una parte del flujo.",
      keyFiles: [],
      recommendation: getFileRecommendation(file),
      relations: related.slice(0, 4),
      risks: [file.fileInsights?.risk ?? "Revisa el flujo relacionado despues de tocarlo."],
      summary: file.fileInsights?.summary ?? "Aporta una pieza al proyecto.",
      title: file.relativePath
    };
  }

  const layer = layers.find((item) => item.id === selectedItem.id) ?? layers[0];

  if (!layer) {
    return null;
  }

  const layerFiles = files
    .filter((file) => file.fileInsights?.layer === layer.label)
    .sort((a, b) => getFileFocusScore(b) - getFileFocusScore(a));
  const layerRelations = getLayerRelations(relations, layer.label);

  return {
    badge: `${formatNumber(layer.files)} archivos`,
    eyebrow: "Capa enfocada",
    importance: getLayerImportanceCopy(layer, layerFiles, layerRelations),
    keyFiles: layerFiles.slice(0, 5),
    recommendation: getLayerRecommendation(layer, layerFiles, layerRelations),
    relations: layerRelations.slice(0, 5),
    risks: getLayerRisks(layer, layerFiles, layerRelations),
    summary: layer.description,
    title: layer.label
  };
}

function getLayerRelations(relations, layerLabel) {
  return relations
    .filter((relation) => relation.from === layerLabel || relation.to === layerLabel)
    .sort((a, b) => b.count - a.count);
}

function getLayerIcon(label) {
  const normalized = label.toLowerCase();

  if (normalized.includes("ui") || normalized.includes("frontend")) {
    return Code2;
  }

  if (normalized.includes("api") || normalized.includes("backend")) {
    return GitBranch;
  }

  if (normalized.includes("ai") || normalized.includes("image")) {
    return Sparkles;
  }

  if (normalized.includes("snapshot") || normalized.includes("persist")) {
    return Database;
  }

  if (normalized.includes("config")) {
    return Settings2;
  }

  if (normalized.includes("test") || normalized.includes("quality")) {
    return ShieldCheck;
  }

  if (normalized.includes("doc")) {
    return BookOpen;
  }

  if (normalized.includes("selector") || normalized.includes("scraping")) {
    return Target;
  }

  return Layers;
}

function getLayerShortDescription(description) {
  const [firstSentence] = String(description).split(".");
  return firstSentence || description;
}

function getCompactFileName(filePath) {
  const parts = filePath.split("/");

  if (parts.length <= 2) {
    return filePath;
  }

  return `${parts.at(-2)}/${parts.at(-1)}`;
}

function getFileFocusScore(file) {
  return (
    file.refactorScore +
    (file.codeMetrics?.fanIn ?? 0) * 8 +
    (file.codeMetrics?.fanOut ?? 0) * 5 +
    (file.fileInsights?.importance === "Alta" ? 30 : file.fileInsights?.importance === "Media" ? 12 : 0)
  );
}

function getLayerRiskLabel(layerFiles) {
  if (layerFiles.some((file) => file.refactorScore >= 70 || file.signals?.some((signal) => signal.severity === "high"))) {
    return "riesgo alto";
  }

  if (layerFiles.some((file) => file.refactorScore >= 35 || (file.signals?.length ?? 0) > 0)) {
    return "vigilar";
  }

  return "estable";
}

function getLayerImportanceCopy(layer, files, relations) {
  const topFile = files[0];

  if (relations.length > 0 && topFile) {
    return `${layer.label} conecta con ${relations.length} zonas y su archivo mas sensible parece ser ${topFile.relativePath}.`;
  }

  if (topFile) {
    return `${layer.label} concentra trabajo en ${topFile.relativePath}; revisala si suben lineas, imports o score.`;
  }

  return `${layer.label} resume una zona del proyecto detectada por rutas, imports y categorias.`;
}

function getLayerRisks(layer, files, relations) {
  const risks = [];
  const highScoreFiles = files.filter((file) => file.refactorScore >= 60);
  const highFanOut = files.filter((file) => (file.codeMetrics?.fanOut ?? 0) >= 8);

  if (highScoreFiles.length > 0) {
    risks.push(`${formatNumber(highScoreFiles.length)} archivos con score alto`);
  }

  if (highFanOut.length > 0) {
    risks.push(`${formatNumber(highFanOut.length)} archivos coordinan muchas piezas`);
  }

  if (relations.some((relation) => relation.count >= 10)) {
    risks.push("muchas conexiones con otras capas");
  }

  if (risks.length === 0) {
    risks.push(`${layer.label} no muestra alertas fuertes en este scan`);
  }

  return risks.slice(0, 3);
}

function getLayerRecommendation(layer, files, relations) {
  if (layer.label === "Snapshots") {
    return "Usala para medir si un refactor realmente mejora la estructura entre versiones.";
  }

  if (layer.label.includes("AI")) {
    return "Revisa prompts, parseo y salidas esperadas juntos; suelen romperse por cambios pequenos de formato.";
  }

  if (relations.some((relation) => relation.count >= 15)) {
    return "Empieza por separar contratos claros entre esta capa y sus dependencias mas frecuentes.";
  }

  if (files.some((file) => (file.codeMetrics?.fanOut ?? 0) >= 8)) {
    return "Busca archivos que esten coordinando demasiadas piezas y extrae responsabilidades pequenas.";
  }

  if (files.some((file) => file.lines >= 700)) {
    return "Prioriza dividir los archivos mas grandes antes de mover carpetas completas.";
  }

  return "Mantener esta capa clara: nombres consistentes, dependencias cortas y cambios pequenos.";
}

function getFileRecommendation(file) {
  if ((file.codeMetrics?.fanOut ?? 0) >= 8) {
    return "Revisa si este archivo esta coordinando demasiadas piezas y puede delegar trabajo.";
  }

  if ((file.signals?.length ?? 0) > 0) {
    return "Ataca primero la senal mas evidente antes de hacer una refactorizacion grande.";
  }

  if (file.lines >= 700) {
    return "Conviene dividirlo por responsabilidades o extraer helpers con nombres claros.";
  }

  return "Haz cambios pequenos y valida el flujo que lo usa.";
}

function CategoriesTab({ scan }) {
  return (
    <section className="workspace-grid">
      <Panel icon={<Layers size={18} />} title="Distribucion por categoria">
        <CategoryBreakdown items={scan.byCategory ?? []} />
      </Panel>
      <Panel icon={<Gauge size={18} />} title="Lectura del score">
        <div className="insight-stack">
          <article>
            <strong>Codigo productivo pesa mas</strong>
            <span>Tests, docs y artefactos se muestran, pero bajan su peso en prioridad de refactor.</span>
          </article>
          <article>
            <strong>Artefactos separados del ruido</strong>
            <span>Lo ignorado no entra al score; lo incluido por override conserva categoria propia.</span>
          </article>
          <article>
            <strong>Desconocidos son senal de revision</strong>
            <span>Si muchos archivos caen en desconocidos, ajusta categorias en .project-lens.json.</span>
          </article>
        </div>
      </Panel>
    </section>
  );
}

function IgnoredFiltersTab({
  disabledRules,
  includeOverridesText,
  onSaveConfig,
  scan,
  setIncludeOverridesText,
  toggleDisabledRule
}) {
  const rules = scan.activeIgnorePatterns?.rules ?? [];
  const ignoredByRule = scan.ignoreSummary?.ignoredByRule ?? [];

  return (
    <>
      <IgnoreSummary scan={scan} />
      <section className="workspace-grid">
        <Panel icon={<ShieldCheck size={18} />} title="Reglas activas">
          <div className="rule-list">
            {rules.map((rule) => {
              const stats = ignoredByRule.find((item) => item.pattern === rule.pattern && item.source === rule.source);
              const disabled = disabledRules.includes(rule.pattern);

              return (
                <label className={disabled ? "rule-row disabled" : "rule-row"} key={rule.id}>
                  <input checked={!disabled} onChange={() => toggleDisabledRule(rule.pattern)} type="checkbox" />
                  <span>
                    <strong>{rule.pattern}</strong>
                    <small>{rule.sourceLabel}</small>
                  </span>
                  <em>
                    {formatNumber(stats?.ignoredFolders ?? 0)} carpetas / {formatNumber(stats?.ignoredFiles ?? 0)} archivos
                  </em>
                </label>
              );
            })}
          </div>
        </Panel>

        <Panel icon={<Plus size={18} />} title="Des-ignorar sin tocar .gitignore">
          <label className="ignore-editor include-editor embedded">
            <span>Include overrides</span>
            <textarea
              onChange={(event) => setIncludeOverridesText(event.target.value)}
              placeholder={"outputs/case_demo9/report.md\noutputs/case_123/**/*.json"}
              rows={8}
              spellCheck="false"
              value={includeOverridesText}
            />
          </label>
          <button className="secondary-button wide" onClick={onSaveConfig} type="button">
            <ShieldCheck size={16} />
            <span>Guardar .project-lens.json</span>
          </button>
        </Panel>
      </section>
    </>
  );
}

function DependenciesTab({ scan }) {
  const dependencies = scan.dependencies ?? {};

  return (
    <section className="workspace-grid">
      <Panel icon={<GitBranch size={18} />} title="Fan-in alto">
        <DependencyRank files={dependencies.topFanIn ?? []} metric="fanIn" />
      </Panel>
      <Panel icon={<GitBranch size={18} />} title="Fan-out alto">
        <DependencyRank files={dependencies.topFanOut ?? []} metric="fanOut" />
      </Panel>
      <section className="table-panel full-width-panel">
        <div className="table-heading compact">
          <div>
            <p className="eyebrow">Dependencias</p>
            <h2>Candidatos a dividir</h2>
          </div>
          <GitBranch size={20} />
        </div>
        <DependencyTable files={dependencies.splitCandidates ?? []} />
      </section>
      <section className="table-panel full-width-panel">
        <div className="table-heading compact">
          <div>
            <p className="eyebrow">Ciclos</p>
            <h2>Posibles ciclos de imports</h2>
          </div>
          <AlertTriangle size={20} />
        </div>
        <CycleList cycles={dependencies.cycles ?? []} />
      </section>
    </section>
  );
}

function SnapshotsTab({
  gitVersions,
  onCompareSnapshots,
  onSaveSnapshot,
  setSnapshotBase,
  setSnapshotTarget,
  snapshotBase,
  snapshotComparison,
  snapshots,
  snapshotStatus,
  snapshotTarget
}) {
  const versionGroups = buildVersionGroups({ gitVersions, snapshots });

  return (
    <section className="table-panel">
      <div className="table-heading">
        <div>
          <p className="eyebrow">Antes vs despues</p>
          <h2>Comparar versiones</h2>
        </div>
        <div className="snapshot-actions">
          <button className="secondary-button" onClick={onSaveSnapshot} type="button">
            <ShieldCheck size={16} />
            <span>Guardar snapshot</span>
          </button>
          <select value={snapshotBase} onChange={(event) => setSnapshotBase(event.target.value)}>
            <option value="">Base</option>
            {versionGroups.map((group) => (
              <optgroup key={`base-${group.label}`} label={group.label}>
                {group.options.map((option) => (
                  <option key={`base-${option.value}`} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          <select value={snapshotTarget} onChange={(event) => setSnapshotTarget(event.target.value)}>
            <option value="">Actual</option>
            {versionGroups.map((group) => (
              <optgroup key={`target-${group.label}`} label={group.label}>
                {group.options.map((option) => (
                  <option key={`target-${option.value}`} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          <button className="primary-button compact-button" onClick={onCompareSnapshots} type="button">
            Comparar
          </button>
        </div>
      </div>
      <VersionSourceLine gitVersions={gitVersions} snapshots={snapshots} />
      {snapshotStatus ? <p className="status-line">{snapshotStatus}</p> : null}
      <SnapshotList snapshots={snapshots} />
      {snapshotComparison ? <SnapshotComparison comparison={snapshotComparison} /> : null}
    </section>
  );
}

function RecommendationsTab({ scan }) {
  return (
    <section className="workspace-grid">
      <Panel icon={<Sparkles size={18} />} title="Recomendaciones">
        <div className="recommendation-list">
          {(scan.recommendations ?? []).map((item) => (
            <article className={`recommendation ${item.severity}`} key={item.title}>
              <strong>{item.title}</strong>
              <span>{item.detail}</span>
            </article>
          ))}
        </div>
      </Panel>
      <Panel icon={<AlertTriangle size={18} />} title="Senales principales">
        <SignalList alerts={scan.couplingAlerts ?? []} />
      </Panel>
    </section>
  );
}

function DashboardActions({ onOpenMap, scan, secureMode }) {
  return (
    <section className="dashboard-actions">
      <div>
        <MapIcon size={19} />
        <div>
          <strong>Mapa visual del proyecto</strong>
          <span>{secureMode ? "Vista local metadata-only" : "Arbol de carpetas, archivos y riesgo"}</span>
        </div>
      </div>
      <button className="primary-button compact-button" disabled={!scan} onClick={onOpenMap} type="button">
        <MapIcon size={17} />
        <span>Ver mapa visual</span>
      </button>
    </section>
  );
}

function IgnoreSummary({ scan }) {
  const summary = scan.ignoreSummary ?? {};
  const examples = summary.ignoredExamples ?? [];

  return (
    <section className="ignore-summary">
      <div className="summary-stat">
        <ShieldCheck size={19} />
        <div>
          <strong>
            Ignorados: {formatNumber(summary.ignoredFolders ?? 0)} carpetas,{" "}
            {formatNumber(summary.ignoredFiles ?? 0)} archivos
          </strong>
          <span>
            {formatNumber(summary.activePatternCount ?? 0)} reglas activas -{" "}
            {scan.gitignoreLoaded ? ".gitignore cargado" : ".gitignore no cargado"}
          </span>
        </div>
      </div>

      {examples.length > 0 ? (
        <ul className="ignored-examples">
          {examples.slice(0, 8).map((item) => (
            <li key={`${item.type}-${item.path}`}>
              <span>{item.type === "folder" ? "carpeta" : "archivo"}</span>
              <strong title={item.path}>{item.path}</strong>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function VisualMapPage({ metric, onBack, scan, secureMode, setMetric }) {
  const [focusedId, setFocusedId] = useState("root");
  const [treeQuery, setTreeQuery] = useState("");
  const [expanded, setExpanded] = useState(true);
  const tree = useMemo(() => buildProjectTree(scan), [scan]);
  const searchMatches = useMemo(() => getSearchMatches(tree.nodes, treeQuery), [tree.nodes, treeQuery]);
  const focusedNode = tree.nodes.get(focusedId) ?? tree.root;
  const columns = useMemo(
    () => buildVisibleColumns(tree, focusedNode, metric, expanded, searchMatches),
    [expanded, focusedNode, metric, searchMatches, tree]
  );

  useEffect(() => {
    const topNode = getTopNode(tree.root, metric);
    setFocusedId(topNode?.id ?? "root");
  }, [metric, tree]);

  useEffect(() => {
    if (searchMatches.size > 0) {
      setFocusedId(searchMatches.values().next().value);
      setExpanded(true);
    }
  }, [searchMatches]);

  const handleExpandTree = () => {
    setExpanded(true);
    if (focusedNode.kind === "file" && focusedNode.parent) {
      setFocusedId(focusedNode.parent.id);
    }
  };

  const handleCollapseTree = () => {
    setFocusedId("root");
    setExpanded(false);
  };

  return (
    <main className="map-shell">
      <header className="map-topbar">
        <button className="back-button" onClick={onBack} type="button">
          <ArrowLeft size={18} />
          <span>Volver</span>
        </button>
        <div>
          <p className="eyebrow">Mapa visual</p>
          <h1>Project Lens</h1>
        </div>
        <MetricSegmentedControl metric={metric} setMetric={setMetric} />
      </header>

      {secureMode ? <MapSecureBanner /> : null}

      <section className="map-layout">
        <section className="project-map-card">
          <div className="map-card-heading">
            <h2>Estructura del proyecto</h2>
            <TreeLegend metric={metric} />
          </div>

          <ProjectTreeMap
            columns={columns}
            focusedId={focusedNode.id}
            metric={metric}
            onFocusNode={setFocusedId}
            query={treeQuery}
            searchMatches={searchMatches}
          />

          <div className="map-controls">
            <label className="tree-search">
              <Search size={16} />
              <input
                onChange={(event) => setTreeQuery(event.target.value)}
                placeholder="Buscar archivos o carpetas..."
                value={treeQuery}
              />
            </label>
            <button className="map-control-button" onClick={handleExpandTree} type="button">
              <Maximize2 size={15} />
              <span>Expandir todo</span>
            </button>
            <button className="map-control-button" onClick={handleCollapseTree} type="button">
              <Minimize2 size={15} />
              <span>Colapsar todo</span>
            </button>
            <div className="map-help">
              <Info size={15} />
              <span>Haz clic en un nodo para enfocarlo. El tamano representa la metrica seleccionada.</span>
            </div>
          </div>
        </section>

        <aside className="map-sidebar">
          <ReadingGuideCard metric={metric} />
          <FocusedNodeCard metric={metric} node={focusedNode} />
          <ProjectSummaryCard scan={scan} />
        </aside>
      </section>
    </main>
  );
}

function MapSecureBanner() {
  return (
    <section className="map-secure-banner">
      <div className="secure-icon">
        <ShieldCheck size={22} />
      </div>
      <div>
        <strong>Banco Seguro activo</strong>
        <span>El mapa usa solo metadatos del escaneo: rutas relativas, tamanos, lineas y fechas.</span>
      </div>
    </section>
  );
}

function MetricSegmentedControl({ metric, setMetric }) {
  return (
    <div className="metric-switch" aria-label="Metrica del mapa">
      {["lines", "bytes", "score"].map((item) => (
        <button
          className={metric === item ? "metric-option active" : "metric-option"}
          key={item}
          onClick={() => setMetric(item)}
          type="button"
        >
          {getMetricLabel(item)}
        </button>
      ))}
    </div>
  );
}

function TreeLegend({ metric }) {
  return (
    <div className="tree-legend">
      <span>Riesgo / Refactor Score</span>
      <span className="legend-dot low" />
      <span>Bajo</span>
      <span className="legend-dot medium" />
      <span>Medio</span>
      <span className="legend-dot high" />
      <span>Alto</span>
      <span>{`Tamano por ${getMetricDescription(metric)}`}</span>
    </div>
  );
}

function ProjectTreeMap({ columns, focusedId, metric, onFocusNode, query, searchMatches }) {
  return (
    <div className="project-tree">
      {columns.map((column, columnIndex) => (
        <div className="tree-column" key={column.id}>
          {column.nodes.map((node) => (
            <TreeNodeCard
              columnIndex={columnIndex}
              focused={node.id === focusedId}
              key={node.id}
              metric={metric}
              node={node}
              onFocusNode={onFocusNode}
              searchActive={Boolean(query.trim())}
              searchMatch={searchMatches.has(node.id)}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

function TreeNodeCard({ columnIndex, focused, metric, node, onFocusNode, searchActive, searchMatch }) {
  const metricPercent = getNodeMetricPercent(node, metric);
  const hidden = searchActive && !searchMatch && !node.searchRelated;

  return (
    <button
      className={[
        "tree-node-card",
        focused ? "focused" : "",
        node.kind === "file" ? "file-node" : "",
        node.kind === "more" ? "more-node" : "",
        hidden ? "dimmed" : ""
      ]
        .filter(Boolean)
        .join(" ")}
      onClick={() => {
        if (node.kind !== "more") {
          onFocusNode(node.id);
        }
      }}
      style={{ "--risk": getRiskColor(node.score), "--metric-width": `${metricPercent}%` }}
      type="button"
    >
      {columnIndex > 0 ? <span className="node-connector left" /> : null}
      {node.hasVisibleChildren ? <span className="node-connector right" /> : null}
      <span className="node-icon">{getNodeIcon(node)}</span>
      <span className="node-main">
        <strong title={node.path || node.name}>{node.name}</strong>
        <span>{getNodeSubtitle(node)}</span>
        <span className="node-metric-track">
          <span />
        </span>
      </span>
      <span className="node-value">{getMetricValue(node, metric)}</span>
    </button>
  );
}

function ReadingGuideCard({ metric }) {
  const content = {
    lines: {
      title: "Lineas",
      copy: "Area por lineas; color por refactor score. Verde es bajo, amarillo es medio, rojo es alto."
    },
    bytes: {
      title: "Tamano",
      copy: "El enfasis representa peso del archivo; color por refactor score para ubicar deuda estructural."
    },
    score: {
      title: "Score",
      copy: "El enfasis representa criticidad o prioridad de revision; color por refactor score."
    }
  }[metric];

  return (
    <section className="map-side-card">
      <div className="side-card-heading">
        <BookOpen size={22} />
        <h2>Lectura</h2>
        <Info size={17} />
      </div>
      <strong>{content.title}</strong>
      <p>{content.copy}</p>
    </section>
  );
}

function FocusedNodeCard({ metric, node }) {
  return (
    <section className="map-side-card focused-card">
      <div className="side-card-heading">
        <Target size={22} />
        <h2>Archivo enfocado</h2>
      </div>
      <div className="focused-title">
        {getNodeIcon(node)}
        <strong title={node.path || node.name}>{node.name}</strong>
      </div>
      <dl>
        <div>
          <dt>Lineas</dt>
          <dd>{formatNumber(node.lines)}</dd>
        </div>
        <div>
          <dt>Tamano</dt>
          <dd>{formatBytes(node.bytes)}</dd>
        </div>
        <div>
          <dt>Score</dt>
          <dd className="score-dd">
            <span className="score-mini-track">
              <span style={{ width: `${Math.min(node.score, 100)}%` }} />
            </span>
            <span>{node.score} / 100</span>
          </dd>
        </div>
        <div>
          <dt>{node.kind === "file" ? "Carpeta" : "Ruta"}</dt>
          <dd title={node.folder || node.path || "."}>{node.folder || node.path || "."}</dd>
        </div>
        <div>
          <dt>Metrica</dt>
          <dd>{getMetricValue(node, metric)}</dd>
        </div>
      </dl>
    </section>
  );
}

function ProjectSummaryCard({ scan }) {
  return (
    <section className="map-side-card">
      <div className="side-card-heading">
        <Folder size={22} />
        <h2>Proyecto</h2>
      </div>
      <div className="summary-stack">
        <span>
          <FileText size={17} />
          {formatNumber(scan.totals.files)} archivos
        </span>
        <span>
          <Code2 size={17} />
          {formatNumber(scan.totals.lines)} lineas
        </span>
        <span>
          <Database size={17} />
          {formatBytes(scan.totals.bytes)}
        </span>
        <span>
          <FolderTree size={17} />
          {formatNumber(scan.totals.folders)} carpetas
        </span>
      </div>
    </section>
  );
}

function EmptyState() {
  return (
    <section className="empty-state">
      <FileSearch size={34} />
      <h2>Esperando ruta local</h2>
      <p>Project Lens esta listo para escanear.</p>
    </section>
  );
}

function Metric({ icon, label, value }) {
  return (
    <article className="metric-card">
      <div className="metric-icon">{icon}</div>
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
      </div>
    </article>
  );
}

function Panel({ children, icon, title }) {
  return (
    <section className="panel">
      <div className="panel-heading">
        <div className="panel-title">
          {icon}
          <h2>{title}</h2>
        </div>
      </div>
      {children}
    </section>
  );
}

function HotspotList({ files }) {
  return (
    <div className="hotspot-list">
      {files.map((file) => (
        <article className="hotspot-item" key={file.relativePath}>
          <div className="score-pill">{file.refactorScore}</div>
          <div className="hotspot-main">
            <div className="row-between">
              <strong title={file.relativePath}>{file.relativePath}</strong>
              <span>{file.extension}</span>
            </div>
            <div className="score-track">
              <div style={{ width: `${file.refactorScore}%` }} />
            </div>
            <div className="muted-row">
              <span>{file.categoryLabel ?? "Sin categoria"}</span>
              <span>{formatNumber(file.lines)} lineas</span>
              <span>{formatBytes(file.bytes)}</span>
              <span>{formatNumber(file.codeMetrics?.imports ?? 0)} imports</span>
              <span>{formatNumber(file.signals?.length ?? 0)} senales</span>
              <span>prof. {file.depth}</span>
            </div>
          </div>
        </article>
      ))}
    </div>
  );
}

function ExtensionDistribution({ items }) {
  const maxFiles = Math.max(...items.map((item) => item.files), 1);

  return (
    <div className="bar-list">
      {items.slice(0, 14).map((item) => (
        <div className="bar-row" key={item.extension}>
          <div className="bar-label">
            <strong>{item.extension}</strong>
            <span>{formatNumber(item.files)} archivos</span>
          </div>
          <div className="bar-track">
            <div style={{ width: `${Math.max(4, (item.files / maxFiles) * 100)}%` }} />
          </div>
          <span className="bar-value">{formatNumber(item.lines)}</span>
        </div>
      ))}
    </div>
  );
}

function RankedList({ files, formatter = formatNumber, metric, metricLabel }) {
  return (
    <ol className="ranked-list">
      {files.map((file) => (
        <li key={file.relativePath}>
          <span title={file.relativePath}>{file.relativePath}</span>
          <strong>
            {formatter(file[metric])} {metric === "bytes" ? "" : metricLabel}
          </strong>
        </li>
      ))}
    </ol>
  );
}

function FolderList({ folders }) {
  return (
    <ol className="ranked-list">
      {folders.map((folder) => (
        <li key={folder.folder}>
          <span title={folder.folder}>{folder.folder}</span>
          <strong>{formatNumber(folder.lines)} lineas</strong>
        </li>
      ))}
    </ol>
  );
}

function FilesPanel({
  extensionFilter,
  extensionOptions,
  files,
  filter,
  selectedFile,
  selectedFilePath,
  setExtensionFilter,
  setFilter,
  setSelectedFilePath
}) {
  return (
    <section className="table-panel">
      <div className="table-heading">
        <div>
          <p className="eyebrow">Archivos</p>
          <h2>Tabla filtrable</h2>
        </div>
        <div className="filters">
          <label className="search-box">
            <Search size={16} />
            <input
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              placeholder="Filtrar por ruta, carpeta o extension"
            />
          </label>
          <select value={extensionFilter} onChange={(event) => setExtensionFilter(event.target.value)}>
            <option value="all">Todas</option>
            {extensionOptions.map((extension) => (
              <option key={extension} value={extension}>
                {extension}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="file-browser-grid">
        <FilesTable files={files} selectedFilePath={selectedFilePath} setSelectedFilePath={setSelectedFilePath} />
        <FileInsightPanel file={selectedFile} />
      </div>
    </section>
  );
}

function SignalList({ alerts }) {
  if (alerts.length === 0) {
    return <p className="empty-copy">Sin alertas fuertes con las reglas actuales.</p>;
  }

  return (
    <div className="signal-list">
      {alerts.slice(0, 12).map((alert) => (
        <article className={`signal-item ${alert.signal.severity}`} key={`${alert.path}-${alert.signal.code}`}>
          <strong title={alert.path}>{alert.path}</strong>
          <span>{alert.signal.label}</span>
          <em>{alert.refactorScore}/100</em>
        </article>
      ))}
    </div>
  );
}

function CategoryBreakdown({ items }) {
  const maxLines = Math.max(...items.map((item) => item.lines), 1);

  return (
    <div className="category-list">
      {items.map((item) => (
        <article className="category-row" key={item.category}>
          <div>
            <strong>{item.label}</strong>
            <span>
              {formatNumber(item.files)} archivos - {formatNumber(item.signals)} senales
            </span>
          </div>
          <div className="bar-track">
            <div style={{ width: `${Math.max(5, (item.lines / maxLines) * 100)}%` }} />
          </div>
          <strong>{formatNumber(item.lines)} lineas</strong>
        </article>
      ))}
    </div>
  );
}

function DependencyRank({ files, metric }) {
  const key = metric === "fanIn" ? "fanIn" : "fanOut";

  if (files.length === 0) {
    return <p className="empty-copy">No se detectaron dependencias internas relevantes.</p>;
  }

  return (
    <ol className="ranked-list">
      {files.slice(0, 12).map((file) => (
        <li key={`${key}-${file.relativePath}`}>
          <span title={file.relativePath}>{file.relativePath}</span>
          <strong>{formatNumber(file.codeMetrics?.[key] ?? 0)}</strong>
        </li>
      ))}
    </ol>
  );
}

function DependencyTable({ files }) {
  if (files.length === 0) {
    return <p className="empty-copy">Sin candidatos fuertes a dividir por dependencias.</p>;
  }

  return (
    <div className="table-wrap compact-table">
      <table>
        <thead>
          <tr>
            <th>Archivo</th>
            <th>Categoria</th>
            <th>Fan-in</th>
            <th>Fan-out</th>
            <th>Imports</th>
            <th>Score</th>
          </tr>
        </thead>
        <tbody>
          {files.map((file) => (
            <tr key={file.relativePath}>
              <td className="path-cell" title={file.relativePath}>
                {file.relativePath}
              </td>
              <td>{file.categoryLabel}</td>
              <td>{formatNumber(file.codeMetrics?.fanIn ?? 0)}</td>
              <td>{formatNumber(file.codeMetrics?.fanOut ?? 0)}</td>
              <td>{formatNumber(file.codeMetrics?.imports ?? 0)}</td>
              <td>{file.refactorScore}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CycleList({ cycles }) {
  if (cycles.length === 0) {
    return <p className="empty-copy">No se detectaron ciclos en el alcance analizado.</p>;
  }

  return (
    <ol className="cycle-list">
      {cycles.map((cycle) => (
        <li key={cycle.join(">")}>{cycle.join(" -> ")}</li>
      ))}
    </ol>
  );
}

function VersionSourceLine({ gitVersions, snapshots }) {
  if (gitVersions?.available) {
    return (
      <p className="version-source-line">
        Git {gitVersions.branch ?? "HEAD"} - {formatNumber(gitVersions.commits?.length ?? 0)} commits -{" "}
        {gitVersions.dirty ? "cambios locales" : "sin cambios locales"}
      </p>
    );
  }

  if (snapshots.length > 0) {
    return <p className="version-source-line">Git no detectado; usando snapshots y working tree actual.</p>;
  }

  return null;
}

function SnapshotList({ snapshots }) {
  if (snapshots.length === 0) {
    return <p className="empty-copy">Aun no hay snapshots guardados para esta ruta.</p>;
  }

  return (
    <div className="snapshot-list">
      {snapshots.slice(0, 8).map((snapshot) => (
        <article className="snapshot-card" key={snapshot.id}>
          <strong>{formatSnapshotName(snapshot)}</strong>
          <span>{snapshot.branch}</span>
          <em>
            {formatNumber(snapshot.totals.files)} archivos - {formatNumber(snapshot.totals.lines)} lineas - score{" "}
            {snapshot.averageScore}
          </em>
        </article>
      ))}
    </div>
  );
}

function SnapshotComparison({ comparison }) {
  return (
    <div className="snapshot-comparison">
      <p className="comparison-meta">
        {formatVersionSummary(comparison.base)} -&gt; {formatVersionSummary(comparison.target)}
      </p>
      <div className="comparison-kpis">
        <Metric icon={<FileCode2 size={18} />} label="Archivos" value={formatSigned(comparison.totalsDelta.files)} />
        <Metric icon={<BarChart3 size={18} />} label="Lineas" value={formatSigned(comparison.totalsDelta.lines)} />
        <Metric icon={<Database size={18} />} label="Tamano" value={formatBytesDelta(comparison.totalsDelta.bytes)} />
        <Metric icon={<Gauge size={18} />} label="Score prom." value={formatSigned(comparison.totalsDelta.averageScore)} />
      </div>
      <section className="workspace-grid">
        <Panel icon={<ShieldCheck size={18} />} title="Mejoraron">
          <ChangeList changes={comparison.improved ?? []} />
        </Panel>
        <Panel icon={<AlertTriangle size={18} />} title="Empeoraron">
          <ChangeList changes={comparison.worsened ?? []} />
        </Panel>
      </section>
    </div>
  );
}

function ChangeList({ changes }) {
  if (changes.length === 0) {
    return <p className="empty-copy">Sin cambios relevantes.</p>;
  }

  return (
    <ol className="ranked-list">
      {changes.slice(0, 12).map((change) => (
        <li key={`${change.status}-${change.relativePath}`}>
          <span title={change.relativePath}>{change.relativePath}</span>
          <strong>
            {formatSigned(change.linesDelta)} lineas / {formatSigned(change.scoreDelta)} score
          </strong>
        </li>
      ))}
    </ol>
  );
}

function FilesTable({ files, selectedFilePath, setSelectedFilePath }) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Ruta relativa</th>
            <th>Rol</th>
            <th>Extension</th>
            <th>Categoria</th>
            <th>Lineas</th>
            <th>Vacias</th>
            <th>Tamano</th>
            <th>Funcs</th>
            <th>Imports</th>
            <th>Fan-in/out</th>
            <th>Carpeta</th>
            <th>Modificado</th>
            <th>Score</th>
          </tr>
        </thead>
        <tbody>
          {files.map((file) => (
            <tr className={selectedFilePath === file.relativePath ? "selected-row" : ""} key={file.relativePath}>
              <td className="path-cell" title={file.relativePath}>
                <button className="file-link-button" onClick={() => setSelectedFilePath(file.relativePath)} type="button">
                  {file.relativePath}
                </button>
              </td>
              <td>
                <span className="role-chip">{file.fileInsights?.role ?? "Archivo"}</span>
              </td>
              <td>{file.extension}</td>
              <td>{file.categoryLabel ?? file.category}</td>
              <td>{formatNumber(file.lines)}</td>
              <td>{formatNumber(file.blankLines)}</td>
              <td>{formatBytes(file.bytes)}</td>
              <td>{formatNumber(file.codeMetrics?.functions ?? 0)}</td>
              <td>{formatNumber(file.codeMetrics?.imports ?? 0)}</td>
              <td>
                {formatNumber(file.codeMetrics?.fanIn ?? 0)}/{formatNumber(file.codeMetrics?.fanOut ?? 0)}
              </td>
              <td className="path-cell" title={file.parentFolder}>
                {file.parentFolder}
              </td>
              <td>{formatDate(file.modifiedAt)}</td>
              <td>
                <span className={file.refactorScore >= 70 ? "score danger" : "score"}>
                  {file.refactorScore}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function FileInsightPanel({ file }) {
  if (!file) {
    return (
      <aside className="file-detail-panel empty">
        <FileText size={22} />
        <strong>Selecciona un archivo</strong>
        <span>Veras una explicacion sencilla de su papel, conexiones y riesgo sin abrir contenido fuente.</span>
      </aside>
    );
  }

  const insight = file.fileInsights ?? {};

  return (
    <aside className="file-detail-panel">
      <div className="file-detail-heading">
        <div>
          <p className="eyebrow">Archivo explicado</p>
          <h3 title={file.relativePath}>{file.relativePath}</h3>
        </div>
        <span className="role-chip strong">{insight.role ?? "Archivo"}</span>
      </div>

      {insight.inferred ? <p className="inferred-note">Explicacion inferida con nombres, rutas, imports y metricas.</p> : null}

      <dl className="file-detail-list">
        <div>
          <dt>Que hace</dt>
          <dd>{insight.summary ?? "Aporta una pieza al proyecto."}</dd>
        </div>
        <div>
          <dt>Para que sirve</dt>
          <dd>{insight.purpose ?? "Ayuda a que una parte del sistema funcione."}</dd>
        </div>
        <div>
          <dt>Importancia</dt>
          <dd>{insight.importance ?? "Media"}</dd>
        </div>
        <div>
          <dt>Riesgo al tocarlo</dt>
          <dd>{insight.risk ?? "Revisa el flujo relacionado despues de cambiarlo."}</dd>
        </div>
      </dl>

      <div className="file-detail-section">
        <strong>Se conecta con</strong>
        <ConnectionList connections={insight.connectsWith ?? []} />
      </div>

      <div className="file-detail-section">
        <strong>Senales utiles</strong>
        <SignalChips signals={insight.signals ?? []} />
      </div>
    </aside>
  );
}

function ConnectionList({ connections }) {
  if (connections.length === 0) {
    return <span className="empty-inline">Sin conexiones internas detectadas.</span>;
  }

  return (
    <ul className="connection-list">
      {connections.map((connection) => (
        <li key={connection} title={connection}>
          {connection}
        </li>
      ))}
    </ul>
  );
}

function SignalChips({ signals }) {
  if (signals.length === 0) {
    return <span className="empty-inline">Sin senales fuertes.</span>;
  }

  return (
    <div className="signal-chip-list">
      {signals.map((signal) => (
        <span key={signal}>{signal}</span>
      ))}
    </div>
  );
}

function buildProjectTree(scan) {
  const rootName = getRootName(scan.root);
  const root = createTreeNode({
    id: "root",
    name: rootName,
    path: rootName,
    kind: "folder"
  });
  const nodes = new Map([["root", root]]);

  for (const file of scan.files) {
    const parts = file.relativePath.split("/");
    let parent = root;
    let folderPath = "";

    for (let index = 0; index < parts.length - 1; index += 1) {
      folderPath = folderPath ? `${folderPath}/${parts[index]}` : parts[index];
      const id = `folder:${folderPath}`;
      let folderNode = nodes.get(id);

      if (!folderNode) {
        folderNode = createTreeNode({
          id,
          name: parts[index],
          path: folderPath,
          kind: "folder",
          parent
        });
        nodes.set(id, folderNode);
        parent.children.push(folderNode);
      }

      parent = folderNode;
    }

    const fileNode = createTreeNode({
      id: `file:${file.relativePath}`,
      name: parts.at(-1),
      path: file.relativePath,
      kind: "file",
      parent,
      file
    });
    nodes.set(fileNode.id, fileNode);
    parent.children.push(fileNode);
  }

  aggregateTreeMetrics(root);

  return { root, nodes };
}

function createTreeNode({ file = null, id, kind, name, parent = null, path }) {
  return {
    blankLines: file?.blankLines ?? 0,
    bytes: file?.bytes ?? 0,
    children: [],
    extension: file?.extension ?? "",
    file,
    filesCount: file ? 1 : 0,
    folder: file?.parentFolder ?? "",
    id,
    kind,
    lines: file?.lines ?? 0,
    name,
    parent,
    path,
    score: file?.refactorScore ?? 0
  };
}

function aggregateTreeMetrics(node) {
  if (node.kind === "file") {
    return node;
  }

  let lines = 0;
  let bytes = 0;
  let filesCount = 0;
  let weightedScore = 0;

  for (const child of node.children) {
    const aggregate = aggregateTreeMetrics(child);
    lines += aggregate.lines;
    bytes += aggregate.bytes;
    filesCount += aggregate.filesCount;
    weightedScore += aggregate.score * Math.max(aggregate.filesCount, 1);
  }

  node.lines = lines;
  node.bytes = bytes;
  node.filesCount = filesCount;
  node.folder = node.path;
  node.score = filesCount > 0 ? Math.round(weightedScore / filesCount) : 0;

  return node;
}

function buildVisibleColumns(tree, focusedNode, metric, expanded, searchMatches) {
  const pathNodes = getPathNodes(focusedNode);
  const columns = [{ id: "level-root", nodes: [decorateVisibleNode(tree.root, true)] }];
  const maxDepth = expanded ? 4 : 1;

  for (let depth = 1; depth <= maxDepth; depth += 1) {
    const parent = pathNodes[depth - 1] ?? pathNodes.at(-1) ?? tree.root;
    const selectedChild = pathNodes[depth];
    const nodes = getDisplayChildren(parent, selectedChild, metric, searchMatches);

    if (nodes.length === 0) {
      break;
    }

    columns.push({ id: `level-${depth}-${parent.id}`, nodes });
  }

  return columns;
}

function getDisplayChildren(parent, selectedChild, metric, searchMatches) {
  const folders = parent.children.filter((child) => child.kind === "folder");
  const files = parent.children.filter((child) => child.kind === "file");
  const scored = [
    ...sortTreeNodes(folders, metric),
    ...sortTreeNodes(files, metric).slice(0, maxFilesPerFolder)
  ];
  const selected = selectedChild && parent.children.includes(selectedChild) ? [selectedChild] : [];
  const matching = parent.children.filter((child) => searchMatches.has(child.id));
  const combined = uniqueNodes([...selected, ...matching, ...scored]).slice(0, maxNodesPerColumn);
  const visibleIds = new Set(combined.map((node) => node.id));
  const hiddenChildren = parent.children.filter((node) => !visibleIds.has(node.id));
  const hiddenCount = hiddenChildren.length;
  const display = combined.map((node) => decorateVisibleNode(node, node.children.length > 0));

  if (hiddenCount > 0) {
    display.push(createMoreNode(parent, hiddenChildren));
  }

  return display;
}

function decorateVisibleNode(node, hasVisibleChildren) {
  return { ...node, hasVisibleChildren, searchRelated: true };
}

function createMoreNode(parent, hiddenChildren) {
  const count = hiddenChildren.length;
  const hiddenFiles = hiddenChildren.filter((node) => node.kind === "file").length;
  const hiddenFolders = count - hiddenFiles;
  const label = hiddenFolders === 0 ? "archivos mas" : hiddenFiles === 0 ? "carpetas mas" : "elementos mas";

  return {
    bytes: 0,
    children: [],
    filesCount: count,
    hasVisibleChildren: false,
    id: `more:${parent.id}`,
    kind: "more",
    lines: 0,
    name: `+ ${formatNumber(count)} ${label}`,
    path: parent.path,
    score: 0,
    searchRelated: true
  };
}

function getSearchMatches(nodes, query) {
  const normalized = query.trim().toLowerCase();
  const matches = new Set();

  if (!normalized) {
    return matches;
  }

  for (const node of nodes.values()) {
    if (node.kind === "more") {
      continue;
    }

    if (node.name.toLowerCase().includes(normalized) || node.path.toLowerCase().includes(normalized)) {
      getPathNodes(node).forEach((pathNode) => matches.add(pathNode.id));
    }
  }

  return matches;
}

function getPathNodes(node) {
  const nodes = [];
  let current = node;

  while (current) {
    nodes.unshift(current);
    current = current.parent;
  }

  return nodes;
}

function getTopNode(root, metric) {
  return sortTreeNodes(root.children, metric)[0] ?? root;
}

function sortTreeNodes(nodes, metric) {
  return [...nodes].sort((a, b) => getNodeMetric(b, metric) - getNodeMetric(a, metric));
}

function uniqueNodes(nodes) {
  const seen = new Set();
  const result = [];

  for (const node of nodes) {
    if (!node || seen.has(node.id)) {
      continue;
    }

    seen.add(node.id);
    result.push(node);
  }

  return result;
}

function getNodeMetric(node, metric) {
  if (metric === "bytes") {
    return node.bytes;
  }

  if (metric === "score") {
    return node.score;
  }

  return node.lines;
}

function getNodeMetricPercent(node, metric) {
  if (node.kind === "more") {
    return 18;
  }

  const value = getNodeMetric(node, metric);
  const limit = metric === "bytes" ? 400000 : metric === "score" ? 100 : 2000;

  return Math.max(16, Math.min(100, Math.round((value / limit) * 100)));
}

function getNodeSubtitle(node) {
  if (node.kind === "more") {
    return "agrupados para legibilidad";
  }

  if (node.kind === "file") {
    return `${formatNumber(node.lines)} lineas`;
  }

  return `${formatNumber(node.lines)} lineas - ${formatNumber(node.filesCount)} archivos`;
}

function getMetricValue(node, metric) {
  if (node.kind === "more") {
    return "";
  }

  if (metric === "bytes") {
    return formatBytes(node.bytes);
  }

  if (metric === "score") {
    return `${node.score}`;
  }

  return formatNumber(node.lines);
}

function getNodeIcon(node) {
  if (node.kind === "more") {
    return <Layers size={19} />;
  }

  if (node.kind === "folder") {
    return <Folder size={20} />;
  }

  if ([".js", ".jsx", ".ts", ".tsx", ".py", ".java", ".cs"].includes(node.extension)) {
    return <Code2 size={18} />;
  }

  return <FileText size={18} />;
}

function getRiskColor(score) {
  if (score >= 70) {
    return "#e36d58";
  }

  if (score >= 45) {
    return "#d99a14";
  }

  return "#2f9b8f";
}

function getMetricLabel(metric) {
  if (metric === "bytes") {
    return "Tamano";
  }

  if (metric === "score") {
    return "Score";
  }

  return "Lineas";
}

function getMetricDescription(metric) {
  if (metric === "bytes") {
    return "tamano de archivo";
  }

  if (metric === "score") {
    return "criticidad";
  }

  return "lineas de codigo";
}

function getRootName(rootPath) {
  return rootPath.split(/[\\/]/).filter(Boolean).at(-1) ?? "Proyecto";
}

function parsePatternText(value) {
  return value
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function mergePatternText(current, nextPatterns) {
  const merged = [...new Set([...parsePatternText(current), ...nextPatterns])];
  return merged.join("\n");
}

function buildQuickIgnoreSuggestions(scan, manualIgnorePatterns) {
  if (!scan) {
    return [];
  }

  const existingPatterns = new Set(manualIgnorePatterns);
  const suggestions = [];

  for (const folder of scan.foldersByLines) {
    const pattern = getGeneratedLikePattern(folder.folder);

    if (pattern && !existingPatterns.has(pattern) && !suggestions.includes(pattern)) {
      suggestions.push(pattern);
    }

    if (suggestions.length >= 6) {
      break;
    }
  }

  return suggestions;
}

function getGeneratedLikePattern(folder) {
  if (!folder || folder === ".") {
    return "";
  }

  const parts = folder.split("/");
  const index = parts.findIndex((part) => generatedFolderHints.includes(part.toLowerCase()));

  if (index < 0) {
    return "";
  }

  return `${parts.slice(0, index + 1).join("/")}/**`;
}

function loadInitialSettings() {
  const fallback = {
    disabledRules: [],
    includeOverridesText: "",
    manualIgnoreText: "",
    root: examplePath,
    secureMode: true,
    useGeneratedPreset: true,
    useGitignore: true
  };

  if (typeof window === "undefined") {
    return fallback;
  }

  try {
    const stored = JSON.parse(window.localStorage.getItem(storageKey) || "{}");

    return {
      disabledRules: Array.isArray(stored.disabledRules) ? stored.disabledRules : [],
      includeOverridesText: typeof stored.includeOverridesText === "string" ? stored.includeOverridesText : "",
      manualIgnoreText: typeof stored.manualIgnoreText === "string" ? stored.manualIgnoreText : "",
      root: typeof stored.root === "string" && stored.root.trim() ? stored.root : examplePath,
      secureMode: typeof stored.secureMode === "boolean" ? stored.secureMode : true,
      useGeneratedPreset:
        typeof stored.useGeneratedPreset === "boolean" ? stored.useGeneratedPreset : true,
      useGitignore: typeof stored.useGitignore === "boolean" ? stored.useGitignore : true
    };
  } catch {
    return fallback;
  }
}

function saveSettings(settings) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(storageKey, JSON.stringify(settings));
}

function formatNumber(value) {
  return new Intl.NumberFormat("es-CO").format(value);
}

function formatBytes(bytes) {
  if (bytes === 0) {
    return "0 B";
  }

  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** index;

  return `${value.toFixed(value >= 10 || index === 0 ? 0 : 1)} ${units[index]}`;
}

function formatDate(value) {
  return new Intl.DateTimeFormat("es-CO", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}

function formatSigned(value) {
  const formatted = formatNumber(Math.abs(value));
  return value > 0 ? `+${formatted}` : value < 0 ? `-${formatted}` : "0";
}

function formatBytesDelta(value) {
  const prefix = value > 0 ? "+" : value < 0 ? "-" : "";
  return `${prefix}${formatBytes(Math.abs(value))}`;
}

function formatSnapshotName(snapshot) {
  return new Intl.DateTimeFormat("es-CO", {
    dateStyle: "short",
    timeStyle: "short"
  }).format(new Date(snapshot.createdAt));
}

function buildVersionGroups({ gitVersions, snapshots }) {
  const groups = [
    {
      label: "Actual",
      options: [{ label: "Working tree actual", value: workingVersionValue }]
    }
  ];

  if (gitVersions?.available && gitVersions.commits?.length > 0) {
    groups.push({
      label: "Commits Git",
      options: gitVersions.commits.map((commit) => ({
        label: `${commit.shortId} - ${commit.message}`,
        value: encodeVersionValue("commit", commit.id)
      }))
    });
  }

  if (snapshots.length > 0) {
    groups.push({
      label: "Snapshots",
      options: snapshots.map((snapshot) => ({
        label: `${formatSnapshotName(snapshot)} - ${snapshot.branch}`,
        value: encodeVersionValue("snapshot", snapshot.id)
      }))
    });
  }

  return groups;
}

function getDefaultVersionSelection(snapshots, gitVersions) {
  const commits = gitVersions?.available ? gitVersions.commits ?? [] : [];

  if (commits.length > 0) {
    return {
      base: encodeVersionValue("commit", (commits[1] ?? commits[0]).id),
      target: workingVersionValue
    };
  }

  if (snapshots.length >= 2) {
    return {
      base: encodeVersionValue("snapshot", snapshots[1].id),
      target: encodeVersionValue("snapshot", snapshots[0].id)
    };
  }

  if (snapshots.length === 1) {
    return {
      base: encodeVersionValue("snapshot", snapshots[0].id),
      target: workingVersionValue
    };
  }

  return { base: "", target: workingVersionValue };
}

function encodeVersionValue(type, id) {
  return `${type}:${id}`;
}

function parseVersionValue(value) {
  const separatorIndex = value.indexOf(":");

  if (separatorIndex === -1) {
    return null;
  }

  return {
    type: value.slice(0, separatorIndex),
    id: value.slice(separatorIndex + 1)
  };
}

function formatVersionSummary(snapshot) {
  if (snapshot.source?.type === "commit") {
    return `${snapshot.source.shortId} - ${snapshot.source.label}`;
  }

  if (snapshot.source?.type === "working") {
    return snapshot.source.label;
  }

  return `Snapshot ${formatSnapshotName(snapshot)}`;
}

export default App;
