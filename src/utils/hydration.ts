export function execWithCache<I, O extends object>(
  fn: (i: I, recur: (i: I) => O) => O,
  input: I
): O {
  const cache = new Map<I, O>();

  function exec(i: I): O {
    if (cache.has(i)) {
      return cache.get(i)!;
    }
    const result = {} as O;
    cache.set(i, result);
    Object.assign(result, fn(i, exec));
    return result;
  }

  return exec(input);
}

export type Dehydrated<T> = Record<
  number,
  number | string | boolean | number[] | Record<string, number>
> & {
  __brand: T;
};

// 'Straightens' the input by placing every object/value directly into an array
export function dehydrateValue<T>(type: T): Dehydrated<T> {
  const cache = new Map<any, { id: number; value: any }>();
  let nextId = 0;

  const ignoredKeys = ['checker'];

  function serialize(value: any): any {
    // Prevent infinite recursion on circular structure
    if (cache.has(value)) {
      return cache.get(value)!.id;
    }
    const entry = { id: nextId++, value: undefined as any };
    cache.set(value, entry);

    if (Array.isArray(value)) {
      entry.value = value.map(v => serialize(v));
    } else if (typeof value === 'function') {
      entry.value = `function_${value.name || '[anon]'}`;
    } else if (typeof value !== 'object') {
      entry.value = value;
    } else {
      entry.value = {};
      Object.assign(
        entry.value,
        Object.fromEntries(
          Object.entries(value)
            .filter(([key]) => {
              return (
                // Don't include from prototype chain
                Object.prototype.hasOwnProperty.call(value, key) &&
                !ignoredKeys.includes(key)
              );
            })
            .map(([key, v]) => [key, serialize(v)])
        )
      );
    }

    return entry.id;
  }

  serialize(type);

  return Object.fromEntries(
    Array.from(cache.entries()).map(([, { id, value }]) => [id, value])
  ) as any;
}

// Essentially a mirror of dehydrate
export function hydrateValue<T>(value: Dehydrated<T>): T {
  if (!value || Object.keys(value).length === 0) {
    throw new Error('Hydration error');
  }

  const cache = new Map<any, { value: any }>();

  const deserialize = (val: any): any => {
    if (cache.has(val)) {
      return cache.get(val)!.value;
    }
    const cacheEntry = { value: undefined as any };
    cache.set(val, cacheEntry);

    if (Array.isArray(val)) {
      // Array of keys from the dehydrated object
      cacheEntry.value = val.map(k => deserialize(value[k]));
    } else if (typeof val !== 'object') {
      cacheEntry.value = val;
    } else {
      cacheEntry.value = {};
      Object.assign(
        cacheEntry.value,
        Object.fromEntries(
          Object.entries(val).map(([k, v]) => [
            k,
            // Key in the dehydrated value
            typeof v === 'number' ? deserialize(value[v]) : v,
          ])
        )
      );
    }

    return cacheEntry.value;
  };

  return deserialize(value[0]);
}
