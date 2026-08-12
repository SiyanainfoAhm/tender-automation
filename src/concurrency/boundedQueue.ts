/**
 * Bounded async queue with optional priority ordering.
 */
export type BoundedQueueItem<T> = {
  value: T;
  priority: number;
  enqueuedAtMs: number;
};

export type BoundedQueue<T> = {
  maxSize: number;
  size(): number;
  tryEnqueue(value: T, priority?: number): boolean;
  dequeue(): T | undefined;
  peek(): T | undefined;
  clear(): void;
  toArray(): T[];
};

export function createBoundedQueue<T>(maxSize: number): BoundedQueue<T> {
  if (!Number.isFinite(maxSize) || maxSize < 1) {
    throw new Error(`BoundedQueue maxSize must be >= 1; got ${maxSize}`);
  }
  const items: BoundedQueueItem<T>[] = [];

  const sortStable = (): void => {
    items.sort((a, b) => {
      if (a.priority !== b.priority) return a.priority - b.priority;
      return a.enqueuedAtMs - b.enqueuedAtMs;
    });
  };

  return {
    maxSize,
    size: () => items.length,
    tryEnqueue(value: T, priority = 0): boolean {
      if (items.length >= maxSize) return false;
      items.push({
        value,
        priority,
        enqueuedAtMs: Date.now(),
      });
      sortStable();
      return true;
    },
    dequeue(): T | undefined {
      const next = items.shift();
      return next?.value;
    },
    peek(): T | undefined {
      return items[0]?.value;
    },
    clear(): void {
      items.length = 0;
    },
    toArray(): T[] {
      return items.map((i) => i.value);
    },
  };
}
