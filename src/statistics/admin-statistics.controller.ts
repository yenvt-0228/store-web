import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RoleName } from '../common/constants/role.constant';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { RevenueMonthlyDto, RevenueYearlyDto } from './dto/revenue-query.dto';
import { StatisticsRangeDto, TopProductsDto } from './dto/statistics-range.dto';
import { StatisticsService } from './statistics.service';

@ApiTags('admin/statistics')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(RoleName.ADMIN)
@Controller('admin/statistics')
export class AdminStatisticsController {
  constructor(private statisticsService: StatisticsService) {}

  @ApiOperation({ summary: 'Tổng quan: doanh thu, đơn, khách mới' })
  @Get('dashboard')
  dashboard(@Query() query: StatisticsRangeDto) {
    return this.statisticsService.dashboard(query);
  }

  @ApiOperation({ summary: 'Sản phẩm bán chạy theo doanh thu' })
  @Get('top-products')
  topProducts(@Query() query: TopProductsDto) {
    return this.statisticsService.topProducts(query);
  }

  @ApiOperation({ summary: 'Doanh thu 12 tháng của một năm' })
  @Get('revenue/monthly')
  revenueMonthly(@Query() query: RevenueMonthlyDto) {
    return this.statisticsService.revenueByMonth(query);
  }

  @ApiOperation({ summary: 'Doanh thu theo năm' })
  @Get('revenue/yearly')
  revenueYearly(@Query() query: RevenueYearlyDto) {
    return this.statisticsService.revenueByYear(query);
  }

  @ApiOperation({ summary: 'Thống kê đơn hàng theo trạng thái' })
  @Get('orders')
  orders(@Query() query: StatisticsRangeDto) {
    return this.statisticsService.orders(query);
  }
}
