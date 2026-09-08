import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../upload/storage.service';
import { OrderReportSource } from './order-report.source';
import { ReportProcessor } from './report.processor';
import { OrderReportPayload, OrderReportRow } from './report.interface';
import { XlsxThreadRunner } from './xlsx-thread.runner';

type Deps = {
  source: { collect: jest.Mock };
  xlsx: { run: jest.Mock };
  storage: { put: jest.Mock };
  prisma: { uploadedObject: { create: jest.Mock } };
};

function row(): OrderReportRow {
  return {
    orderCode: 'DH-001',
    createdAt: '2026-09-07T03:00:00.000Z',
    status: 'CONFIRMED',
    paymentStatus: 'PAID',
    paymentMethod: 'COD',
    customerName: 'Nguyễn Văn A',
    customerEmail: 'a@example.com',
    shippingPhone: '0900000000',
    shippingAddress: '1 Đường A, Quận 1',
    itemCount: 2,
    totalAmount: 1234.56,
  };
}

function build(): { processor: ReportProcessor; deps: Deps } {
  const deps: Deps = {
    source: { collect: jest.fn() },
    xlsx: { run: jest.fn() },
    storage: { put: jest.fn() },
    prisma: { uploadedObject: { create: jest.fn() } },
  };

  const processor = new ReportProcessor(
    deps.source as unknown as OrderReportSource,
    deps.xlsx as unknown as XlsxThreadRunner,
    deps.storage as unknown as StorageService,
    deps.prisma as unknown as PrismaService,
  );

  return { processor, deps };
}

// Only the fields the processor reads; a real Job carries far more.
function job(overrides: Partial<Job<OrderReportPayload>> = {}) {
  return {
    id: '7',
    data: { requestedBy: 'admin-1' },
    attemptsMade: 0,
    opts: { attempts: 3 },
    updateProgress: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as Job<OrderReportPayload>;
}

describe('ReportProcessor', () => {
  let warn: jest.SpyInstance;
  let error: jest.SpyInstance;

  beforeEach(() => {
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    error = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    jest.spyOn(Logger.prototype, 'log').mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('process', () => {
    it('returns the object key and counters after all three stages', async () => {
      const { processor, deps } = build();
      deps.source.collect.mockResolvedValue({
        rows: [row()],
        truncated: false,
      });
      deps.xlsx.run.mockResolvedValue({
        buffer: Buffer.alloc(64),
        buildMs: 12,
      });
      deps.storage.put.mockResolvedValue('https://cdn/x.xlsx');

      const result = await processor.process(job());

      expect(result).toMatchObject({
        rows: 1,
        bytes: 64,
        buildMs: 12,
        truncated: false,
      });
      expect(result.objectKey).toMatch(/^reports\/orders-[0-9a-f-]+\.xlsx$/);
      // The row must exist for ImageCleanupService to purge the file later.
      expect(deps.prisma.uploadedObject.create).toHaveBeenCalledWith({
        data: { objectKey: result.objectKey, url: 'https://cdn/x.xlsx' },
      });
    });

    it.each([
      ['collect', (d: Deps) => d.source.collect],
      ['xlsx.run', (d: Deps) => d.xlsx.run],
      ['storage.put', (d: Deps) => d.storage.put],
    ])(
      'rethrows a %s failure so BullMQ can retry, and logs it as a warning not an error',
      async (_stage, pick) => {
        const { processor, deps } = build();
        deps.source.collect.mockResolvedValue({
          rows: [row()],
          truncated: false,
        });
        deps.xlsx.run.mockResolvedValue({
          buffer: Buffer.alloc(8),
          buildMs: 1,
        });
        deps.storage.put.mockResolvedValue('https://cdn/x.xlsx');
        pick(deps).mockRejectedValue(new Error('boom'));

        await expect(processor.process(job())).rejects.toThrow('boom');

        // A retryable failure must not be reported at error level.
        expect(error).not.toHaveBeenCalled();
        expect(warn).toHaveBeenCalledWith(
          expect.stringContaining('failed attempt 1/3'),
        );
      },
    );

    it('warns when the row limit truncated the report', async () => {
      const { processor, deps } = build();
      deps.source.collect.mockResolvedValue({ rows: [row()], truncated: true });
      deps.xlsx.run.mockResolvedValue({ buffer: Buffer.alloc(8), buildMs: 1 });
      deps.storage.put.mockResolvedValue('https://cdn/x.xlsx');

      const result = await processor.process(job());

      expect(result.truncated).toBe(true);
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('hit the row limit'),
      );
    });

    it('does not upload anything when building the file failed', async () => {
      const { processor, deps } = build();
      deps.source.collect.mockResolvedValue({
        rows: [row()],
        truncated: false,
      });
      deps.xlsx.run.mockRejectedValue(new Error('thread died'));

      await expect(processor.process(job())).rejects.toThrow('thread died');

      expect(deps.storage.put).not.toHaveBeenCalled();
      expect(deps.prisma.uploadedObject.create).not.toHaveBeenCalled();
    });
  });

  describe('onFailed', () => {
    it('stays silent while BullMQ still has retries left', () => {
      const { processor } = build();

      // BullMQ increments attemptsMade before emitting, and leaves finishedOn
      // unset because the job went back to delayed for another attempt.
      processor.onFailed(
        job({ attemptsMade: 1, finishedOn: undefined }),
        new Error('transient'),
      );

      expect(error).not.toHaveBeenCalled();
    });

    it('logs an error once BullMQ has exhausted every attempt', () => {
      const { processor } = build();

      processor.onFailed(
        job({ attemptsMade: 3, finishedOn: Date.now() }),
        new Error('gave up'),
      );

      expect(error).toHaveBeenCalledWith(
        expect.stringContaining('failed for good after 3/3'),
      );
    });

    it('logs an unrecoverable first failure, which ends the job with attempts to spare', () => {
      const { processor } = build();

      // finishedOn is stamped even though attemptsMade (1) is below attempts
      // (3): an UnrecoverableError skips the remaining retries.
      processor.onFailed(
        job({ attemptsMade: 1, finishedOn: Date.now() }),
        new Error('unrecoverable'),
      );

      expect(error).toHaveBeenCalledWith(
        expect.stringContaining('failed for good after 1/3'),
      );
    });

    it('logs a failure that arrives without a job', () => {
      const { processor } = build();

      processor.onFailed(undefined, new Error('no job'));

      expect(error).toHaveBeenCalledWith(expect.stringContaining('no job'));
    });
  });

  describe('onStalled', () => {
    it('logs a stalled job, which never reaches the failed event', () => {
      const { processor } = build();

      processor.onStalled('7');

      expect(error).toHaveBeenCalledWith(expect.stringContaining('job#7'));
    });
  });
});
