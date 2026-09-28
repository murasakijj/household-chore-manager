import { describe, expect, it } from "vitest";
import { defaultWarningGrace } from "./choreDefaults";
// テストからのみ、サーバー側(正本)の実装をimportして食い違いがないことを検証する。
// アプリコード(このファイル以外のsrc配下)からは `api/` を import しない。
import { defaultWarningGrace as serverDefaultWarningGrace } from "../../api/_lib/domain/status";

describe("defaultWarningGrace parity with api/_lib/domain/status.ts", () => {
  it("matches the server implementation for intervalDays 1..400", () => {
    for (let intervalDays = 1; intervalDays <= 400; intervalDays++) {
      expect(defaultWarningGrace(intervalDays)).toEqual(
        serverDefaultWarningGrace(intervalDays),
      );
    }
  });
});
