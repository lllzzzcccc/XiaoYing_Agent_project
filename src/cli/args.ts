export interface CliOptions {
  input: string;
  offline: boolean;
  faults?: string;
  runtimeDir: string;
  resume: boolean;
}

export function parseCliArgs(argv: string[]): CliOptions {
  let input: string | undefined;
  let faults: string | undefined;
  let runtimeDir = ".runtime";
  let offline = false;
  let resume = false;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]!;
    if (argument === "--offline") offline = true;
    else if (argument === "--resume") resume = true;
    else if (argument === "--input") input = argv[++index];
    else if (argument === "--faults") faults = argv[++index];
    else if (argument === "--runtime-dir") runtimeDir = argv[++index]!;
    else throw new Error(`未知参数: ${argument}`);
    if ((argument === "--input" || argument === "--faults" || argument === "--runtime-dir") && !argv[index]) {
      throw new Error(`${argument} 缺少值`);
    }
  }
  if (!input) throw new Error("必须提供 --input <path>");
  return { input, offline, ...(faults ? { faults } : {}), runtimeDir, resume };
}
