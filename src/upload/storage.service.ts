import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  DeleteObjectsCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';

@Injectable()
export class StorageService implements OnModuleDestroy {
  private readonly logger = new Logger(StorageService.name);
  private readonly client: S3Client | null;
  private readonly bucket: string;

  constructor(private config: ConfigService) {
    this.bucket = this.config.get<string>('S3_BUCKET') ?? '';

    if (!this.bucket) {
      this.client = null;
      this.logger.warn(
        'Chưa cấu hình S3_BUCKET — upload chạy ở chế độ dev, không lưu file thật.',
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

  get isEnabled(): boolean {
    return this.client !== null;
  }

  async put(key: string, body: Buffer, contentType: string): Promise<string> {
    if (!this.client) {
      this.logger.log(
        `[UPLOAD-DEV] bỏ qua ${key} (${contentType}, ${body.length} byte)`,
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

  async deleteMany(keys: string[]): Promise<number> {
    if (keys.length === 0) return 0;

    if (!this.client) {
      this.logger.log(`[UPLOAD-DEV] bỏ qua xoá ${keys.length} object`);
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

  private publicUrl(key: string): string {
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
