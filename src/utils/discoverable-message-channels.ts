import * as WebSocket from 'ws';

import { watchGlobalContext, getAllGlobalContexts } from './global-context';

import {
  Handlers,
  createHandlerRegistry,
  MutableHandlerRegistry,
  BroadcastHandlers,
  HandlerKey,
} from './handlers';
import MessageChannel from './MessageChannel';

import * as http from 'http';

import { Server as WebSocketServer } from 'ws';

import { exposeGlobalContext } from './global-context';

import { AddressInfo } from 'net';

export type ClosableMessageChannel = {
  close: () => void;
  handlers: Handlers;
  handlerRegistry: MutableHandlerRegistry;
};

export type DiscoverableChannelConfig = {
  key: string;
  description: string;
  port: number;
};

export const globalContextKey = 'discoverable-host-channels';

function watchDiscoverableChannels(
  onChange: (configs: DiscoverableChannelConfig[]) => any
) {
  return watchGlobalContext({
    key: globalContextKey,
    onError: console.error,
    onChange,
  });
}

function getAllDiscoverableChannels(): Promise<DiscoverableChannelConfig[]> {
  return getAllGlobalContexts(globalContextKey) as any;
}

export function createWebSocketMessageChannel(
  ws: WebSocket,
  handlerRegistry?: MutableHandlerRegistry
) {
  return new MessageChannel(
    {
      onMessageHandler(messageHandler) {
        ws.on('message', (rawMessage: string) => {
          messageHandler(JSON.parse(rawMessage));
        });
      },
      send(request) {
        if (ws.readyState === WebSocket.CLOSED) {
          throw new Error("Can't send message over non-open websocket");
        }
        ws.send(JSON.stringify(request));
      },
    },
    handlerRegistry
  );
}

function createClosableWebSocketMessageChannel(
  ws: WebSocket,
  onClose: () => unknown
): ClosableMessageChannel {
  const channel = createWebSocketMessageChannel(ws);
  ws.on('close', onClose);
  return {
    close() {
      ws.close();
    },
    handlers: channel.handlers,
    handlerRegistry: channel.handlerRegistry,
  };
}

export function addHeartbeat(ws: WebSocket, ms: number) {
  let lastSentPing = Date.now();
  let lastReceivedMessage = Date.now();

  const interval = setInterval(() => {
    if (lastSentPing - lastReceivedMessage > ms) {
      ws.close();
    } else {
      lastSentPing = Date.now();
      ws.ping();
    }
  }, ms).unref();

  ws.on('close', () => {
    clearInterval(interval);
  });
  ws.on('pong', () => {
    lastReceivedMessage = Date.now();
  });
  ws.on('ping', () => {
    interval.refresh();
    lastReceivedMessage = Date.now();
  });

  return ws;
}

function createOpenSocket(port: number): Promise<null | WebSocket> {
  return new Promise(resolve => {
    const ws = new WebSocket(`ws://localhost:${port}`);
    const timeout = setTimeout(() => {
      ws.close();
      resolve(null);
    }, 65);
    ws.on('error', () => {
      ws.close();
      resolve(null);
    });
    ws.on('open', () => {
      clearTimeout(timeout);
      addHeartbeat(ws, 15000);
      resolve(ws);
    });
  });
}

function createAsyncQueue() {
  let queue: (() => unknown)[] = [];
  let running = false;

  return {
    async enqueue(cb: () => unknown): Promise<void> {
      queue.push(cb);

      if (!running) {
        running = true;
        while (queue.length) {
          await queue.shift()!();
        }
        running = false;
      }
    },
    clear() {
      queue = [];
    },
  };
}

