import { homedir } from "node:os";
import { join } from "node:path";

/** 先頭が `~`・`~/`・`~\\` ならホームディレクトリに展開する(シェルが展開しない環境向け)。 */
export function expandHome(p: string, home: string = homedir()): string {
  if (p === "~") return home;
  if (p.startsWith("~/") || p.startsWith("~\\")) {
    return join(home, p.slice(2));
  }
  return p;
}
