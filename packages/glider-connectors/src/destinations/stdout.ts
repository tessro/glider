import type { Destination, DestinationContext } from '@balsahq/glider';
import { pino } from 'pino';

export class StdoutDestination implements Destination {
  name = 'stdout';
  logger = pino({
    base: {
      destination: this.name,
    },
  });

  write(
    source: string,
    stream: string,
    records: unknown[],
    _: number, // retrievedAt
    context: DestinationContext
  ): void {
    for (const record of records) {
      this.logger.info({
        job: context.jobId,
        source,
        stream,
        record,
      });
    }
  }
}
