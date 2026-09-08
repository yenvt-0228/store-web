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
import { XLSX_MIME } from './report.constant';
import { ReportService } from './report.service';

@ApiTags('admin/reports')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(RoleName.ADMIN)
@Controller('admin/reports')
export class ReportController {
  constructor(private reportService: ReportService) {}

  @ApiOperation({
    summary: 'Đặt hàng đợi xuất báo cáo đơn hàng (.xlsx) — trả về jobId ngay',
  })
  @Post('orders')
  @HttpCode(HttpStatus.ACCEPTED)
  request(@Body() dto: OrderReportDto, @CurrentUser() user: AuthUser) {
    return this.reportService.requestOrderReport(dto, user.id);
  }

  @ApiOperation({ summary: 'Trạng thái job xuất báo cáo' })
  @Get('orders/:jobId')
  status(@Param('jobId') jobId: string) {
    return this.reportService.status(jobId);
  }

  // Tải qua API chứ không phát URL storage: file chứa email/điện thoại/địa chỉ
  // của mọi khách hàng, phải đi qua guard ADMIN mới lấy được.
  @ApiOperation({ summary: 'Tải file báo cáo (.xlsx) khi job đã xong' })
  @Get('orders/:jobId/download')
  async download(@Param('jobId') jobId: string): Promise<StreamableFile> {
    const { buffer, filename } = await this.reportService.download(jobId);

    return new StreamableFile(buffer, {
      type: XLSX_MIME,
      disposition: `attachment; filename="${filename}"`,
    });
  }
}
