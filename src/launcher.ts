import { ExtensionContext } from 'vscode';

// @ts-expect-error untyped module
import { install as installSourceMapSupport } from 'source-map-support';
try {
  // stack traces in the electron dev tools will support source maps in this process
  installSourceMapSupport();
} catch (err) {
  console.log('failed in install source map support');
  console.log(err);
}

import { mountManagedDisposable } from './utils/managed-disposable';
import { TypeScriptCoverageDecorations } from './typescript-coverage';

function Runtime() {
  return mountManagedDisposable(
    () => [TypeScriptCoverageDecorations],
    err => {
      console.error(err);
    }
  );
}

// this method is called when your extension is activated
export function activate(context: ExtensionContext) {
  const disposable = Runtime();

  context.subscriptions.push({
    dispose() {
      disposable.dispose();
    },
  });
}

// this method is called when your extension is deactivated
export function deactivate() {}

// if (!inProduction) {
// unhandled promise rejections often come from @builtin extensions
// that are difficult to systematically disable while testing our extension.
// this is intended to make it easier to determine when an unhandled rejection
// is an issue in our extension during testing.
class SmartPromise<T> extends Promise<T> {
  constructor(...[executor]: ConstructorParameters<PromiseConstructor>) {
    super((resolve, reject) =>
      executor(resolve as any, rejectReason => {
        if (!rejectReason || !(rejectReason instanceof Error)) {
          const errorMsg = `Promise unexpectedly rejected with non-error value: ${rejectReason}`;
          reject(new Error(errorMsg));
        } else {
          reject(rejectReason);
        }
      })
    );
  }
}

global.Promise = SmartPromise as PromiseConstructor;
// }
