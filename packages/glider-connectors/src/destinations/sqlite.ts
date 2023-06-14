import { Destination, DestinationContext } from '@balsahq/glider';
import Database from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';

interface SqliteDestinationOptions {
  path: string;
}

function getTableName(source: string, stream: string): string {
  return `${source}_${stream}`;
}

function escapeTableName(tableName: string) {
  return tableName.replace(/[^a-zA-Z0-9_]/g, '_');
}

export class SqliteDestination implements Destination {
  name = 'sqlite';

  private connection!: Database.Database;

  constructor(private readonly options: SqliteDestinationOptions) {}

  async open(): Promise<void> {
    this.connection = new Database(this.options.path);
  }

  async close(): Promise<void> {
    this.connection.close();
  }

  async write(
    source: string,
    stream: string,
    records: unknown[],
    retrievedAt: number,
    { jobId }: DestinationContext
  ): Promise<void> {
    const tableName = getTableName(source, stream);
    await this.ensureTable(tableName);

    const statement = this.connection.prepare(
      `
        INSERT INTO ${escapeTableName(tableName)}
        (id, job_id, data, retrieved_at)
        VALUES (?, ?, ?, ?)
      `
    );

    for (const record of records) {
      statement.run(
        uuidv4(),
        jobId,
        JSON.stringify(record),
        new Date(retrievedAt).toISOString()
      );
    }
  }

  async ensureTable(name: string): Promise<void> {
    this.connection
      .prepare(
        `
          CREATE TABLE IF NOT EXISTS ${escapeTableName(name)} (
            id VARCHAR(36) PRIMARY KEY,
            job_id VARCHAR(36) NOT NULL,
            data JSON,
            retrieved_at DATETIME(3)
          )
        `
      )
      .run();
  }
}
