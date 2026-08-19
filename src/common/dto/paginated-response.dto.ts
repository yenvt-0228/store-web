export class PaginationMetaDto {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export class PaginatedResponseDto<T> {
  data: T[];
  meta: PaginationMetaDto;
}

export function paginated<T>(
  data: T[],
  total: number,
  page = 1,
  limit = 10,
): PaginatedResponseDto<T> {
  return {
    data,
    meta: {
      total,
      page,
      limit,
      totalPages: limit > 0 ? Math.ceil(total / limit) : 0,
    },
  };
}
