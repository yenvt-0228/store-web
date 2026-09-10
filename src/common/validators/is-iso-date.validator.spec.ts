import { validate } from 'class-validator';
import { OrderReportDto } from '../../report/dto/order-report.dto';

async function errorsFor(value: string): Promise<string[]> {
  const dto = new OrderReportDto();
  dto.to = value;
  const errors = await validate(dto);
  return errors.flatMap((error) => Object.keys(error.constraints ?? {}));
}

describe('IsIsoDate on OrderReportDto', () => {
  it.each([
    '2026-12-31',
    '2026-12-31T10:30',
    '2026-12-31 10:30:00',
    '2024-02-29',
  ])('accepts %s', async (value) => {
    expect(await errorsFor(value)).toEqual([]);
  });

  it.each([
    // Matches the regex, but `Date` rolls it over to 3 March instead of
    // refusing — the whole reason this validator exists.
    '2026-02-31',
    // Not a leap year.
    '2027-02-29',
    '2026-04-31',
  ])('rejects %s, which the shape check alone lets through', async (value) => {
    expect(await errorsFor(value)).toContain('IsIsoDate');
  });

  it('rejects month 13 at the shape check as well', async () => {
    expect(await errorsFor('2026-13-45')).toEqual(
      expect.arrayContaining(['IsIsoDate']),
    );
  });
});
