import { defineConfig } from "vitest/config";

// Firestore エミュレータに実接続する結合テスト専用の設定。
// `npm test`(vitest.config.ts)には含めない。`npm run test:emulator` から
// `firebase emulators:exec` 経由で実行する(FIRESTORE_EMULATOR_HOST が必要)。
export default defineConfig({
  test: {
    environment: "node",
    testTimeout: 60_000,
    hookTimeout: 60_000,
    include: [
      "api/**/*.emulator.test.ts",
      "firebase/**/*.emulator.test.ts",
      "scripts/**/*.emulator.test.ts",
    ],
  },
});
