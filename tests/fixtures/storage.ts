import type { Storage } from '../../worker/src/publication-store';

export type Hook = (
  operation: string,
  sql: string,
  phase: 'before' | 'after',
) => void | Promise<void>;
// Inject transport faults around REAL local D1/R2 operations; no mock SQL engine
// and no test-only route or failure switch in the production Worker.
export function instrumentStorage(storage: Storage, hook: Hook): Storage {
  const raw = new WeakMap<object, object>();
  function statement(target: object, sql: string): object {
    const wrapped = new Proxy(target, {
      get(target, property) {
        const value = Reflect.get(target, property);
        if (property === 'bind')
          return (...args: unknown[]) => statement(value.apply(target, args), sql);
        if (['first', 'all', 'run'].includes(String(property)))
          return async (...args: unknown[]) => {
            await hook(String(property), sql, 'before');
            const result = await value.apply(target, args);
            await hook(String(property), sql, 'after');
            return result;
          };
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    raw.set(wrapped, target);
    return wrapped;
  }
  return {
    DB: new Proxy(storage.DB, {
      get(target, property) {
        if (property === 'prepare') return (sql: string) => statement(target.prepare(sql), sql);
        if (property === 'batch')
          return async (statements: object[]) => {
            await hook('batch', '', 'before');
            const result = await target.batch(
              statements.map((item) => raw.get(item) || item) as Parameters<typeof target.batch>[0],
            );
            await hook('batch', '', 'after');
            return result;
          };
        const value = Reflect.get(target, property);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    }),
    IMAGES: new Proxy(storage.IMAGES, {
      get(target, property) {
        const value = Reflect.get(target, property);
        if (['put', 'delete', 'get', 'head'].includes(String(property)))
          return async (...args: unknown[]) => {
            const key = String(args[0]);
            await hook(String(property), key, 'before');
            const result = await value.apply(target, args);
            await hook(String(property), key, 'after');
            return result;
          };
        return typeof value === 'function' ? value.bind(target) : value;
      },
    }),
  };
}
