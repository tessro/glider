import { Destination } from 'glider';
import {
  createConnection as createMysqlConnection,
  Connection,
} from 'mysql2/promise';
import { v4 as uuidv4 } from 'uuid';

interface MysqlDestinationOptions {
  host: string;
  user: string;
  password?: string;
  database: string;
}

function getTableName(source: string, stream: string): string {
  return `${source}_${stream}`;
}

export class MysqlDestination implements Destination {
  name = 'mysql';

  private connection!: Connection;

  constructor(private readonly options: MysqlDestinationOptions) {}

  async open(): Promise<void> {
    this.connection = await createMysqlConnection({
      host: this.options.host,
      user: this.options.user,
      password: this.options.password,
      database: this.options.database,
    });
  }

  async close(): Promise<void> {
    await this.connection.end();
  }

  async write(
    jobId: string,
    source: string,
    stream: string,
    records: unknown[],
    retrievedAt: number
  ): Promise<void> {
    const tableName = getTableName(source, stream);
    await this.ensureTable(tableName);

    for (const record of records) {
      await this.connection.query(
        `
        INSERT INTO ${this.connection.escapeId(
          tableName
        )} (id, job_id, data, retreived_at)
        VALUES (?, ?, ?, ?)
        `,
        [uuidv4(), jobId, JSON.stringify(record), new Date(retrievedAt)]
      );
    }
  }

  async ensureTable(name: string): Promise<void> {
    await this.connection.query(`
      CREATE TABLE IF NOT EXISTS ${this.connection.escapeId(name)} (
        id VARCHAR(36) PRIMARY KEY,
        job_id VARCHAR(36) NOT NULL,
        data JSON,
        retreived_at DATETIME(3)
      )
    `);
  }
}
