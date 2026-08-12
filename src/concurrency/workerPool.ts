/**
 * Bounded async worker pool — at most `concurrency` tasks in flight.
 */
export type WorkerPoolResult<T, R> = {
  input: T;
  ok: boolean;
  result?: R;
  error?: string;
};

export async function runWorkerPool<T, R>(options: {
  items: T[];
  concurrency: number;
  worker: (item: T, workerId: number) => Promise<R>;
  /** Called when a stop signal should halt dequeuing new work. */
  shouldStop?: () => boolean;
  onItemDone?: (outcome: WorkerPoolResult<T, R>) => void;
}): Promise<WorkerPoolResult<T, R>[]> {
  const concurrency = Math.max(1, Math.floor(options.concurrency));
  const queue = [...options.items];
  const outcomes: WorkerPoolResult<T, R>[] = [];
  let nextIndex = 0;

  const runOne = async (workerId: number): Promise<void> => {
    while (true) {
      if (options.shouldStop?.()) break;
      const index = nextIndex;
      if (index >= queue.length) break;
      nextIndex += 1;
      const item = queue[index]!;
      try {
        const result = await options.worker(item, workerId);
        const outcome: WorkerPoolResult<T, R> = {
          input: item,
          ok: true,
          result,
        };
        outcomes.push(outcome);
        options.onItemDone?.(outcome);
      } catch (error) {
        const outcome: WorkerPoolResult<T, R> = {
          input: item,
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        };
        outcomes.push(outcome);
        options.onItemDone?.(outcome);
      }
    }
  };

  const workers = Array.from({ length: Math.min(concurrency, queue.length || 1) }, (_, i) =>
    runOne(i + 1),
  );
  await Promise.all(workers);
  return outcomes;
}
