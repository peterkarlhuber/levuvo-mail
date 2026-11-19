// One place for the server's recurring background work (ARC-LEV-009). Modules register their jobs
// while the routes are set up; nothing runs until start() (listen() with background enabled), and
// close() stops every timer. A job never overlaps itself: a run still busy skips its next turn.

export function createBackgroundJobs({ logger = () => {} } = {}) {
  const jobs = [];
  let timers = [];
  let started = false;
  return {
    /**
     * @param {string} name for the log
     * @param {() => Promise<unknown>|unknown} run
     * @param {{every:number, firstDelay?:number}} schedule milliseconds
     */
    register(name, run, { every, firstDelay = every }) {
      if (!(every > 0)) throw new Error(`Job ${name}: interval missing.`);
      const job = { name, run, every, firstDelay, busy: false };
      jobs.push(job);
      if (started) schedule(job);
    },
    start() {
      if (started) return;
      started = true;
      for (const job of jobs) schedule(job);
    },
    stop() {
      started = false;
      for (const t of timers) clearTimeout(t);
      timers = [];
    },
    get names() {
      return jobs.map(j => j.name);
    }
  };

  function schedule(job) {
    const tick = async () => {
      if (!started || job.busy) return;
      job.busy = true;
      try {
        await job.run();
      } catch (err) {
        logger(`Background job ${job.name} failed: ${err?.code || err?.message || err}`);
      } finally {
        job.busy = false;
      }
    };
    const first = setTimeout(() => void tick(), job.firstDelay);
    const every = setInterval(() => void tick(), job.every);
    first.unref?.();
    every.unref?.();
    timers.push(first, every);
  }
}
