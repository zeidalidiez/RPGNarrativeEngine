#!/usr/bin/env node

import { formatCliError, runCli } from './index.js';

try {
  process.exitCode = await runCli(process.argv.slice(2));
} catch (error) {
  console.error(formatCliError(error));
  process.exitCode = 1;
}
