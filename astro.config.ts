import node from "@astrojs/node";
import { defineConfig } from "astro/config";

// Server-rendered output: the Dockerfile builds this and runs the emitted
// Node server directly, matching fly.toml's fixed port and single machine.
export default defineConfig({
  output: "server",
  adapter: node({ mode: "standalone" }),
  security: {
    // Fly's proxy terminates TLS, so naming the deploy domain is what lets
    // Astro trust x-forwarded-proto and accept same-origin form POSTs.
    allowedDomains: [{ hostname: "**.fly.dev", protocol: "https" }],
  },
});
