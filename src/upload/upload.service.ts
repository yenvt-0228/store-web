import { BadRequestException, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { I18nService } from 'nestjs-i18n';
import { PrismaService } from '../prisma/prisma.service';
import { detectImageFormat, SUPPORTED_IMAGE_TYPES } from './image-validation';
import { StorageService } from './storage.service';

export interface UploadedImage {
  url: string;
  key: string;
}

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

@Injectable()
export class UploadService {
  constructor(
    private storage: StorageService,
    private i18n: I18nService,
    private prisma: PrismaService,
  ) {}

  async uploadImages(
    files: Express.Multer.File[],
    folder: string,
  ): Promise<UploadedImage[]> {
    if (!files?.length) {
      throw new BadRequestException(this.i18n.t('upload.NO_FILE'));
    }

    const validated = files.map((file) => this.validate(file, folder));

    const uploaded = await Promise.all(
      validated.map(async ({ key, buffer, mimeType }) => ({
        key,
        url: await this.storage.put(key, buffer, mimeType),
      })),
    );

    // Ghi sổ sau khi đẩy file xong: object nào không được gắn vào entity nào
    // thì ImageCleanupService dựa vào đây mà xoá, nếu không nó nằm lại vĩnh viễn.
    await this.prisma.uploadedObject.createMany({
      data: uploaded.map(({ key, url }) => ({ objectKey: key, url })),
      skipDuplicates: true,
    });

    return uploaded;
  }

  private validate(file: Express.Multer.File, folder: string) {
    if (file.size > MAX_IMAGE_BYTES) {
      throw new BadRequestException(
        this.i18n.t('upload.TOO_LARGE', {
          args: { max: Math.floor(MAX_IMAGE_BYTES / 1024 / 1024) },
        }),
      );
    }

    const format = detectImageFormat(file.buffer);
    if (!format) {
      throw new BadRequestException(
        this.i18n.t('upload.NOT_AN_IMAGE', {
          args: { types: SUPPORTED_IMAGE_TYPES },
        }),
      );
    }

    return {
      key: `${folder}/${randomUUID()}.${format.extension}`,
      buffer: file.buffer,
      mimeType: format.mimeType,
    };
  }
}
