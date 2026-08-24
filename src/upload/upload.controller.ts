import {
  Controller,
  Post,
  UploadedFile,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor, FilesInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RoleName } from '../common/constants/role.constant';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { MAX_IMAGE_BYTES, UploadService } from './upload.service';

const MAX_FILES_PER_REQUEST = 10;

const IMAGE_LIMITS = {
  limits: { fileSize: MAX_IMAGE_BYTES, files: MAX_FILES_PER_REQUEST },
};

@ApiTags('uploads')
@Controller()
export class UploadController {
  constructor(private uploadService: UploadService) {}

  @ApiOperation({
    summary: 'Upload ảnh sản phẩm (admin), tối đa 10 file — trả về URL',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        files: { type: 'array', items: { type: 'string', format: 'binary' } },
      },
    },
  })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(RoleName.ADMIN)
  @UseInterceptors(
    FilesInterceptor('files', MAX_FILES_PER_REQUEST, IMAGE_LIMITS),
  )
  @Post('admin/uploads/images')
  async uploadProductImages(@UploadedFiles() files: Express.Multer.File[]) {
    return { images: await this.uploadService.uploadImages(files, 'products') };
  }

  @ApiOperation({
    summary: 'Upload ảnh đại diện — trả về URL để PATCH /users/me',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(FileInterceptor('file', IMAGE_LIMITS))
  @Post('uploads/avatar')
  async uploadAvatar(@UploadedFile() file: Express.Multer.File) {
    const [image] = await this.uploadService.uploadImages(
      file ? [file] : [],
      'avatars',
    );
    return { image };
  }
}
