import { EventEmitter } from 'events';
import { ChildProcess } from 'child_process';
import {
  Handlers,
  ChannelHandlers,
  MutableHandlerRegistry,
  HandlerRegistry,
  HandlerKey,
  createHandlerRegistry,
  registryAsHandlers,
  handlerKey,
} from './handlers';

type Message = any;

export type RawMessage = {
  n?: number;
  message: Message;
  source: 'MessageChannel';
};

export type NumberedRawMessage = RawMessage & {
  n: number;
};

export type RawMessageHandler = (message: RawMessage) => Promise<void>;

export type MessageChannelConfig = {
  send(message: RawMessage): void | Promise<void>;
  onMessageHandler(messageHandler: RawMessageHandler): void | Promise<void>;
};

export const ROUTED_REQUEST = handlerKey<
  {
    route: string;
    handlerKey: string | HandlerKey<unknown, unknown>;
    body: unknown;
  },
  unknown
>('routed-request');

class ResponseError extends Error {
  body: any;

  constructor(body: any) {
    super(
      `MessageChannel error: ${
        body && body.stack ? body.stack : JSON.stringify(body, null, 2)
      }`
    );
    this.body = body;
  }
}

const REQUEST = 'REQUEST';
const RESPONSE = 'RESPONSE';

const TIMEOUT = 3600000;

function createIPCMessageChannelConfig(
  process: NodeJS.Process | ChildProcess
): MessageChannelConfig {
  if (!process.send) {
    throw new Error('IPC not enabled for process');
  }

  const { channel } = process as any;

  return {
    send(message: unknown) {
      // eslint-disable-next-line consistent-return
      return new Promise((resolve, reject) => {
        if (!process.connected || !process.send) {
          return reject(
            new Error(
              'cannot send MessageChannel message because target process is not connected'
            )
          );
        }
        process.send(message as any, err => {
          if (err) {
            reject(err);
          }
          resolve();
        });
      });
    },
    onMessageHandler(messageHandler) {
      // adding the message handler will ref() the IPC channel, which keeps the process running.
      // we want to preserve the existing refed state.
      // before https://github.com/nodejs/node/commit/e65bed1b7e273d1db6ba5905c8f68338b06cd27a,
      // you could check if a channel was refed with `hasRef`. after, you can
      // decrement the counter incremented by `process.on('message')`, which
      // will unref if necessary.
      const needsUnref = channel.hasRef && !channel.hasRef();

      process.on('message', (message: RawMessage) => {
        messageHandler(message);
      });

      if (channel.unrefCounted) {
        channel.unrefCounted();
      } else if (needsUnref) {
        // can be removed when we only support node >= 14
        channel.unref();
      }
    },
  };
}

export function notify(key: string, body: any): void {
  sendIPCMessage({ type: REQUEST, body, key });
}

export function sendIPCMessage(message: any) {
  if (process.send) {
    process.send({
      source: 'MessageChannel',
      message,
    });
  } else {
    throw new Error('IPC not enabled for process');
  }
}

export default class MessageChannel {
  n = 0;
  config: MessageChannelConfig;
  eventEmitter = new EventEmitter();
  handlerRegistry: MutableHandlerRegistry;
  responseHandlers: Map<
    number,
    {
      resolve: (result: any) => void;
      reject: (error: any) => void;
      timeout: NodeJS.Timeout;
    }
  > = new Map();

  handlers: Handlers;

  messageHandler: RawMessageHandler;

