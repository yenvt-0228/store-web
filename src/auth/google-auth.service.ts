import {
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OAuth2Client, TokenPayload } from 'google-auth-library';
import { I18nService } from 'nestjs-i18n';

export interface GoogleProfile {
  googleId: string;
  email: string;
  name: string;
  avatar: string | null;
}

@Injectable()
export class GoogleAuthService {
  private readonly logger = new Logger(GoogleAuthService.name);
  private readonly clientId: string;
  private readonly client: OAuth2Client;

  constructor(
    config: ConfigService,
    private i18n: I18nService,
  ) {
    this.clientId = config.get<string>('GOOGLE_CLIENT_ID') ?? '';
    this.client = new OAuth2Client(this.clientId);
  }

  async verifyIdToken(idToken: string): Promise<GoogleProfile> {
    if (!this.clientId) {
      throw new ServiceUnavailableException(
        this.i18n.t('auth.GOOGLE_NOT_CONFIGURED'),
      );
    }

    let payload: TokenPayload | undefined;

    try {
      const ticket = await this.client.verifyIdToken({
        idToken,
        audience: this.clientId,
      });
      payload = ticket.getPayload();
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.logger.warn(`verifyIdToken thất bại: ${reason.split(':')[0]}`);
      throw new UnauthorizedException(this.i18n.t('auth.GOOGLE_INVALID_TOKEN'));
    }

    if (!payload?.sub || !payload.email) {
      throw new UnauthorizedException(this.i18n.t('auth.GOOGLE_INVALID_TOKEN'));
    }

    if (!payload.email_verified) {
      throw new UnauthorizedException(
        this.i18n.t('auth.GOOGLE_EMAIL_UNVERIFIED'),
      );
    }

    return {
      googleId: payload.sub,
      email: payload.email.toLowerCase(),
      name: payload.name ?? payload.email,
      avatar: payload.picture ?? null,
    };
  }
}
