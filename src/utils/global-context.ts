import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

interface GlobalContextSubscriber<Content> {
  onChange: (contents: Content[]) => unknown;
  onError: (err: Error) => unknown;
}

interface GlobalContextWatcher<Content> {
  subscribe(subscriber: GlobalContextSubscriber<Content>): () => void;
}

const globalContextDir = path.join(os.homedir(), '.demo-global-context');

let i = 10000;

export function exposeGlobalContext(key: string, context: any) {
  fs.mkdirSync(path.join(globalContextDir, key), { recursive: true });

  const contextPath = path.join(
    globalContextDir,
    key,
    `${process.pid}-${++i}.json`
  );

  fs.writeFileSync(contextPath, JSON.stringify(context));

  return function hideGlobalContext() {
    try {
      fs.unlinkSync(contextPath);
    } catch (err: any) {
      if (err.code !== 'ENOENT') {
        throw err;
      }
    }
  };
}

export function createKeyFromComponents(...components: string[]) {
  return components.sort().join('.');
}

function throttle(fn: () => void, ms: number) {
  let lastCalled = 0;
  return () => {
    const now = Date.now();
    if (now - lastCalled >= ms) {
      lastCalled = now;
      fn();
    }
  };
}

const jsonFilename = /^(\d+)-\d+\.json$/;

/**
 * Why use a global instead of a context associated with a reactor?
 * This global is used to limit the number of times a process-wide Node
 * global is accessed. The protected resource is not created on a per
 * reactor basis, so we don't benefit from associating GlobalContextWatchers
 * with a particular reactor.
 * */
const globalContextWatchers = new Map<string, GlobalContextWatcher<unknown>>();

function getGlobalContextWatcher<Content>(
  key: string
): GlobalContextWatcher<Content> {
  const existingWatcher = globalContextWatchers.get(key);
  if (existingWatcher) {
    return existingWatcher;
  }

  const subscribers = new Set<GlobalContextSubscriber<Content>>();

  function handleUnexpectedError(err: Error) {
    setImmediate(() => {
      for (const subscriber of subscribers) {
        subscriber.onError(err);
      }
    });
  }

  const dir = path.join(globalContextDir, key);
  const configByFileName: Map<string, Content> = new Map();

  function emit() {
    setImmediate(() => {
      const configs = Array.from(configByFileName.values());
      for (const subscriber of subscribers) {
        subscriber.onChange(configs);
      }
    });
  }

  const purge = throttle(() => {
    let purged = false;
    configByFileName.forEach((_, filename) => {
      const match = jsonFilename.exec(filename);
      if (match == null) {
        handleUnexpectedError(
          new Error(`Error: unexpected filename '${filename}' in ${dir}`)
        );
        return;
      }
      const pid = match[1];
      let running;
      try {
        running = process.kill(parseInt(pid, 10), 0);
      } catch (e: any) {
        running = e.code === 'EPERM';
      }
      if (!running) {
        try {
          fs.unlinkSync(path.join(dir, filename));
          configByFileName.delete(filename);
          purged = true;
        } catch (err: any) {
          if (err.code !== 'ENOENT') {
            handleUnexpectedError(err);
          }
        }
      }
    });

    if (purged) {
      emit();
    }
  }, 5000);

  function eventTriggered(filename: string) {
    try {
      configByFileName.set(
        filename,
        JSON.parse(fs.readFileSync(path.join(dir, filename), 'utf8'))
      );
    } catch (err: any) {
      if (err.code === 'ENOENT') {
        configByFileName.delete(filename);
      } else {
        handleUnexpectedError(err);
      }
    }
    emit();
  }

  function readAll() {
    // add all files created since the system started, and delete the rest
    const minTime = new Date(Date.now() - os.uptime() * 1000);
    try {
      fs.readdirSync(dir).forEach(basename => {
        const filename = path.join(dir, basename);
        try {
          const { mtime } = fs.statSync(filename);
          if (mtime < minTime) {
            fs.unlinkSync(filename);
          } else {
            eventTriggered(basename);
          }
        } catch (err: any) {
          if (err.code !== 'ENOENT') {
            handleUnexpectedError(err);
          }
        }
      });
    } catch (err: any) {
      if (err.code !== 'ENOENT') {
        handleUnexpectedError(err);
      }
    }
  }

  fs.mkdirSync(dir, { recursive: true });

  readAll();
  purge();
  // purge at least every 30 seconds, at most every 5
  const purgeInterval = setInterval(purge, 30000);
  emit();

  const watcher = fs
    .watch(path.join(globalContextDir, key), (__event, filename) => {
      eventTriggered(filename);
    })
    .on('close', () => clearInterval(purgeInterval));

  const contextWatcher: GlobalContextWatcher<Content> = {
    subscribe(subscriber) {
      subscribers.add(subscriber);
      setImmediate(() =>
        subscriber.onChange(Array.from(configByFileName.values()))
      );
      return function unsubscribe() {
        subscribers.delete(subscriber);
        if (!subscribers.size) {
          globalContextWatchers.delete(key);
          watcher.close();
        }
      };
    },
  };

  globalContextWatchers.set(key, contextWatcher);

  return contextWatcher;
}

export function watchGlobalContext<Content>({
  key,
  onChange,
  onError,
}: {
  key: string;
  onChange: (contexts: Array<Content>) => unknown;
  onError: (err: any) => unknown;
}) {
  return getGlobalContextWatcher<Content>(key).subscribe({ onChange, onError });
}

export function getAllGlobalContexts<T>(contextKey: string): Promise<T[]> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      unwatch();
      reject();
    }, 500);

    const unwatch = watchGlobalContext({
      key: contextKey,
      onChange: (configs: T[]) => {
        unwatch();
        clearTimeout(timeout);
        resolve(configs);
      },
      onError: reject,
    });
  });
}
