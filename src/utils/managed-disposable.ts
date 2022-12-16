/**
 * an abridged implementation of the react function component API
 * for managing a list of disposables (as opposed to a tree of xml tags).
 *
 * Has:
 * - props/options
 * - useState
 * - useEffect
 *
 * Notably lacking:
 * - memoizing mounted disposables
 * - separation between virtual and real 'DOM'
 * - error boundaries
 * - refs (some utility replaced by extra useEffect functionality)
 */

/* eslint-disable @typescript-eslint/no-use-before-define */

import { Disposable } from 'vscode';
import { createHookTarget, HookTarget } from './hooks';
export {
  useState,
  useMemo,
  useEffect,
  createResource,
  useResource,
} from './hooks';

interface ManagedDisposable<Options extends {} = any> {
  (options: Options): ManagedDisposableResult;
}

type ManagedDisposableWithOptions<O = any> = [ManagedDisposable<O>, O];

export type ManagedDisposableNode =
  | ManagedDisposableWithOptions
  | ManagedDisposable<{}>
  | Disposable
  | null
  | undefined
  | false;

export type ManagedDisposableResult =
  | Record<string, ManagedDisposableNode>
  | ManagedDisposableNode[]
  | null
  | undefined
  | false;

interface MountedDisposable<O extends {} = any> extends HookTarget {
  depth: number;
  type: ManagedDisposable<O>;
  managedChildren: Map<string | number, MountedDisposable>;
  unmanagedChildren: Map<string | number, Disposable>;
  options: O;
}

function optionsDidUpdate(a: unknown, b: unknown) {
  if (!(a instanceof Object) || !(b instanceof Object)) {
    return a === b;
  }

  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);

  if (aKeys.length !== bKeys.length) {
    return true;
  }

  for (const key of aKeys) {
    if ((a as any)[key] !== (b as any)[key]) {
      return true;
    }
  }

  return false;
}

function reconcile<O extends {}>(
  disposable: MountedDisposable<O>,
  newOptions: O,
  handleError: (err: Error) => void
) {
  const { managedChildren, unmanagedChildren, type: render } = disposable;
  disposable.options = newOptions;
  const disposals: unknown[] = [];

  let rawNewChildren;
  try {
    rawNewChildren = render(disposable.options);
  } catch (err) {
    handleError(err as Error);
    rawNewChildren = undefined;
  }

  const removedManagedKeys = new Set(managedChildren.keys());
  const removedUnmanagedKeys = new Set(unmanagedChildren.keys());

  for (const [key, nextChild] of Object.entries(rawNewChildren || [])) {
    if (!nextChild) {
      continue;
    } else if (typeof nextChild === 'function' || Array.isArray(nextChild)) {
      const [type, options] =
        typeof nextChild === 'function' ? [nextChild, {}] : nextChild;

      removedManagedKeys.delete(key);
      const lastChild = managedChildren.get(key);

      if (lastChild && lastChild.type === type) {
        if (optionsDidUpdate(lastChild.options, options)) {
          lastChild.options = options;
          lastChild.refresh();
        }
        continue;
      }
      if (lastChild) {
        disposals.push(lastChild.dispose());
      }
      managedChildren.set(key, mount(type, options, disposable, handleError));
    } else {
      removedUnmanagedKeys.delete(key);
      const lastChild = unmanagedChildren.get(key);

      if (lastChild === nextChild) {
        continue;
      } else {
        if (lastChild) {
          disposals.push(lastChild.dispose());
        }
        unmanagedChildren.set(key, nextChild);
      }
    }
  }

  for (const key of removedManagedKeys) {
    disposals.push(managedChildren.get(key)!.dispose());
    managedChildren.delete(key);
  }

  for (const key of removedUnmanagedKeys) {
    disposals.push(unmanagedChildren.get(key)!.dispose());
    unmanagedChildren.delete(key);
  }

  return Promise.all(disposals);
}

function mount<O>(
  type: ManagedDisposable<O>,
  options: O,
  parent: undefined | MountedDisposable,
  handleError: (err: Error) => void
) {
  const mountedDisposable: MountedDisposable<O> = {
    depth: parent ? parent.depth + 1 : 0,
    type,
    managedChildren: new Map(),
    unmanagedChildren: new Map(),
    options,
    ...createHookTarget({
      handleError,
      execute() {
        reconcile(
          mountedDisposable,
          mountedDisposable.options,
          handleError
        ).catch(err => {
          if (!(err instanceof Error)) {
            handleError(
              new Error(
                `non error value found where error was expected: ${err}`
              )
            );
          } else {
            handleError(err);
          }
        });
      },
      async dispose() {
        await Promise.all([
          ...Array.from(mountedDisposable.managedChildren.values(), child =>
            child.dispose()
          ),
          ...Array.from(mountedDisposable.unmanagedChildren.values(), child =>
            child.dispose()
          ),
        ]);
      },
    }),
  };

  mountedDisposable.activate();

  return mountedDisposable;
}

/**
 * Maps to React.render
 */
export function mountManagedDisposable(
  managedDisposable: ManagedDisposable<{}>,
  handleError: (err: Error) => void
) {
  return new Disposable(
    mount(managedDisposable, {}, undefined, handleError).dispose
  );
}

/**
 * Maps to React.createElement
 */
export function createNode<O>(
  managedDisposable: ManagedDisposable<O>,
  options: O
): [ManagedDisposable<O>, O] {
  return [managedDisposable, options];
}
