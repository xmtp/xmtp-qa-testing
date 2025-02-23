import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,

    reporters: ["html", "default"],

    environment: "node", // Use a more verbose reporter to log detailed output
    watch: false, // Disable automatic test runs on file changes
    // Add server configuration
    api: {
      host: "0.0.0.0", // Bind to all interfaces
      port: 51204, // Use Railway's assigned port or default
    
    },
  },
});
