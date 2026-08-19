import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { MAIL_QUEUE, MailPayload } from './mail.constant';
import { MailService } from './mail.service';

@Processor(MAIL_QUEUE)
export class MailProcessor extends WorkerHost {
  private readonly logger = new Logger(MailProcessor.name);

  constructor(private mailService: MailService) {
    super();
  }

  async process(job: Job<MailPayload>): Promise<void> {
    await this.mailService.send(job.data);
    this.logger.log(`Đã gửi mail job#${job.id} tới ${job.data.to}`);
  }
}