export function discoverMessageChannel({
  key,
  timeoutMilliseconds = 3000,
  onClose = () => {},
}: {
  key: string;
  timeoutMilliseconds?: number;
  onClose?: () => unknown;
}): Promise<ClosableMessageChannel> {
  return new Promise((resolve, reject) => {
    let finalized = false;

    // An async queue is used for 2 reasons:
    // 1) The queue ensures that no potential hosts are being explored when the request to discover
    //   a host times out. In that scenario, a host connection could be made that can't be closed
    //   or unrefed.
    // 2) It's possible for watchDiscoverableChannels() to callback many times very quickly with mostly
    //   unchanging information. To avoid creating unwanted or duplicate websockets, each callback is
    //   handled in sequence using an async queue.
    const queue = createAsyncQueue();

    const timeout = setTimeout(() => {
      queue.enqueue(() => {
        if (!finalized) {
          finalize();
          reject(
            new Error(
              `Error: discovery of host message channel timed out after ${timeoutMilliseconds} milliseconds`
            )
          );
        }
      });
    }, timeoutMilliseconds);

    const unwatch = watchDiscoverableChannels(configs => {
      if (finalized) {
        return;
      }

      let hostSelected = false;

      queue
        .enqueue(() =>
          Promise.all(
            configs
              .filter(config => config.key === key)
              .map(possibleHost =>
                createOpenSocket(possibleHost.port).then(websocket => {
                  if (websocket === null) {
                    return;
                  } else if (hostSelected) {
                    websocket.close();
                  } else {
                    hostSelected = true;
                    finalize();
                    resolve(
                      createClosableWebSocketMessageChannel(websocket, onClose)
                    );
                  }
                })
              )
          )
        )
        .catch(err => {
          finalize();
          reject(
            new Error(
              `Caught unexpected error when attempting to discover host:\n${err.message}\n${err.stack}`
            )
          );
        });
    });

    function finalize() {
      finalized = true;
      queue.clear();
      unwatch();
      clearTimeout(timeout);
    }
  });
}

export async function requestAllDiscoverableHosts(
  key: string,
  message: unknown
) {
  const resolvedConfigs = await getAllDiscoverableChannels();

  return Promise.all(
    resolvedConfigs.map(async config => {
      const ws = await createOpenSocket(config.port);

      if (!ws) {
        return;
      }

      const channel = createWebSocketMessageChannel(ws);

      return channel.request(key, message).finally(() => ws.terminate());
    })
  );
}

function exposeDiscoverableChannelConfig(signature: DiscoverableChannelConfig) {
  return exposeGlobalContext(globalContextKey, signature);
}

async function createWebSocketServer(): Promise<{
  server: WebSocketServer;
  port: number;
}> {
  return new Promise((resolve, reject) => {
    const server = new http.Server()
      .on('listening', () => {
        server.unref();
        resolve({
          server: new WebSocketServer({ server }),
          port: (server.address() as AddressInfo).port,
        });
      })
      .on('error', () => {
        reject(new Error('Error: failed to create listening http server'));
      });

    server.listen();
  });
}

export async function hostDiscoverableMessageChannel({
  clientKeys,
  description = clientKeys.join(', '),
  onClose,
  handlerRegistry = createHandlerRegistry(),
}: {
  clientKeys: string[];
  description?: string;
  onClose?: () => undefined | Promise<undefined>;
  handlerRegistry?: MutableHandlerRegistry;
}): Promise<{
  handlers: BroadcastHandlers;
  handlerRegistry: MutableHandlerRegistry;
  close: () => undefined;
}> {
  const { server, port } = await createWebSocketServer();

  const connections = new Set<MessageChannel>();

  const handlers: BroadcastHandlers = {
    invoke<A, B>(handlerKey: HandlerKey<A, B>, requestMessage: A) {
      return Promise.all(
        Array.from(connections, child =>
          child.handlers.invoke(handlerKey, requestMessage)
        )
      );
    },
  };

  function stopHost() {
    if (hideGlobalContext) {
      hideGlobalContext();
    }
    server.close(err => (err !== undefined ? console.error(err) : undefined));
  }

  let closed = false;
  function close() {
    if (!closed) {
      closed = true;
      stopHost();
      if (onClose) {
        onClose();
      }
    }
    return undefined;
  }

  server.on('connection', (ws: WebSocket) => {
    addHeartbeat(ws, 20000);
    const messageChannel = createWebSocketMessageChannel(ws, handlerRegistry);
    ws.once('close', () => {
      connections.delete(messageChannel);
    });
    connections.add(messageChannel);
  });

  handlerRegistry.set('terminate-any-host', () => {
    setImmediate(() => close());
  });

  handlerRegistry.set('terminate-unused-host', () => {
    if (!connections.size) {
      setImmediate(() => close());
    }
  });

  let hideGlobalContextCallbacks = clientKeys.map(key =>
    exposeDiscoverableChannelConfig({
      port,
      key,
      description,
    })
  );

  function hideGlobalContext() {
    hideGlobalContextCallbacks.forEach(callback => callback());
    hideGlobalContextCallbacks = [];
  }

  return {
    handlers,
    handlerRegistry,
    close,
  };
}
