#!/usr/bin/env node
import { main } from '../src/cli.js';
main().catch(error => { console.error(`\nCommitFlix: ${error.message}`); process.exitCode = 1; });
