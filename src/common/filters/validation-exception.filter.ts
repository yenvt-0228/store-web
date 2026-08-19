import { ArgumentsHost, Catch } from '@nestjs/common';
import {
  I18nValidationException,
  I18nValidationExceptionFilter,
} from 'nestjs-i18n';

@Catch(I18nValidationException)
export class ValidationExceptionFilter extends I18nValidationExceptionFilter {
  protected buildResponseBody(
    _host: ArgumentsHost,
    _exc: I18nValidationException,
    errors: string[] | object,
  ): Record<string, unknown> {
    // với detailedErrors:false -> errors là string[]
    const body = Array.isArray(errors) ? errors : [errors];
    return { errors: { body } };
  }
}
