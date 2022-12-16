import { workspace, commands } from 'vscode';
import { useState, useEffect } from './utils/managed-disposable';

export type Json =
  | boolean
  | string
  | number
  | null
  | Json[]
  | { [prop: string]: Json };

interface DeferredPromise<T> {
  resolve: (value: T) => void;
  reject: (err: Error) => void;
  promise: Promise<T>;
}

export function createDeferredPromise<T>() {
  const deferred = {} as DeferredPromise<T>;
  deferred.promise = new Promise((resolve, reject) => {
    deferred.resolve = resolve;
    deferred.reject = reject;
  });
  return deferred;
}

export function useConfiguration(configuration: string) {
  const [, setState] = useState(0);

  useEffect(
    () =>
      workspace.onDidChangeConfiguration(({ affectsConfiguration }) => {
        if (affectsConfiguration(configuration)) {
          setState(last => last + 1);
        }
      }),
    [configuration]
  );

  return workspace.getConfiguration(configuration);
}

export async function tryRunCommand(command: string, ...args: unknown[]) {
  try {
    return await commands.executeCommand(command, ...args);
  } catch (err) {
    console.error(err);
    return null;
  }
}

const registeredCommands = new Map<
  string,
  { callback: () => void | undefined | Promise<void | undefined | unknown> }
>();

export function useRegisteredCommand(
  name: string,
  callback: () => void | undefined | Promise<void | undefined | unknown>
) {
  let command = registeredCommands.get(name);
  if (!command) {
    command = { callback };
    registeredCommands.set(name, command);
    commands.registerCommand(name, () => command!.callback());
  }
  command.callback = callback;
}
