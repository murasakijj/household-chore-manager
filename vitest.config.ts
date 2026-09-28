import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "api/**/*.test.ts"],
    // Firestoreエミュレータに実接続する結合テストは`npm test`に含めない
    // (別設定 vitest.emulator.config.ts / `npm run test:emulator` から実行する)。
    exclude: ["**/node_modules/**", "**/*.emulator.test.ts"],
  },
});
