import { defineConfig } from "vitest/config";
import path from "path";
import dotenv from "dotenv";

const testEnv = dotenv.config({
  path: path.resolve(__dirname, ".env.test"),
  override: true,
}).parsed;

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    env: {
      ...testEnv,
      NODE_ENV: "test",
    },
  },
});
