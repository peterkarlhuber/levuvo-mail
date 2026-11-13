// Small in-memory LRU. Used for list previews, the offline fallback of recently
// loaded folders/messages and address suggestions. Nothing is persisted to disk:
// quitting the app removes every cached mail fragment.
export function createLru(max) {
  const map = new Map();
  return {
    get(key) {
      if (!map.has(key)) return undefined;
      const value = map.get(key);
      map.delete(key);
      map.set(key, value);
      return value;
    },
    set(key, value) {
      map.delete(key);
      map.set(key, value);
      while (map.size > max) map.delete(map.keys().next().value);
    },
    delete(key) {
      map.delete(key);
    },
    deleteWhere(predicate) {
      for (const key of [...map.keys()]) if (predicate(key)) map.delete(key);
    },
    clear() {
      map.clear();
    },
    get size() {
      return map.size;
    }
  };
}
