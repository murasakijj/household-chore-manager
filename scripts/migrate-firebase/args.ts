const VALUE_OPTIONS = [
  "--app",
  "--email",
  "--old-service-account",
  "--new-service-account",
  "--collections",
] as const;
const FLAG_OPTIONS = ["--execute", "--overwrite"] as const;

export function parseArgs(argv: string[]) {
  const v: Record<string, string> = {};
  const flags = new Set<string>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if ((FLAG_OPTIONS as readonly string[]).includes(a)) flags.add(a);
    else if ((VALUE_OPTIONS as readonly string[]).includes(a)) {
      const val = argv[++i];
      if (val === undefined) throw new Error(`${a} requires a value`);
      v[a] = val;
    } else throw new Error(`Unknown argument: ${a}`);
  }
  return {
    v,
    execute: flags.has("--execute"),
    overwrite: flags.has("--overwrite"),
  };
}
