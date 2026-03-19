#!/usr/bin/env node
/**
 * Remove PNGs under e2e/*-snapshots that are not listed in the VRT manifest
 * (written during the last `yarn vrt` run). Safe to no-op when the manifest is empty.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.join(__dirname, '..');
const manifestDir =
  process.env.VRT_SNAPSHOT_MANIFEST_DIR ??
  path.join(pkgRoot, 'e2e', '.vrt-manifest');

const expected = new Set();
if (fs.existsSync(manifestDir)) {
  for (const name of fs.readdirSync(manifestDir)) {
    if (!name.startsWith('parallel-') || !name.endsWith('.txt')) continue;
    const text = fs.readFileSync(path.join(manifestDir, name), 'utf8');
    for (const line of text.split('\n')) {
      const t = line.trim();
      if (t) expected.add(t);
    }
  }
}

if (expected.size === 0) {
  console.log('No VRT snapshot manifest entries; skipping orphan prune.');
  process.exit(0);
}

const e2eRoot = path.join(pkgRoot, 'e2e');
let removed = 0;

function considerRemove(absPath) {
  const rel = path.relative(pkgRoot, absPath).split(path.sep).join('/');
  if (!expected.has(rel)) {
    fs.unlinkSync(absPath);
    console.log('Removed orphan snapshot:', rel);
    removed += 1;
  }
}

function walkPngUnderSnapshotDir(dir) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walkPngUnderSnapshotDir(p);
    else if (ent.name.endsWith('.png')) considerRemove(p);
  }
}

for (const ent of fs.readdirSync(e2eRoot, { withFileTypes: true })) {
  if (ent.isDirectory() && ent.name.endsWith('-snapshots')) {
    walkPngUnderSnapshotDir(path.join(e2eRoot, ent.name));
  }
}

console.log(
  `VRT orphan prune done (${removed} removed, ${expected.size} expected).`,
);
