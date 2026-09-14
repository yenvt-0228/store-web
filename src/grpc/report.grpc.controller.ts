import { Controller, UseFilters, UseGuards } from '@nestjs/common';
import { GrpcMethod } from '@nestjs/microservices';
import { Observable } from 'rxjs';
import { GrpcExceptionFilter } from './grpc-exception.filter';
import { GrpcInternalGuard } from './grpc-internal.guard';
import { ReportGrpcService } from './report.grpc.service';
import type { ReportProgress, WatchReportRequest } from './grpc.interface';

@UseGuards(GrpcInternalGuard)
@UseFilters(GrpcExceptionFilter)
@Controller()
export class ReportGrpcController {
  constructor(private readonly reports: ReportGrpcService) {}

  /**
   * Streams the progress of one export until it finishes.
   *
   * Returning an `Observable` is how Nest expresses a server-streaming rpc:
   * every `next` is one message on the wire and `complete` closes the stream.
   *
   * @param request - Id of the job to follow.
   * @returns A stream of progress messages, ending when the job settles.
   */
  @GrpcMethod('ReportService', 'WatchReport')
  watchReport(request: WatchReportRequest): Observable<ReportProgress> {
    return this.reports.watchReport(request);
  }
}
