import fs from "node:fs";
import path from "node:path";

export function loadServerEnv() {
  const envFiles = [path.resolve(process.cwd(), ".env"), path.resolve(process.cwd(), "server", ".env")];

  for (const envFile of envFiles) {
    if (!fs.existsSync(envFile)) {
      continue;
    }

    const content = fs.readFileSync(envFile, "utf8");

    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim();

      if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) {
        continue;
      }

      const [rawKey, ...rawValue] = trimmed.split("=");
      const key = rawKey.trim();

      if (!key || process.env[key]) {
        continue;
      }

      process.env[key] = cleanEnvValue(rawValue.join("=").trim());
    }
  }
}

function cleanEnvValue(value) {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  return value;
}
