import { copyFileSync, mkdirSync } from "node:fs";

// Bryntum is loaded from public/vendor at runtime so the bundler never compiles it.
mkdirSync("public/vendor", { recursive: true });
copyFileSync("node_modules/@bryntum/gantt/gantt.module.js", "public/vendor/bryntum-gantt.module.js");
