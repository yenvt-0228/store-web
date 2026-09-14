import { NotFoundException } from '@nestjs/common';
import { ReportService } from '../report/report.service';
import { ReportJobStatus } from '../report/report.interface';
import { REPORT_WATCH_POLL_MS, REPORT_WATCH_TIMEOUT_MS } from './grpc.constant';
import { ReportGrpcService } from './report.grpc.service';
import type { ReportProgress } from './grpc.interface';

function status(overrides: Partial<ReportJobStatus> = {}): ReportJobStatus {
  return {
    jobId: '7',
    state: 'active',
    progress: 40,
    result: null,
    failedReason: null,
    ...overrides,
  };
}

function build() {
  const reports = { status: jest.fn() };
  const service = new ReportGrpcService(reports as unknown as ReportService);
  jest.spyOn(service['logger'], 'warn').mockImplementation(() => undefined);

  return { reports, service };
}

/** Subscribes and collects everything the stream produces. */
function collect(stream: ReturnType<ReportGrpcService['watchReport']>) {
  const seen: ReportProgress[] = [];
  let completed = false;
  let failed: unknown;

  const subscription = stream.subscribe({
    next: (message) => seen.push(message),
    complete: () => (completed = true),
    error: (error: unknown) => (failed = error),
  });

  return {
    seen,
    subscription,
    get completed() {
      return completed;
    },
    get failed() {
      return failed;
    },
  };
}

describe('ReportGrpcService.watchReport', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('emits the first state without waiting a full poll interval', async () => {
    // A job that already finished should answer immediately, not a second later.
    const { service, reports } = build();
    reports.status.mockResolvedValue(status({ state: 'active' }));

    const run = collect(service.watchReport({ jobId: '7' }));
    await jest.advanceTimersByTimeAsync(0);

    expect(run.seen).toHaveLength(1);
    run.subscription.unsubscribe();
  });

  it('sends a message only when something actually changed', async () => {
    // A job sitting at `active` for a minute is one message, not sixty.
    const { service, reports } = build();
    reports.status.mockResolvedValue(status({ state: 'active', progress: 40 }));

    const run = collect(service.watchReport({ jobId: '7' }));
    await jest.advanceTimersByTimeAsync(REPORT_WATCH_POLL_MS * 5);

    expect(run.seen).toHaveLength(1);
    run.subscription.unsubscribe();
  });

  it('streams each change and closes when the job completes', async () => {
    const { service, reports } = build();
    reports.status
      .mockResolvedValueOnce(status({ state: 'active', progress: 40 }))
      .mockResolvedValueOnce(status({ state: 'active', progress: 80 }))
      .mockResolvedValue(
        status({
          state: 'completed',
          progress: 100,
          result: {
            objectKey: 'reports/orders-1.xlsx',
            rows: 12,
            bytes: 900,
            buildMs: 5,
            truncated: false,
          },
        }),
      );

    const run = collect(service.watchReport({ jobId: '7' }));
    await jest.advanceTimersByTimeAsync(REPORT_WATCH_POLL_MS * 3);

    expect(run.seen.map((m) => m.progress)).toEqual([40, 80, 100]);
    expect(run.seen[2].objectKey).toBe('reports/orders-1.xlsx');
    expect(run.completed).toBe(true);
  });

  it('closes on a failed job too, carrying the reason', async () => {
    const { service, reports } = build();
    reports.status.mockResolvedValue(
      status({ state: 'failed', failedReason: 'S3 refused the upload' }),
    );

    const run = collect(service.watchReport({ jobId: '7' }));
    await jest.advanceTimersByTimeAsync(0);

    expect(run.seen[0].failedReason).toBe('S3 refused the upload');
    expect(run.completed).toBe(true);
  });

  it('fills the proto3 defaults in place of nulls', async () => {
    // The message has no null: an unfinished job reports "" and 0, not
    // undefined, or the client reads a field that is not there.
    const { service, reports } = build();
    reports.status.mockResolvedValue(status());

    const run = collect(service.watchReport({ jobId: '7' }));
    await jest.advanceTimersByTimeAsync(0);

    expect(run.seen[0]).toEqual({
      jobId: '7',
      state: 'active',
      progress: 40,
      objectKey: '',
      rows: 0,
      truncated: false,
      failedReason: '',
    });
    run.subscription.unsubscribe();
  });

  it('errors the stream when the job is unknown', async () => {
    const { service, reports } = build();
    reports.status.mockRejectedValue(new NotFoundException('no such job'));

    const run = collect(service.watchReport({ jobId: 'nope' }));
    await jest.advanceTimersByTimeAsync(0);

    expect(run.failed).toBeInstanceOf(NotFoundException);
  });

  it('stops polling once the client hangs up', async () => {
    // The one that matters: without teardown a disconnected client leaves an
    // interval hammering Redis for as long as the process lives.
    const { service, reports } = build();
    reports.status.mockResolvedValue(status());

    const run = collect(service.watchReport({ jobId: '7' }));
    await jest.advanceTimersByTimeAsync(0);
    const callsWhileConnected = reports.status.mock.calls.length;

    run.subscription.unsubscribe();
    await jest.advanceTimersByTimeAsync(REPORT_WATCH_POLL_MS * 10);

    expect(reports.status).toHaveBeenCalledTimes(callsWhileConnected);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('gives up on a job that never settles, without failing the call', async () => {
    // complete(), not error(): everything already sent was true and the job may
    // still finish. The client can call again.
    const { service, reports } = build();
    reports.status.mockResolvedValue(status({ state: 'active' }));

    const run = collect(service.watchReport({ jobId: '7' }));
    await jest.advanceTimersByTimeAsync(REPORT_WATCH_TIMEOUT_MS + 1);

    expect(run.completed).toBe(true);
    expect(run.failed).toBeUndefined();
    expect(jest.getTimerCount()).toBe(0);
  });
});
