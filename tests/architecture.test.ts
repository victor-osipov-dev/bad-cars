import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const srcRoot = join(projectRoot, 'src');

function listSourceFiles(directory: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...listSourceFiles(path));
    } else if (entry.isFile() && entry.name.endsWith('.ts')) {
      files.push(path);
    }
  }
  return files;
}

function readFilesIn(directories: readonly string[]): { path: string; source: string }[] {
  return directories.flatMap((directory) =>
    listSourceFiles(join(srcRoot, directory)).map((path) => ({
      path,
      source: readFileSync(path, 'utf8'),
    })),
  );
}

const simAndCoreFiles = readFilesIn(['core', 'sim']);

describe('architecture boundaries', () => {
  it('keeps simulation and core free of Babylon.js imports', () => {
    const offenders = simAndCoreFiles.filter(({ source }) => source.includes('@babylonjs/'));
    // Test files may import nothing render-related, but keep the assertion strict.
    expect(offenders.map(({ path }) => path)).toEqual([]);
  });

  it('keeps simulation and core free of render/ui/platform/app imports', () => {
    const forbidden = /from\s+['"][^'"]*\/(render|ui|platform|app)\//;
    const offenders = simAndCoreFiles.filter(({ source }) => forbidden.test(source));
    expect(offenders.map(({ path }) => path)).toEqual([]);
  });

  it('keeps simulation and core free of ambient browser globals', () => {
    const forbidden = /\b(document|window|localStorage|indexedDB)\s*\./;
    const offenders = simAndCoreFiles
      .filter(({ path }) => !path.includes('.test.'))
      .filter(({ source }) => forbidden.test(source));
    expect(offenders.map(({ path }) => path)).toEqual([]);
  });

  it('forbids Math.random and wall-clock time in simulation and core', () => {
    const forbidden = /Math\.random\s*\(|Date\.now\s*\(|performance\.now\s*\(/;
    const offenders = simAndCoreFiles
      .filter(({ path }) => !path.includes('.test.'))
      .filter(({ source }) => forbidden.test(source));
    expect(offenders.map(({ path }) => path)).toEqual([]);
  });

  it('has no empty source directories left behind', () => {
    const expected = ['app', 'core', 'data', 'render', 'sim', 'ui'];
    const present = readdirSync(srcRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    expect(present).toEqual(expected);
  });
});
