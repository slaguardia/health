import { writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { manifest } from "@brainbot/web-toolkit/pwa";
import { swSource } from "@brainbot/web-toolkit/vite-preset";

const publicDir = resolve("public");
mkdirSync(publicDir, { recursive: true });
writeFileSync(
  resolve(publicDir, "manifest.webmanifest"),
  JSON.stringify(manifest({ name: "health", short_name: "health", description: "Self-hosted personal health: food and bloodwork." }), null, 2),
);
// The toolkit SW with this app's own cache name, so its cache stays isolated.
writeFileSync(resolve(publicDir, "sw.js"), readFileSync(swSource, "utf8").replace('"app-shell-v1"', '"health-shell-v1"'));
console.log("[gen-pwa] manifest + sw.js written");
