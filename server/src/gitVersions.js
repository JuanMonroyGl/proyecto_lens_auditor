import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { scanProject } from "./scanner.js";
import { compareSnapshots, createSnapshotFromScan, listSnapshots } from "./snapshots.js";

const execFileAsync = promisify(execFile);
const FIELD_SEPARATOR = "\x1f";
const RECORD_SEPARATOR = "\x1e";
const DEFAULT_COMMIT_LIMIT = 30;

export async function getGitVersions(root, limit = DEFAULT_COMMIT_LIMIT) {
  const repository = await getGitRepository(root);

  if (!repository.available) {
    return repository;
  }

  const [branch, currentCommit, status, commits] = await Promise.all([
    getGitOutput(repository.topLevel, ["rev-parse", "--abbrev-ref", "HEAD"]).catch(() => "HEAD"),
    getGitOutput(repository.topLevel, ["rev-parse", "HEAD"]).catch(() => ""),
    getGitOutput(repository.topLevel, ["status", "--porcelain"]).catch(() => ""),
    getRecentCommits(repository.topLevel, limit).catch(() => [])
  ]);

  return {
    ...repository,
    branch: branch.trim() || "HEAD",
    currentCommit: currentCommit.trim(),
    dirty: status.trim().length > 0,
    commits
  };
}

export async function compareVersionPair(root, baseSource, targetSource, options = {}) {
  const base = await buildVersionSnapshot(root, baseSource, options);
  const target = await buildVersionSnapshot(root, targetSource, options);

  return compareSnapshots(base, target);
}

async function buildVersionSnapshot(root, source, options) {
  const normalized = normalizeSource(source);

  if (normalized.type === "snapshot") {
    const snapshots = await listSnapshots(root);
    const snapshot = snapshots.find((item) => item.id === normalized.id);

    if (!snapshot) {
      throw new Error("No se encontro el snapshot seleccionado.");
    }

    return snapshot;
  }

  if (normalized.type === "working") {
    if (options.currentScan && path.resolve(options.currentScan.root) === path.resolve(root)) {
      return createSnapshotFromScan(options.currentScan, {
        branch: "working tree",
        source: { type: "working", label: "Working tree actual" }
      });
    }

    const scan = await scanProject(root, options.scanOptions ?? {});
    return createSnapshotFromScan(scan, {
      branch: "working tree",
      source: { type: "working", label: "Working tree actual" }
    });
  }

  if (normalized.type === "commit") {
    return createSnapshotFromGitCommit(root, normalized.id, options.scanOptions ?? {});
  }

  throw new Error("Fuente de comparacion no soportada.");
}

async function createSnapshotFromGitCommit(root, commit, scanOptions) {
  const repository = await getGitRepository(root);

  if (!repository.available) {
    throw new Error("La ruta no pertenece a un repositorio Git.");
  }

  const commitSha = await resolveCommit(repository.topLevel, commit);
  const commitDetails = await getCommitDetails(repository.topLevel, commitSha);
  const tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "project-lens-git-"));
  const worktreePath = path.join(tempDirectory, "worktree");
  let worktreeAdded = false;

  try {
    await runGit(repository.topLevel, ["worktree", "add", "--detach", "--quiet", worktreePath, commitSha], {
      timeout: 60000
    });
    worktreeAdded = true;

    const scanRoot = repository.relativeRoot === "." ? worktreePath : path.join(worktreePath, repository.relativeRoot);
    const scanRootStats = await fs.stat(scanRoot).catch(() => null);

    if (!scanRootStats?.isDirectory()) {
      throw new Error("La ruta escaneada no existe en el commit seleccionado.");
    }

    const scan = await scanProject(scanRoot, scanOptions);

    return createSnapshotFromScan(scan, {
      branch: commitDetails.shortId,
      createdAt: commitDetails.date,
      id: `commit-${commitDetails.shortId}`,
      source: {
        type: "commit",
        id: commitDetails.id,
        shortId: commitDetails.shortId,
        label: commitDetails.message
      }
    });
  } finally {
    if (worktreeAdded) {
      await runGit(repository.topLevel, ["worktree", "remove", "--force", worktreePath], { timeout: 30000 }).catch(
        () => {}
      );
      await runGit(repository.topLevel, ["worktree", "prune"], { timeout: 30000 }).catch(() => {});
    }

    await fs.rm(tempDirectory, { force: true, recursive: true }).catch(() => {});
  }
}

async function getGitRepository(rootInput) {
  const root = path.resolve(rootInput);

  try {
    const topLevelRaw = await getGitOutput(root, ["rev-parse", "--show-toplevel"]);
    const topLevel = path.resolve(topLevelRaw.trim());
    const relativeRoot = normalizeRelativePath(path.relative(topLevel, root)) || ".";

    if (relativeRoot.startsWith("..") || path.isAbsolute(relativeRoot)) {
      return {
        available: false,
        commits: [],
        reason: "La ruta no esta dentro del repositorio Git."
      };
    }

    return {
      available: true,
      commits: [],
      relativeRoot,
      topLevel
    };
  } catch {
    return {
      available: false,
      commits: [],
      reason: "No se detecto repositorio Git para esta ruta."
    };
  }
}

async function getRecentCommits(root, limit) {
  const count = Math.max(1, Math.min(Number(limit) || DEFAULT_COMMIT_LIMIT, 100));
  const format = `%H%x1f%h%x1f%cI%x1f%an%x1f%s%x1e`;
  const output = await getGitOutput(root, ["log", `-${count}`, `--pretty=format:${format}`], {
    maxBuffer: 1024 * 1024 * 4
  });

  return output
    .split(RECORD_SEPARATOR)
    .map((record) => record.trim())
    .filter(Boolean)
    .map(parseCommitRecord)
    .filter(Boolean);
}

async function getCommitDetails(root, commit) {
  const format = `%H%x1f%h%x1f%cI%x1f%an%x1f%s`;
  const output = await getGitOutput(root, ["show", "-s", `--pretty=format:${format}`, commit]);
  const parsed = parseCommitRecord(output.trim());

  if (!parsed) {
    throw new Error("No fue posible leer el commit seleccionado.");
  }

  return parsed;
}

async function resolveCommit(root, commit) {
  const output = await getGitOutput(root, ["rev-parse", "--verify", `${commit}^{commit}`]);
  return output.trim();
}

function parseCommitRecord(record) {
  const [id, shortId, date, author, ...messageParts] = record.split(FIELD_SEPARATOR);

  if (!id || !shortId) {
    return null;
  }

  return {
    id,
    shortId,
    date,
    author,
    message: messageParts.join(FIELD_SEPARATOR) || "(sin mensaje)"
  };
}

function normalizeSource(source) {
  if (!source || typeof source !== "object") {
    throw new Error("Fuente de comparacion invalida.");
  }

  const type = typeof source.type === "string" ? source.type : "";
  const id = typeof source.id === "string" ? source.id.trim() : "";

  if (type === "working") {
    return { type, id: id || "current" };
  }

  if ((type === "snapshot" || type === "commit") && id) {
    return { type, id };
  }

  throw new Error("Fuente de comparacion invalida.");
}

async function getGitOutput(root, args, options = {}) {
  const { stdout } = await runGit(root, args, options);
  return stdout;
}

function runGit(root, args, options = {}) {
  return execFileAsync("git", ["-C", root, ...args], {
    maxBuffer: options.maxBuffer ?? 1024 * 1024,
    timeout: options.timeout ?? 5000,
    windowsHide: true
  });
}

function normalizeRelativePath(value) {
  return value.split(path.sep).join("/");
}
