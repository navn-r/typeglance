export type HandlerKey<_A = unknown, _B = any> = string & {
  never: never;
  _a: _A;
  _b: _B;
};

export interface ChannelHandlers {
  invoke<A, B>(key: HandlerKey<A, B>, input: A): Promise<B | B[]>;
}

export interface Handlers extends ChannelHandlers {
  invoke<A, B>(key: HandlerKey<A, B>, input: A): Promise<B>;
  request<A, B>(key: string, input: A): Promise<B>;
}

export interface BroadcastHandlers extends ChannelHandlers {
  invoke<A, B>(key: HandlerKey<A, B>, input: A): Promise<B[]>;
}

export interface HandlerRegistry {
  map: Map<string, (arg: any) => any>;
}

export interface Handler<A, B> {
  (input: A): B | Promise<B>;
}

export interface MutableHandlerRegistry extends HandlerRegistry {
  register<A, B, C extends Handler<A, B>>(
    key: HandlerKey<A, B>,
    handler: C
  ): void;

  set(key: string, handler: (input: any) => any): void;
}

export function handlerKey<A, B>(key: string): HandlerKey<A, B> {
  return key as HandlerKey<A, B>;
}

export function createHandlerRegistry(
  handlerRegistry?: HandlerRegistry
): MutableHandlerRegistry {
  const map = new Map<string, (arg: any) => any>(
    (handlerRegistry ? handlerRegistry.map : undefined)!
  );
  return {
    register<A, B>(key: HandlerKey<A, B>, handler: Handler<A, B>) {
      map.set(key, handler);
    },
    set(key: string, value: (arg: any) => any) {
      map.set(key, value);
    },

    map,
  };
}

export function registryAsHandlers(handlerRegistry: HandlerRegistry): Handlers {
  function getRequiredHandler(handlerKey: HandlerKey) {
    const handler = handlerRegistry.map.get(handlerKey);
    if (!handler) {
      throw new Error(`missing handler for ${handlerKey}`);
    }
    return handler;
  }
  return {
    invoke(key, input) {
      return Promise.resolve(getRequiredHandler(key)(input));
    },
    request(key, input) {
      return Promise.resolve(getRequiredHandler(key as HandlerKey)(input));
    },
  };
}
