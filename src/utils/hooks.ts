/**
 * an abridged implementation of the react hooks API
 * used by function components. This implementation
 * is (nearly) "renderer agnostic" and can be consumed
 * by custom consumers created with `createHookTarget`.
 */

import { Disposable } from 'vscode';

export type EffectResult =
  | void
  | Effect
  | Disposable
  | Promise<void | Effect | Disposable>;

interface Effect {
  (): EffectResult;
}

interface MemoryCell<T extends { dispose: EffectResult }> {
  type: string;
  target: HookTarget;
  ref: undefined | T;
}

export interface HookTarget {
  depth?: number;
  handleError: (err: Error) => unknown;
  activate: () => void;
  refresh: () => void;
  dispose: () => Promise<unknown>;
  memoryCells: MemoryCell<any>[];
}

type HookStateStack = null | {
  index: number;
  target: HookTarget;
  next: HookStateStack;
};

interface Resource<T> {
  consume(node: HookTarget): T;
  removeConsumer(node: HookTarget): Promise<void>;
}

function noop() {}

let hookState: HookStateStack = null;

function pushHookTarget(target: HookTarget) {
  hookState = {
    target,
    index: 0,
    next: hookState,
  };
}

function popHookTarget(target: HookTarget) {
  if (!hookState) {
    throw new Error('could not pop hook target from empty stack');
  }
  if (!hookState || hookState.target !== target) {
    throw new Error('popped hook target does not match current hook state');
  }
  hookState = hookState.next;
}

function getHookTarget(): HookTarget {
  if (!hookState) {
    throw new Error('No active hook target found');
  }
  return hookState.target;
}

function getMemoryCell<Ref>(type: string) {
  if (!hookState) {
    throw new Error('No active hook target found');
  }
  let cell: MemoryCell<Ref & { dispose: () => void }> =
    hookState.target.memoryCells[hookState.index++];
  if (!cell) {
    cell = { type, target: hookState.target, ref: undefined };
    hookState.target.memoryCells.push(cell);
  }
  if (cell.type !== type) {
    throw new Error(
      `Hook policy violated: expected ${cell.type} but found ${type} instead`
    );
  }
  return cell;
}

function executeWithHooks(target: HookTarget, fn: () => void) {
  pushHookTarget(target);
  try {
    fn();
  } finally {
    popHookTarget(target);
  }
}

async function handleEffectResult(result: EffectResult): Promise<void> {
  if (result === undefined) return;
  if (result instanceof Disposable) result.dispose();
  if (result instanceof Function) await handleEffectResult(result());
  if (result instanceof Promise) await handleEffectResult(await result);
}

function disposeMemoryCells(hookTarget: HookTarget) {
  const handledAll = hookTarget.memoryCells.map(cell =>
    cell.ref ? handleEffectResult(cell.ref.dispose) : undefined
  );
  hookTarget.memoryCells = [];
  return Promise.all(handledAll);
}

// essentially a lazy, non-performant min-heap
const schedule: {
  nodesToRefresh: Set<HookTarget>;
  stack: HookTarget[];
} = {
  nodesToRefresh: new Set(),
  stack: [],
};

export function createHookTarget({
  handleError,
  execute = noop,
  dispose = noop,
}: {
  handleError: (err: Error) => unknown;
  execute?: () => void;
  dispose?: () => EffectResult;
}): HookTarget {
  let active = false;
  const hookTarget: HookTarget = {
    memoryCells: [],
    handleError,
    activate() {
      active = true;
      hookTarget.refresh();
    },
    refresh() {
      schedule.nodesToRefresh.delete(hookTarget);
      if (active) {
        executeWithHooks(hookTarget, execute);
      }
    },
    dispose(): Promise<unknown> {
      active = false;
      return Promise.all([
        disposeMemoryCells(hookTarget),
        handleEffectResult(dispose()),
      ]);
    },
  };
  return hookTarget;
}

let executingSchedule = false;
function scheduleRefresh(rawNodes: Iterable<HookTarget>) {
  const { nodesToRefresh } = schedule;
  for (const node of rawNodes) {
    nodesToRefresh.add(node);
  }
  schedule.stack = Array.from(nodesToRefresh).sort(
    (a, b) => (b.depth || 0) - (a.depth || 0)
  );

  if (!executingSchedule) {
    executingSchedule = true;
    while (schedule.stack.length) {
      const node = schedule.stack.pop()!;
      if (nodesToRefresh.has(node)) {
        node.refresh();
      }
    }
    executingSchedule = false;
  }
}

