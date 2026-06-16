import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

const distDir = new URL("../dist/", import.meta.url).pathname;
const manifestPath = join(distDir, "manifest.webmanifest");
const files = existsSync(distDir) ? readdirSync(distDir) : [];
const hasServiceWorker = files.some((file) => file === "sw.js" || file.startsWith("workbox-"));

if (!existsSync(manifestPath)) {
  throw new Error("PWA manifest was not emitted");
}

if (!hasServiceWorker) {
  throw new Error("PWA service worker asset was not emitted");
}
