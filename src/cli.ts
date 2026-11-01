#!/usr/bin/env node
import { runCli } from "./cli/run.js";

const outcome = await runCli(process.argv.slice(2));
process.stdout.write(`${JSON.stringify(outcome.result, null, 2)}\n`);
process.exitCode = outcome.exitCode;
