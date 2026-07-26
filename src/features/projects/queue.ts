export async function runTaskQueue<T>(
  items: T[],
  concurrency: 1 | 2,
  shouldContinue: () => boolean,
  process: (item: T) => Promise<void>,
  onError?: (item: T, error: unknown) => void,
): Promise<number> {
  let cursor = 0;
  const worker = async () => {
    while (shouldContinue()) {
      const index = cursor;
      const item = items[cursor++];
      if (!item) break;
      try { await process(item); }
      catch (error) { onError?.(item, error); }
      if (index >= items.length) break;
    }
  };
  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  return Math.min(cursor, items.length);
}
