/** 対象リソースが存在しない、または別家庭のもの。ルート層で404/400に変換する。 */
export class RepoNotFoundError extends Error {
  resource: string;
  constructor(resource: string) {
    super(`${resource}_not_found`);
    this.resource = resource;
  }
}

/** 二重取消・clientRequestId の衝突など、状態競合。ルート層で409に変換する。 */
export class RepoConflictError extends Error {
  code: string;
  constructor(code: string) {
    super(code);
    this.code = code;
  }
}

/** 存在しないカーソルなど、クエリパラメータ自体が不正。ルート層で400 invalid_queryに変換する。 */
export class RepoInvalidQueryError extends Error {
  field: string;
  constructor(field: string) {
    super(`invalid_query:${field}`);
    this.field = field;
  }
}
