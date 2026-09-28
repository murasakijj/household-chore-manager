import type { Member, Repo } from "../repo/types.js";

export async function listMembers(
  repo: Repo,
  householdId: string,
): Promise<Member[]> {
  return repo.listMembers(householdId);
}
