import {
  registerDecorator,
  ValidationOptions,
  ValidationArguments,
} from 'class-validator';
import { parseIsoBoundary } from '../utils/date.util';

/**
 * Rejects a date string that looks right but names a day that does not exist.
 *
 * `@Matches` can only check the shape, and `Date` accepts 2026-02-31 by rolling
 * it over to 3 March. Without this the request is accepted, the job runs, and
 * the report quietly covers three days more than asked for — or, for something
 * like month 13, the job fails three times over deep inside Prisma with an
 * error that names neither the field nor the value.
 *
 * @param validationOptions - Standard class-validator options.
 * @returns The property decorator.
 */
export function IsIsoDate(validationOptions?: ValidationOptions) {
  return (object: object, propertyName: string) => {
    registerDecorator({
      name: 'IsIsoDate',
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate(value: unknown): boolean {
          // Only the shape this validator understands; `@IsOptional` and
          // `@Matches` cover the rest.
          return typeof value === 'string' && parseIsoBoundary(value) !== null;
        },
        defaultMessage(args: ValidationArguments): string {
          return `${args.property} must be a real calendar date`;
        },
      },
    });
  };
}
