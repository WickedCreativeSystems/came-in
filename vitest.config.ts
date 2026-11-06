import path from "node:path";
import { generateKeyPairSync } from "node:crypto";
import { readFileSync } from "node:fs";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest(async () => {
      const migrations = await readD1Migrations(path.join(__dirname, "migrations"));
      // A throwaway VAPID pair for each test run; no key lives in the repo.
      const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
      const jwk = privateKey.export({ format: "jwk" });
      const vapidPublic = Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x!, "base64url"), Buffer.from(jwk.y!, "base64url")]).toString("base64url");
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
            VAPID_PUBLIC: vapidPublic,
            VAPID_PRIVATE: jwk.d!,
            VAPID_SUBJECT: "mailto:test@example.invalid",
            PUSH_TEST_HOSTS: "push.test",
          },
        },
      };
    }),
  ],
  // The app's stylesheet as text, for tests that check a CSS rule (Vite empties a `?raw` CSS import in the Workers pool).
  define: { __APP_CSS__: JSON.stringify(readFileSync(path.join(__dirname, "src/app/app.css"), "utf8")) },
  test: {
    include: ["tests/**/*.test.ts"],
    setupFiles: ["./tests/apply-migrations.ts"],
  },
});
