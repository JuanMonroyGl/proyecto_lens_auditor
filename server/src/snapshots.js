import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const SNAPSHOT_DIRECTORY = ".project-lens";
const SNAPSHOT_SUBDIRECTORY = "snapshots";

export async function saveSnapshot(root, scan) {
  const branch = await getGitBranch(root);
  const snapshot = createSnapshot(scan, branch);
  const directory = getSnapshotDirectory(root);

  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(path.join(directory, `${snapshot.id}.json`), `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");

  return snapshot;
}

export async function listSnapshots(root) {
  const directory = getSnapshotDirectory(root);

  try {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    const snapshots = [];

    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) {
        continue;
      }

      try {
        const raw = await fs.readFile(path.join(directory, entry.name), "utf8");
        snapshots.push(JSON.parse(raw));
      } catch {
        // Ignore malformed snapshots; they should not block the local app.
      }
    }

    return snapshots.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return [];
    }

    throw error;
  }
}

export async function compareSnapshotPair(root, baseId, targetId) {
  const snapshots = await listSnapshots(root);
  const base = snapshots.find((snapshot) => snapshot.id === baseId);
  const target = snapshots.find((snapshot) => snapshot.id === targetId);

  if (!base || !target) {
    throw new Error("No se encontraron los snapshots solicitados.");
  }

  return compareSnapshots(base, target);
}

export function createSnapshotFromScan(scan, metadata = {}) {
  return createSnapshot(scan, metadata);
}

export function compareSnapshots(base, target) {
  const baseFiles = new Map(base.files.map((file) => [file.relativePath, file]));
  const targetFiles = new Map(target.files.map((file) => [file.relativePath, file]));
  const allPaths = new Set([...baseFiles.keys(), ...targetFiles.keys()]);
  const changes = [];

  for (const relativePath of allPaths) {
    const before = baseFiles.get(relativePath);
    const after = targetFiles.get(relativePath);

    if (!before && after) {
      changes.push({
        relativePath,
        status: "new",
        linesDelta: after.lines,
        scoreDelta: after.refactorScore,
        category: after.category
      });
      continue;
    }

    if (before && !after) {
      changes.push({
        relativePath,
        status: "deleted",
        linesDelta: -before.lines,
        scoreDelta: -before.refactorScore,
        category: before.category
      });
      continue;
    }

    if (before && after) {
      const linesDelta = after.lines - before.lines;
      const scoreDelta = after.refactorScore - before.refactorScore;

      if (linesDelta !== 0 || scoreDelta !== 0 || before.modifiedAt !== after.modifiedAt) {
        changes.push({
          relativePath,
          status: "modified",
          linesDelta,
          scoreDelta,
          category: after.category
        });
      }
    }
  }

  const improved = changes
    .filter((change) => change.scoreDelta < 0 || change.linesDelta < 0)
    .sort((a, b) => a.scoreDelta - b.scoreDelta)
    .slice(0, 20);
  const worsened = changes
    .filter((change) => change.scoreDelta > 0 || change.linesDelta > 0)
    .sort((a, b) => b.scoreDelta - a.scoreDelta)
    .slice(0, 20);

  return {
    base: summarizeSnapshot(base),
    target: summarizeSnapshot(target),
    totalsDelta: {
      files: target.totals.files - base.totals.files,
      lines: target.totals.lines - base.totals.lines,
      bytes: target.totals.bytes - base.totals.bytes,
      averageScore: target.averageScore - base.averageScore
    },
    changedFiles: changes.length,
    newFiles: changes.filter((change) => change.status === "new").length,
    deletedFiles: changes.filter((change) => change.status === "deleted").length,
    modifiedFiles: changes.filter((change) => change.status === "modified").length,
    improved,
    worsened,
    changes: changes.slice(0, 200)
  };
}

function createSnapshot(scan, metadata = {}) {
  const legacyBranch = typeof metadata === "string" ? metadata : null;
  const createdAt =
    !legacyBranch && typeof metadata.createdAt === "string" ? metadata.createdAt : new Date().toISOString();
  const id =
    !legacyBranch && typeof metadata.id === "string" ? metadata.id : createdAt.replace(/[:.]/g, "-");
  const branch =
    legacyBranch || (typeof metadata.branch === "string" && metadata.branch.trim()) || "sin branch";
  const files = scan.files.map((file) => ({
    relativePath: file.relativePath,
    extension: file.extension,
    category: file.category,
    lines: file.lines,
    bytes: file.bytes,
    modifiedAt: file.modifiedAt,
    refactorScore: file.refactorScore,
    structuralScore: file.structuralScore,
    fanIn: file.codeMetrics?.fanIn ?? 0,
    fanOut: file.codeMetrics?.fanOut ?? 0
  }));
  const averageScore =
    files.length > 0 ? Math.round(files.reduce((total, file) => total + file.refactorScore, 0) / files.length) : 0;

  return {
    id,
    createdAt,
    root: scan.root,
    branch,
    source: !legacyBranch && metadata.source ? metadata.source : { type: "snapshot" },
    totals: scan.totals,
    averageScore,
    byExtension: scan.byExtension,
    byCategory: scan.byCategory,
    topCritical: scan.refactorHotspots.slice(0, 20).map((file) => ({
      relativePath: file.relativePath,
      category: file.category,
      lines: file.lines,
      bytes: file.bytes,
      refactorScore: file.refactorScore
    })),
    files
  };
}

function summarizeSnapshot(snapshot) {
  return {
    id: snapshot.id,
    createdAt: snapshot.createdAt,
    branch: snapshot.branch,
    totals: snapshot.totals,
    averageScore: snapshot.averageScore
  };
}

async function getGitBranch(root) {
  try {
    const { stdout } = await execFileAsync("git", ["-C", root, "rev-parse", "--abbrev-ref", "HEAD"], {
      timeout: 2000,
      windowsHide: true
    });

    return stdout.trim() || "sin branch";
  } catch {
    return "git no disponible";
  }
}

function getSnapshotDirectory(root) {
  return path.join(root, SNAPSHOT_DIRECTORY, SNAPSHOT_SUBDIRECTORY);
}