  constructor(config: MessageChannelConfig, handlerRegistry?: HandlerRegistry) {
    this.config = config;
    this.handlerRegistry = createHandlerRegistry(handlerRegistry);

    this.messageHandler = async (m: RawMessage) => {
      if (m.source === 'MessageChannel') {
        const {
          n,
          message,
          message: { type },
        } = m;
        if (type === REQUEST) {
          const { key, body } = message;
          try {
            const requestHandler = this.handlerRegistry.map.get(key);
            if (!requestHandler) {
              throw new Error(`no handler for ${key}`);
            }
            const response = await requestHandler(body);
            if (n != null) {
              this.respond(n, false, response);
            }
          } catch (e: any) {
            console.log(e.stack);
            if (n != null) {
              this.respond(n, true, { stack: e.stack });
            }
          }
        } else if (type === RESPONSE) {
          const { n: requestN, body, isError } = message;
          const responseHandler = this.responseHandlers.get(requestN);
          if (!responseHandler) {
            // FIXME unhandled
            throw new Error('unexpected response message');
          }
          this.responseHandlers.delete(requestN);

          clearTimeout(responseHandler.timeout);

          if (isError) {
            responseHandler.reject(new ResponseError(body));
          } else {
            responseHandler.resolve(body);
          }
        } else {
          this.eventEmitter.emit(message.type, message);
        }
      }

      this.eventEmitter.emit('message', m);
    };

    this.config.onMessageHandler(this.messageHandler);

    this.handlers = {
      request: (key, body) => this.request(key, body),
      invoke: (key, body) => this.request(key as any, body),
    };
  }

  send(message: Message) {
    return this.config.send({ message, source: 'MessageChannel' });
  }

  sendNumbered(message: Message): number {
    const n = this.n++;

    Promise.resolve(
      this.config.send({ n, message, source: 'MessageChannel' })
    ).catch(err => {
      setImmediate(() => {
        throw err;
      });
    });

    return n;
  }

  /** Send a message and wait for a response */
  request(key: string, body: any): Promise<any> {
    const n = this.sendNumbered({ type: REQUEST, body, key });
    return new Promise((resolve, reject) => {
      // this timeout exists primarily to keep the event loop active
      const timeout = setTimeout(() => {
        reject(new Error(`timed out after ${TIMEOUT} ms`));
      }, TIMEOUT);
      this.responseHandlers.set(n, { resolve, reject, timeout });
    });
  }

  async respond(n: number, isError: boolean, body: any) {
    try {
      await this.send({ type: RESPONSE, n, body, isError });
    } catch (__e) {
      /* When responses can't be sent, assume the response is no longer needed */
    }
  }

  handle(key: string, handler: (handler: any) => any) {
    this.handlerRegistry.set(key, handler);
  }

  on(key: string, callback: (...args: any[]) => unknown) {
    this.eventEmitter.on(key, callback);
  }

  once(key: string, callback: (...args: any[]) => unknown) {
    this.eventEmitter.once(key, callback);
  }
}

export function createIPCMessageChannel(
  proc: NodeJS.Process | ChildProcess,
  handlerRegistry?: HandlerRegistry
) {
  return new MessageChannel(
    createIPCMessageChannelConfig(proc),
    handlerRegistry
  );
}

export function routeMessageChannel<
  HandlersType extends ChannelHandlers,
  Registry extends HandlerRegistry
>(
  messageChannel: {
    handlers: HandlersType;
    handlerRegistry: MutableHandlerRegistry;
  },
  routeRegistries: Map<string, Registry>
): Map<string, { handlers: HandlersType; handlerRegistry: Registry }> {
  const routeHandlers = new Map(
    Array.from(routeRegistries, ([route, registry]) => [
      route,
      registryAsHandlers(registry),
    ])
  );

  messageChannel.handlerRegistry.register(
    ROUTED_REQUEST,
    ({ route, handlerKey, body }) => {
      const handlers = routeHandlers.get(route);

      if (!handlers) {
        throw new Error('no handlers known for given route');
      }

      return handlers.invoke(handlerKey as HandlerKey, body);
    }
  );

  const result = new Map<
    string,
    { handlers: HandlersType; handlerRegistry: Registry }
  >();
  routeRegistries.forEach((registry, route) => {
    result.set(route, {
      handlers: {
        invoke<A, B>(handlerKey: HandlerKey<A, B>, body: A) {
          return messageChannel.handlers.invoke(ROUTED_REQUEST, {
            route,
            handlerKey,
            body,
          });
        },
      } as HandlersType,
      handlerRegistry: registry,
    });
  });
  return result;
}
