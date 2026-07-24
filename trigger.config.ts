import { syncEnvVars } from "@trigger.dev/build/extensions/core";
import { defineConfig } from "@trigger.dev/sdk";

export default defineConfig({
  project: process.env.TRIGGER_PROJECT_REF ?? "proj_qisqlyzqmnemrkptuwuo",
  runtime: "node",
  logLevel: "log",
  maxDuration: 600,
  dirs: ["./trigger"],
  build: {
    // Push the Anthropic config into the deployed environment so cloud runs
    // authenticate with Claude. ANTHROPIC_API_KEY comes from the deploying
    // machine's env (e.g. --env-file .env.local or CI secrets).
    extensions: [
      syncEnvVars(() => {
        const vars: Record<string, string> = {
          TRINETRA_MODEL: process.env.TRINETRA_MODEL ?? "claude-sonnet-5",
        };
        if (process.env.ANTHROPIC_API_KEY) {
          vars.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
        }
        return vars;
      }),
    ],
  },
});