export function useState<T>(
  initialState: T
): [T, (newValue: T | ((last: T) => T)) => undefined] {
  const cell = getMemoryCell<{
    state: T;
    setState: (newState: T | ((last: T) => T)) => undefined;
  }>('state');

  let ref = cell.ref;

  if (!ref) {
    const target = getHookTarget();
    ref = {
      state: initialState,
      setState(newState: T | ((last: T) => T)) {
        return void setImmediate(() => {
          const nextStateResolved =
            typeof newState === 'function'
              ? (newState as (last: T) => T)(ref!.state)
              : newState;

          if (typeof nextStateResolved === 'function') {
            throw new Error(
              "functions can't be stored as top-level values in useState hooks"
            );
          }

          if (ref!.state !== nextStateResolved) {
            ref!.state = nextStateResolved;
            scheduleRefresh([target]);
          }
        });
      },
      dispose: noop,
    };

    cell.ref = ref;
  }

  return [ref.state, ref.setState];
}

export function useMemo<T>(create: () => T, deps: unknown[] = []) {
  const cell = getMemoryCell<{
    state: T;
    deps: unknown[];
  }>('memo');
  let ref = cell.ref;

  if (!ref) {
    ref = {
      state: create(),
      deps,
      dispose: noop,
    };

    cell.ref = ref;
  }

  if (
    ref.deps.length !== deps.length ||
    ref.deps.some((v, i) => deps[i] !== v)
  ) {
    ref.deps = deps;
    ref.state = create();
  }

  return ref.state;
}

export const empty = Symbol('empty');
export type empty = typeof empty;
function debounceWithAsyncQueue<T>(
  fn: (last: T | empty) => Promise<T | empty>
): () => Promise<T | empty> {
  let queue = Promise.resolve<T | empty>(empty);
  return () => {
    const result: Promise<T | empty> = queue.then(
      last => (queue === result ? fn(last) : last),
      () => (queue === result ? fn(empty) : empty)
    );
    queue = result;
    return result;
  };
}

function createEffectHandler(
  effect: Effect,
  handleError: (err: Error) => unknown
) {
  let disposed = false;
  const applyEffect = debounceWithAsyncQueue<EffectResult>(async last => {
    if (last !== empty) {
      try {
        await handleEffectResult(last);
      } catch (err) {
        handleError(err as Error);
      }
    }
    if (!disposed) {
      try {
        return await effect();
      } catch (err) {
        handleError(err as Error);
        throw err;
      }
    }
    return undefined;
  });
  return {
    applyEffect,
    dispose() {
      disposed = true;
      return applyEffect();
    },
  };
}

export function useEffect(effect: Effect, state: unknown[]) {
  const cell = getMemoryCell<{
    state: undefined | unknown[];
    lastEffect: Effect;
    applyEffect: () => Promise<empty | EffectResult>;
  }>('effect');

  let ref = cell.ref;

  if (!ref) {
    const handler = createEffectHandler(
      // eslint-disable-next-line @typescript-eslint/no-use-before-define
      () => newRef.lastEffect(),
      cell.target.handleError
    );
    const newRef = {
      ...handler,
      state: undefined,
      lastEffect: effect,
    };
    cell.ref = newRef;
    ref = newRef;
  }

  ref.lastEffect = effect;

  if (
    ref.state === undefined ||
    ref.state.length !== state.length ||
    ref.state.some((v, i) => state[i] !== v)
  ) {
    ref.state = state;
    setImmediate(() => ref!.applyEffect().catch(cell.target.handleError));
  }

  return ref.applyEffect;
}

/**
 * Resources are used to provide and consume shared, managed values.
 * Resources are defined by a function which returns the value consumers
 * will receive. However, unlike a traditional selector, a resource can use hooks.
 * Resources may also be used as shared, settable state if the resource
 * exposes a setter function.
 */
export function createResource<T>(rawResource: () => T): Resource<T> {
  let current: T;
  const consumers = new Set<HookTarget>();
  const resourceHookTarget: HookTarget = createHookTarget({
    // synchronous resource errors won't report to sentry
    handleError: console.error,
    execute() {
      const last = current;
      current = rawResource();
      if (current !== last) {
        scheduleRefresh(consumers);
      }
    },
  });
  return {
    async removeConsumer(node: HookTarget) {
      consumers.delete(node);
      if (consumers.size === 0) {
        await resourceHookTarget.dispose();
      }
    },
    consume(node: HookTarget) {
      if (consumers.size === 0) {
        resourceHookTarget.activate();
      }
      consumers.add(node);
      return current;
    },
  };
}

export function useResource<T>(resource: Resource<T>) {
  const target = getHookTarget();
  useEffect(() => () => resource.removeConsumer(target), [resource, target]);
  return resource.consume(target);
}
