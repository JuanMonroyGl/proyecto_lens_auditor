import fs from "node:fs/promises";
import path from "node:path";

export const PROJECT_LENS_CONFIG_FILE = ".project-lens.json";

export const DEFAULT_PROJECT_LENS_CONFIG = {
  exclude: [],
  includeOverrides: [],
  disabledRules: [],
  categories: {
    source: ["src/**", "app/**", "core/**", "lib/**", "server/src/**", "client/src/**", "web_scraping/**"],
    tests: ["tests/**", "test/**", "**/*.test.*", "**/*.spec.*", "**/test_*.py", "**/*_test.py"],
    artifacts: ["outputs/**", "inputs/**", "reports/**", "artifacts/**", "playwright-report/**", "test-results/**"],
    config: [
      ".gitignore",
      ".env*",
      "*.config.*",
      "*.json",
      "package.json",
      "pyproject.toml",
      "requirements*.txt",
      "tsconfig*.json",
      "vite.config.*"
    ],
    documentation: ["README*", "docs/**", "*.md", "*.rst", "*.txt"],
    dependencies_cache: ["node_modules/**", ".venv/**", "venv/**", "__pycache__/**", ".cache/**"]
  }
};

export async function loadProjectLensConfig(root) {
  const configPath = path.join(root, PROJECT_LENS_CONFIG_FILE);

  try {
    const raw = await fs.readFile(configPath, "utf8");
    const parsed = JSON.parse(raw);

    return {
      config: normalizeProjectLensConfig(parsed),
      loaded: true,
      path: PROJECT_LENS_CONFIG_FILE,
      errors: []
    };
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return {
        config: normalizeProjectLensConfig({}),
        loaded: false,
        path: PROJECT_LENS_CONFIG_FILE,
        errors: []
      };
    }

    return {
      config: normalizeProjectLensConfig({}),
      loaded: false,
      path: PROJECT_LENS_CONFIG_FILE,
      errors: [
        {
          path: PROJECT_LENS_CONFIG_FILE,
          message: error instanceof Error ? error.message : "No fue posible leer la configuracion."
        }
      ]
    };
  }
}

export async function saveProjectLensConfig(root, value) {
  const config = normalizeProjectLensConfig(value ?? {});
  const configPath = path.join(root, PROJECT_LENS_CONFIG_FILE);
  const content = `${JSON.stringify(config, null, 2)}\n`;

  await fs.writeFile(configPath, content, "utf8");

  return {
    config,
    path: PROJECT_LENS_CONFIG_FILE
  };
}

export function normalizeProjectLensConfig(value) {
  const input = value && typeof value === "object" ? value : {};
  const categories = input.categories && typeof input.categories === "object" ? input.categories : {};

  return {
    exclude: cleanPatterns(input.exclude),
    includeOverrides: cleanPatterns(input.includeOverrides),
    disabledRules: cleanPatterns(input.disabledRules),
    categories: normalizeCategories(categories)
  };
}

function normalizeCategories(categories) {
  const result = {};
  const keys = new Set([
    ...Object.keys(DEFAULT_PROJECT_LENS_CONFIG.categories),
    ...Object.keys(categories)
  ]);

  for (const key of keys) {
    const custom = cleanPatterns(categories[key]);
    const defaults = DEFAULT_PROJECT_LENS_CONFIG.categories[key] ?? [];
    result[key] = custom.length > 0 ? custom : defaults;
  }

  return result;
}

export function cleanPatterns(patterns) {
  if (!Array.isArray(patterns)) {
    return [];
  }

  return [...new Set(patterns.map((item) => String(item).trim()).filter(Boolean))];
}
