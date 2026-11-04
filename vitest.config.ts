import path from "node:path";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest(async () => {
      const migrations = await readD1Migrations(path.join(__dirname, "migrations"));
      return {
        wrangler: { configPath: "./wrangler.jsonc" },
        miniflare: {
          // Tests never reach Buffer: BUFFER_API_URL and BUFFER_AUTH_URL point at
          // hosts the tests answer themselves by mocking fetch.
          bindings: {
            TEST_MIGRATIONS: migrations,
            APP_ENV: "test",
            PUBLIC_ORIGIN: "https://came-in.test",
            BUFFER_API_URL: "https://buffer-api.test",
            BUFFER_AUTH_URL: "https://buffer-auth.test",
            BUFFER_CLIENT_ID: "test-client",
            BUFFER_CLIENT_SECRET: "test-secret",
            TOKEN_ENC_KEY: "dGVzdC10b2tlbi1lbmMta2V5LTMyLWJ5dGVzLWxvbmc",
            COOKIE_SECRET: "test-cookie-secret",
          },
        },
      };
    }),
  ],
  test: {
    include: ["tests/**/*.test.ts"],
    setupFiles: ["./tests/apply-migrations.ts"],
  },
});
