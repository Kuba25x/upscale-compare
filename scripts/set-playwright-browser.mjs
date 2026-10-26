import { chromium } from '@playwright/test';
import { appendFileSync } from 'node:fs';
const browserPath = chromium.executablePath();
if (process.env.GITHUB_ENV)
  appendFileSync(process.env.GITHUB_ENV, `CHROMIUM_PATH=${browserPath}\n`);
else console.log(browserPath);
