/** 対象リソースが存在しない、または別家庭のもの。ルート層で404/400に変換する。 */
export class RepoNotFoundError extends Error {
  resource: string;
  constructor(resource: string) {
    super(`${resource}_not_found`);
    this.resource = resource;
  }
}

/** 二重取消など、状態競合。ルート層で409に変換する。 */
export class RepoConflictError extends Error {
  code: string;
  constructor(code: string) {
    super(code);
    this.code = code;
  }
}
