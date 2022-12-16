import * as fs from 'fs';
import * as path from 'path';
import test from 'tape';

function* filesInDirectory(absPath: string): IterableIterator<string> {
  let stat;
  try {
    stat = fs.statSync(absPath);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw err;
    }
  }
  if (!stat) {
    return;
  } else if (stat.isFile()) {
    yield absPath;
  } else if (stat.isDirectory()) {
    for (const childPath of fs.readdirSync(absPath)) {
      if (childPath === 'node_modules' || childPath === '.git') {
        continue;
      }
      yield* filesInDirectory(path.join(absPath, childPath));
    }
  }
}

export function testsSettled(absoluteSuiteDirectory: string) {
  let files = 0;
  for (const file of filesInDirectory(absoluteSuiteDirectory)) {
    if (file.endsWith('.test.js')) {
      files += 1;
      require(file);
    }
  }

  if (!files) {
    throw new Error('No test suites found. Tests may be misconfigured');
  }

  return new Promise((resolve, reject) => {
    let failure = false;
    test.onFailure(() => {
      failure = true;
    });

    test.onFinish(() => {
      if (failure) {
        reject(new Error('Failed Test'));
      } else {
        resolve(undefined);
      }
    });
  });
}

export function run() {
  const suitePath = process.env.HS_TEST_SUITE_PATH;
  if (!suitePath) {
    return Promise.reject(new Error('HS_TEST_SUITE_PATH not configured'));
  }
  return testsSettled(suitePath);
}
