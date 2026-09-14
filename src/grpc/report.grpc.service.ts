import { Injectable, Logger } from '@nestjs/common';
import { Observable } from 'rxjs';
import { ReportJobStatus } from '../report/report.interface';
import { ReportService } from '../report/report.service';
import { REPORT_WATCH_POLL_MS, REPORT_WATCH_TIMEOUT_MS } from './grpc.constant';
import type { ReportProgress, WatchReportRequest } from './grpc.interface';

// States BullMQ never leaves on its own. Reaching one ends the stream.
const TERMINAL_STATES = new Set(['completed', 'failed']);

/**
 * @param status - Job state as the report service reports it.
 * @returns The same thing shaped as a proto message, with proto3 defaults
 * ("" and 0) standing in for the nulls the message cannot express.
 */
function toProgress(status: ReportJobStatus): ReportProgress {
  return {
    jobId: status.jobId,
    state: status.state,
    progress: status.progress,
    objectKey: status.result?.objectKey ?? '',
    rows: status.result?.rows ?? 0,
    truncated: status.result?.truncated ?? false,
    failedReason: status.failedReason ?? '',
  };
}

/**
 * The polling behind the `WatchReport` stream.
 *
 * Kept out of the controller because it is the least trivial thing on this
 * transport — a timer, a deadline and a teardown — and none of it is about
 * gRPC as such: the controller only has to hand the `Observable` back, which is
 * how Nest expresses a server-streaming rpc.
 */
@Injectable()
export class ReportGrpcService {
  private readonly logger = new Logger(ReportGrpcService.name);

  constructor(private readonly reports: ReportService) {}

  /**
   * Streams the progress of one export until it finishes.
   *
   * This still polls Redis underneath — BullMQ has no push for job state that
   * survives more than one process — but it polls once per job instead of once
   * per client, and the client gets each change as it happens rather than on
   * its next tick. Duplicate states are not re-sent: a job sitting at `active`
   * for a minute produces one message, not sixty.
   *
   * @param request - Id of the job to follow.
   * @returns A stream of progress messages, ending when the job settles.
   */
  watchReport(request: WatchReportRequest): Observable<ReportProgress> {
    return new Observable<ReportProgress>((subscriber) => {
      let lastSent = '';
      let closed = false;
      let polling = false;

      const finish = (fn: () => void) => {
        if (closed) return;
        closed = true;
        fn();
      };

      const tick = async (): Promise<void> => {
        // A slow Redis must not let two polls overlap and emit out of order.
        if (polling || closed) return;
        polling = true;

        try {
          const status = await this.reports.status(request.jobId);
          const message = toProgress(status);
          const fingerprint = JSON.stringify(message);

          // Only on change: the client asked to be told when something happens,
          // not to be told every second that nothing has.
          if (fingerprint !== lastSent) {
            lastSent = fingerprint;
            subscriber.next(message);
          }

          if (TERMINAL_STATES.has(status.state)) {
            finish(() => subscriber.complete());
          }
        } catch (error) {
          // Errors travel through the filter, which turns a NotFoundException
          // into NOT_FOUND rather than a stream that just stops.
          finish(() => subscriber.error(error));
        } finally {
          polling = false;
        }
      };

      const timer = setInterval(() => void tick(), REPORT_WATCH_POLL_MS);
      // Don't make the caller wait a full interval for the first answer — a job
      // that is already finished should complete immediately.
      void tick();

      const deadline = setTimeout(() => {
        this.logger.warn(
          `WatchReport gave up on job#${request.jobId} after ${REPORT_WATCH_TIMEOUT_MS / 1000}s.`,
        );
        // complete(), not error(): everything sent so far was true, and the job
        // may well still finish. The client can call again.
        finish(() => subscriber.complete());
      }, REPORT_WATCH_TIMEOUT_MS);

      // Teardown runs on complete, on error, AND when the client hangs up. This
      // is the part that is easy to forget and expensive to miss: without it a
      // disconnected client leaves an interval polling Redis forever.
      return () => {
        closed = true;
        clearInterval(timer);
        clearTimeout(deadline);
      };
    });
  }
}
