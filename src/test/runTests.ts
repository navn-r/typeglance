import * as path from 'path';
import * as fs from 'fs';

import { exampleFixtureFiles } from './example-suite/fixture-files';
import { runTests } from '@vscode/test-electron';
import { FileTree } from './fixture-utils';

const vscodeTestDirectory = path.resolve(__dirname, '../../.vscode-test');

const workspaceSettings: FileTree = {
  '.vscode': {
    'settings.json': JSON.stringify({}, null, 2),
  },
};

function writeFileTree(pathRoot: string, files: FileTree) {
  const pathSegments = Object.keys(files);

  if (pathSegments.length === 0) {
    return;
  }

  fs.mkdirSync(pathRoot, { recursive: true });

  for (const pathSegment of Object.keys(files)) {
    const fullPath = path.join(pathRoot, pathSegment);

    const contents = files[pathSegment]!;

    if (typeof contents === 'string') {
      fs.writeFileSync(fullPath, contents);
    }

    if (contents instanceof Object) {
      writeFileTree(fullPath, contents);
    }
  }
}

export async function runSuiteInFixture(
  suiteName: string,
  absoluteSuitePath: string,
  fixtureFiles: FileTree = {},
  attempts = 1
) {
  if (attempts < 1) {
    throw new Error('must make at least one attempt');
  }

  let remainingAttempts = attempts;
  const fixtureDir = path.join(vscodeTestDirectory, 'fixtures', suiteName);
  let result;
  while (remainingAttempts--) {
    try {
      fs.rmdirSync(fixtureDir, { recursive: true });
    } catch (err: any) {
      if (err.code !== 'ENOENT') {
        throw err;
      }
    }
    writeFileTree(fixtureDir, { ...fixtureFiles, ...workspaceSettings });
    try {
      return await runTests({
        version: 'insiders',
        extensionDevelopmentPath: path.join(__dirname, '../..'),
        extensionTestsPath: path.join(__dirname, './suite-runner.js'),
        launchArgs: [fixtureDir, '--disable-extensions'],
        extensionTestsEnv: {
          BPM_CONFIG: process.env.BPM_CONFIG,
          HS_TEST_SUITE_PATH: absoluteSuitePath,
        },
      });
    } catch (err) {
      result = err;
    }
  }
  throw result;
}

async function main() {
  // This test suite is here only to serve as example boilerplate for new tests
  await runSuiteInFixture(
    'example-suite',
    path.join(__dirname, './example-suite'),
    exampleFixtureFiles
  );
}

main().catch(err => {
  setImmediate(() => {
    throw err;
  });
});
