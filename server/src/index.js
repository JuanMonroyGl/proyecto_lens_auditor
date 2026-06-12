import cors from "cors";
import express from "express";
import { buildAiRecommendations } from "./geminiAdvisor.js";
import { compareVersionPair, getGitVersions } from "./gitVersions.js";
import { scanProject } from "./scanner.js";
import { loadProjectLensConfig, saveProjectLensConfig } from "./config.js";
import { compareSnapshotPair, listSnapshots, saveSnapshot } from "./snapshots.js";
import { loadServerEnv } from "./env.js";

loadServerEnv();

const app = express();
const port = Number(process.env.PORT || 3333);

app.use(cors());
app.use(express.json({ limit: "4mb" }));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "project-lens-server" });
});

app.get("/api/scan", async (req, res) => {
  const root = typeof req.query.root === "string" ? req.query.root.trim() : "";

  if (!root) {
    res.status(400).json({ error: "El parametro root es requerido." });
    return;
  }

  try {
    const scan = await scanProject(root, {
      useGitignore: parseBooleanQuery(req.query.useGitignore, true),
      useGeneratedPreset: parseBooleanQuery(req.query.useGeneratedPreset, true),
      manualIgnorePatterns: parsePatternQuery(req.query.ignore),
      includeOverrides: parsePatternQuery(req.query.include),
      disabledRules: parsePatternQuery(req.query.disabledRule)
    });
    res.json(scan);
  } catch (error) {
    res.status(400).json({
      error: error instanceof Error ? error.message : "No fue posible escanear la ruta."
    });
  }
});

app.get("/api/config", async (req, res) => {
  const root = typeof req.query.root === "string" ? req.query.root.trim() : "";

  if (!root) {
    res.status(400).json({ error: "El parametro root es requerido." });
    return;
  }

  try {
    res.json(await loadProjectLensConfig(root));
  } catch (error) {
    res.status(400).json({
      error: error instanceof Error ? error.message : "No fue posible leer la configuracion."
    });
  }
});

app.put("/api/config", async (req, res) => {
  const root = typeof req.query.root === "string" ? req.query.root.trim() : "";

  if (!root) {
    res.status(400).json({ error: "El parametro root es requerido." });
    return;
  }

  try {
    res.json(await saveProjectLensConfig(root, req.body));
  } catch (error) {
    res.status(400).json({
      error: error instanceof Error ? error.message : "No fue posible guardar la configuracion."
    });
  }
});

app.get("/api/snapshots", async (req, res) => {
  const root = typeof req.query.root === "string" ? req.query.root.trim() : "";

  if (!root) {
    res.status(400).json({ error: "El parametro root es requerido." });
    return;
  }

  try {
    res.json({ snapshots: await listSnapshots(root) });
  } catch (error) {
    res.status(400).json({
      error: error instanceof Error ? error.message : "No fue posible listar snapshots."
    });
  }
});

app.post("/api/snapshots", async (req, res) => {
  const root = typeof req.body?.root === "string" ? req.body.root.trim() : "";
  const scan = req.body?.scan;

  if (!root || !scan) {
    res.status(400).json({ error: "root y scan son requeridos." });
    return;
  }

  try {
    res.json({ snapshot: await saveSnapshot(root, scan) });
  } catch (error) {
    res.status(400).json({
      error: error instanceof Error ? error.message : "No fue posible guardar el snapshot."
    });
  }
});

app.get("/api/snapshots/compare", async (req, res) => {
  const root = typeof req.query.root === "string" ? req.query.root.trim() : "";
  const base = typeof req.query.base === "string" ? req.query.base.trim() : "";
  const target = typeof req.query.target === "string" ? req.query.target.trim() : "";

  if (!root || !base || !target) {
    res.status(400).json({ error: "root, base y target son requeridos." });
    return;
  }

  try {
    res.json({ comparison: await compareSnapshotPair(root, base, target) });
  } catch (error) {
    res.status(400).json({
      error: error instanceof Error ? error.message : "No fue posible comparar snapshots."
    });
  }
});

app.get("/api/git/versions", async (req, res) => {
  const root = typeof req.query.root === "string" ? req.query.root.trim() : "";
  const limit = typeof req.query.limit === "string" ? Number(req.query.limit) : undefined;

  if (!root) {
    res.status(400).json({ error: "El parametro root es requerido." });
    return;
  }

  try {
    res.json({ git: await getGitVersions(root, limit) });
  } catch (error) {
    res.status(400).json({
      error: error instanceof Error ? error.message : "No fue posible leer commits Git."
    });
  }
});

app.post("/api/versions/compare", async (req, res) => {
  const root = typeof req.body?.root === "string" ? req.body.root.trim() : "";
  const base = req.body?.base;
  const target = req.body?.target;

  if (!root || !base || !target) {
    res.status(400).json({ error: "root, base y target son requeridos." });
    return;
  }

  try {
    res.json({
      comparison: await compareVersionPair(root, base, target, {
        currentScan: req.body?.currentScan,
        scanOptions: req.body?.scanOptions
      })
    });
  } catch (error) {
    res.status(400).json({
      error: error instanceof Error ? error.message : "No fue posible comparar versiones."
    });
  }
});

app.post("/api/ai/recommendations", async (req, res) => {
  const scan = req.body?.scan;

  if (!scan || typeof scan !== "object") {
    res.status(400).json({ error: "scan es requerido." });
    return;
  }

  try {
    res.json({
      advice: await buildAiRecommendations({
        scan,
        targetArchitecture:
          typeof req.body?.targetArchitecture === "string" ? req.body.targetArchitecture.trim() : "",
        targetArchitectureId:
          typeof req.body?.targetArchitectureId === "string" ? req.body.targetArchitectureId.trim() : ""
      })
    });
  } catch (error) {
    res.status(502).json({
      error: error instanceof Error ? error.message : "No fue posible generar recomendaciones con IA."
    });
  }
});

function parseBooleanQuery(value, fallback) {
  if (typeof value !== "string") {
    return fallback;
  }

  if (["true", "1", "yes", "on"].includes(value.toLowerCase())) {
    return true;
  }

  if (["false", "0", "no", "off"].includes(value.toLowerCase())) {
    return false;
  }

  return fallback;
}

function parsePatternQuery(value) {
  const values = Array.isArray(value) ? value : [value];

  return values
    .filter((item) => typeof item === "string")
    .flatMap((item) => item.split(/\r?\n/))
    .map((item) => item.trim())
    .filter(Boolean);
}

app.listen(port, () => {
  console.log(`Project Lens API escuchando en http://localhost:${port}`);
});
