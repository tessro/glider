import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import dateFormat from 'dateformat';
import { Destination } from 'glider';
import { v4 as uuidv4 } from 'uuid';

interface S3DestinationOptions {
  bucketName: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
}

export class S3Destination implements Destination {
  name = 's3';

  private bucketName: string;
  private client: S3Client;

  constructor(options: S3DestinationOptions) {
    this.bucketName = options.bucketName;
    this.client = new S3Client({
      region: options.region,
      credentials: {
        accessKeyId: options.accessKeyId,
        secretAccessKey: options.secretAccessKey,
      },
    });
  }

  async write(
    jobId: string,
    source: string,
    stream: string,
    records: unknown[],
    retrievedAt: number
  ): Promise<void> {
    if (!records.length) {
      // No sense writing a zero-byte file
      return;
    }

    const dirname =
      `raw/data/${source}/${stream}/` + dateFormat('UTC:yyyy/mm/dd');
    const filename =
      dateFormat(retrievedAt, 'UTC:yyyy-mm-dd-hh-mm-ss') + `-${uuidv4()}.jsonl`;
    const path = [dirname, filename].join('/');

    const body = records.map((r) => JSON.stringify(r)).join('\n');

    const command = new PutObjectCommand({
      Bucket: this.bucketName,
      Key: path,
      Body: body,
    });

    await this.client.send(command);
  }
}
