import { defineConfig } from "@trigger.dev/sdk";

export default defineConfig({
  project: process.env.TRIGGER_PROJECT_REF ?? "proj_qisqlyzqmnemrkptuwuo",
  runtime: "node",
  logLevel: "log",
  maxDuration: 600,
  dirs: ["./trigger"],
});
