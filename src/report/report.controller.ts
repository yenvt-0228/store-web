import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '../auth/current-user.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RoleName } from '../common/constants/role.constant';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { OrderReportDto } from './dto/order-report.dto';
import { ReportService } from './report.service';

@ApiTags('admin/reports')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(RoleName.ADMIN)
@Controller('admin/reports')
export class ReportController {
  constructor(private readonly reportService: ReportService) {}

  /**
   * Queues an orders export and answers 202 without waiting for the file.
   *
   * @param dto - Date range and status filters for the export.
   * @param user - The authenticated admin, recorded on the job.
   * @returns The id of the queued job.
   */
  @ApiOperation({
    summary: 'Đặt hàng đợi xuất báo cáo đơn hàng (.xlsx) — trả về jobId ngay',
  })
  @Post('orders')
  @HttpCode(HttpStatus.ACCEPTED)
  request(
    @Body() dto: OrderReportDto,
    @CurrentUser() user: AuthUser,
  ): Promise<{ jobId: string }> {
    return this.reportService.requestOrderReport(dto, user.id);
  }

  /**
   * Reports the progress of a queued export.
   *
   * @param jobId - Job id returned when the export was requested.
   * @returns State, progress, result and failure reason of the job.
   */
  @ApiOperation({ summary: 'Trạng thái job xuất báo cáo' })
  @Get('orders/:jobId')
  status(@Param('jobId') jobId: string) {
    return this.reportService.status(jobId);
  }

  /**
   * Downloads the finished report file.
   *
   * @param jobId - Job id of a completed export.
   * @returns The xlsx file as a downloadable attachment.
   */
  @ApiOperation({ summary: 'Tải file báo cáo (.xlsx) khi job đã xong' })
  @Get('orders/:jobId/download')
  download(@Param('jobId') jobId: string): Promise<StreamableFile> {
    return this.reportService.download(jobId);
  }
}
