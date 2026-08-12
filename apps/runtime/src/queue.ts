export class KeyedQueue {
  readonly #tails = new Map<string, Promise<void>>();

  async run<T>(key: string, task: () => Promise<T>): Promise<T> {
    const prior = this.#tails.get(key) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = prior.then(() => current);
    this.#tails.set(key, tail);
    await prior;
    try {
      return await task();
    } finally {
      release();
      if (this.#tails.get(key) === tail) this.#tails.delete(key);
    }
  }
}
