import type { Destination } from 'glider';
import pino from 'pino';

export class StdoutDestination implements Destination {
  name = 'stdout';
  logger = pino({
    base: {
      destination: this.name,
    },
  });

  write(
    jobId: string,
    source: string,
    stream: string,
    records: unknown[]
  ): void {
    for (const record of records) {
      this.logger.info({
        job: jobId,
        source,
        stream,
        record,
      });
    }
  }
}
