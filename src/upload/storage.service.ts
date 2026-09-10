import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  DeleteObjectsCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';

@Injectable()
export class StorageService implements OnModuleDestroy {
  private readonly logger = new Logger(StorageService.name);
  private readonly client: S3Client | null;
  private readonly bucket: string;

  constructor(private readonly config: ConfigService) {
    this.bucket = this.config.get<string>('S3_BUCKET') ?? '';

    if (!this.bucket) {
      this.client = null;
      this.logger.warn(
        'S3_BUCKET is not configured — uploads run in dev mode and no real file is stored.',
      );
      return;
    }

    const endpoint = this.config.get<string>('S3_ENDPOINT') || undefined;

    this.client = new S3Client({
      region: this.config.get<string>('S3_REGION') ?? 'auto',
      endpoint,
      forcePathStyle: this.config.get<string>('S3_FORCE_PATH_STYLE') === 'true',
      credentials: {
        accessKeyId: this.config.get<string>('S3_ACCESS_KEY_ID') ?? '',
        secretAccessKey: this.config.get<string>('S3_SECRET_ACCESS_KEY') ?? '',
      },
    });
  }

  /** Whether a real S3 client is configured, as opposed to dev mode. */
  get isEnabled(): boolean {
    return this.client !== null;
  }

  /**
   * Stores an object and returns the URL it is served from.
   *
   * @param key - Object key to write to.
   * @param body - File contents.
   * @param contentType - MIME type stored alongside the object.
   * @returns The public URL of the object; in dev mode nothing is written.
   */
  async put(key: string, body: Buffer, contentType: string): Promise<string> {
    if (!this.client) {
      this.logger.log(
        `[UPLOAD-DEV] skipped ${key} (${contentType}, ${body.length} bytes)`,
      );
      return this.publicUrl(key);
    }

    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
        CacheControl: 'public, max-age=31536000, immutable',
      }),
    );

    return this.publicUrl(key);
  }

  /**
   * Reads an object with credentials instead of through a public URL. Used for
   * files that must not be downloadable by anyone (reports hold customer data).
   *
   * @param key - Object key to read.
   * @returns The object contents, or `null` when it does not exist or storage
   * is running in dev mode.
   */
  async get(key: string): Promise<Buffer | null> {
    if (!this.client) {
      this.logger.log(`[UPLOAD-DEV] no real file to read: ${key}`);
      return null;
    }

    try {
      const result = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      );

      const bytes = await result.Body?.transformToByteArray();
      return bytes ? Buffer.from(bytes) : null;
    } catch (error) {
      const name = (error as { name?: string }).name;
      if (name === 'NoSuchKey' || name === 'NotFound') return null;
      throw error;
    }
  }

  /**
   * Deletes objects in batches of 1000, the S3 per-request maximum.
   *
   * @param keys - Object keys to remove.
   * @returns How many keys were submitted for deletion.
   */
  async deleteMany(keys: string[]): Promise<number> {
    if (keys.length === 0) return 0;

    if (!this.client) {
      this.logger.log(`[UPLOAD-DEV] skipped deleting ${keys.length} objects`);
      return keys.length;
    }

    const BATCH = 1000;
    let deleted = 0;

    for (let i = 0; i < keys.length; i += BATCH) {
      const batch = keys.slice(i, i + BATCH);
      await this.client.send(
        new DeleteObjectsCommand({
          Bucket: this.bucket,
          Delete: { Objects: batch.map((Key) => ({ Key })), Quiet: true },
        }),
      );
      deleted += batch.length;
    }

    return deleted;
  }

  /**
   * Recovers the object key from a URL this service produced.
   *
   * @param url - A URL previously returned by {@link StorageService.put}.
   * @returns The object key, or `null` when the URL is not ours.
   */
  keyFromUrl(url: string): string | null {
    const base = this.baseUrl();
    if (!base || !url.startsWith(base)) return null;

    const key = url.slice(base.length).replace(/^\/+/, '');
    return key || null;
  }

  private baseUrl(): string {
    const configured = this.config.get<string>('S3_PUBLIC_URL');
    if (configured) return configured.replace(/\/+$/, '');

    if (!this.bucket) return `${this.appUrl}/uploads-dev`;

    const region = this.config.get<string>('S3_REGION') ?? 'auto';
    return `https://${this.bucket}.s3.${region}.amazonaws.com`;
  }

  /**
   * The URL a key will be served from, without writing anything.
   *
   * Public so a caller can record the object before uploading it: an upload
   * that succeeds while its `uploaded_objects` row does not leaves a file the
   * cleanup can never find, because the cleanup only ever reads that table.
   *
   * @param key - Object key.
   * @returns The URL {@link StorageService.put} would return for that key.
   */
  publicUrl(key: string): string {
    return `${this.baseUrl()}/${key}`;
  }

  private get appUrl(): string {
    return (
      this.config.get<string>('APP_URL') ??
      `http://localhost:${this.config.get<string>('PORT') ?? 3000}`
    );
  }

  onModuleDestroy(): void {
    this.client?.destroy();
  }
}
