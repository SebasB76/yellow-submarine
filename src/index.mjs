#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { parseArgs } from 'node:util';
import { collectAccount, developSubmarine } from './collect.mjs';
import { encodeGif } from './draw.mjs';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    output: { type: 'string', default: 'submarine/submarine.gif' },
    scale: { type: 'string', default: '4' },
    date: { type: 'string' },
    'utc-offset': { type: 'string', default: '-5' },
    // Overrides let you preview any state without waiting for the activity to happen.
    stage: { type: 'string' },
    stripes: { type: 'string' },
    activity: { type: 'string' },
    ambient: { type: 'string' },
    keepsakes: { type: 'string' },
  },
});

const login = positionals[0] ?? process.env.GITHUB_REPOSITORY_OWNER;
if (!login) {
  console.error('usage: yellow-submarine <login> [--output path] [--scale n] [--date YYYY-MM-DD]');
  process.exit(2);
}

const token = process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN ?? execFileSync('gh', ['auth', 'token'], { encoding: 'utf8' }).trim();

// A nightly run judges the UTC day that just ended.
const observedOn = values.date
  ? new Date(`${values.date}T00:00:00Z`)
  : new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate() - 1));

const account = await collectAccount(login, token);
const submarine = developSubmarine(account, observedOn, Number(values['utc-offset']));
if (values.stage) submarine.stage = Number(values.stage);
if (values.stripes) submarine.stripes = Number(values.stripes);
if (values.activity) submarine.activity = Number(values.activity);
if (values.ambient) submarine.ambient = values.ambient;
if (values.keepsakes) submarine.keepsakes = Number(values.keepsakes);

mkdirSync(dirname(values.output), { recursive: true });
writeFileSync(values.output, encodeGif(submarine, Number(values.scale)));
console.log(JSON.stringify({ output: values.output, ...submarine }, null, 2));
