import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ProductService } from './product.service';

// Facebook cắt description quanh 200 ký tự, Twitter quanh 200. Cắt sẵn ở đây
// để chuỗi gửi đi là chuỗi thật sự hiện ra, không phải một đoạn bị bên kia cắt
// giữa từ.
const MAX_DESCRIPTION = 200;

const DEFAULT_SITE_NAME = 'Store Web';

@Injectable()
export class ProductShareService {
  constructor(
    private readonly products: ProductService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Dữ liệu để dựng thẻ Open Graph và link chia sẻ của một sản phẩm.
   *
   * Trả dữ liệu chứ không trả HTML: API này phục vụ frontend dựng thẻ `<meta>`
   * trong `<head>` của trang sản phẩm — đó mới là trang mà Facebook và Twitter
   * đi cào, chứ không phải endpoint này.
   *
   * @param id - Sản phẩm cần chia sẻ.
   * @returns Thẻ OG, thẻ Twitter và link chia sẻ dựng sẵn.
   * @throws {NotFoundException} Khi sản phẩm không tồn tại hoặc không công khai.
   */
  async shareInfo(id: string) {
    // publicOnly: sản phẩm nháp hoặc đã xoá mềm thì không có gì để chia sẻ, và
    // càng không nên lộ tên ra ngoài.
    const product = await this.products.findOne(id, true);

    const url = `${this.webUrl}/products/${product.id}`;
    const description = truncate(product.description ?? '', MAX_DESCRIPTION);

    return {
      url,
      openGraph: {
        'og:type': 'product',
        'og:title': product.name,
        'og:description': description,
        'og:url': url,
        'og:image': product.primaryImage ?? '',
        'og:site_name': this.siteName,
        // Giá nằm trong thẻ OG để Facebook hiện được nhãn giá trên thẻ xem
        // trước, thay vì chỉ có tiêu đề và ảnh.
        'product:price:amount': product.price.toFixed(2),
        'product:price:currency': 'VND',
        'product:availability': product.inStock ? 'in stock' : 'out of stock',
      },
      twitter: {
        'twitter:card': product.primaryImage
          ? 'summary_large_image'
          : 'summary',
        'twitter:title': product.name,
        'twitter:description': description,
        'twitter:image': product.primaryImage ?? '',
      },
      shareUrls: {
        facebook: `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`,
        twitter:
          `https://twitter.com/intent/tweet?url=${encodeURIComponent(url)}` +
          `&text=${encodeURIComponent(product.name)}`,
      },
    };
  }

  private get webUrl(): string {
    // FRONTEND_URL, không phải APP_URL: link chia sẻ phải mở ra trang sản phẩm
    // cho người dùng xem, không phải endpoint JSON của API.
    return (
      this.config.get<string>('FRONTEND_URL') ??
      this.config.get<string>('APP_URL') ??
      ''
    );
  }

  private get siteName(): string {
    return this.config.get<string>('APP_NAME') ?? DEFAULT_SITE_NAME;
  }
}

/**
 * @param text - Mô tả sản phẩm, có thể rỗng.
 * @param max - Số ký tự tối đa.
 * @returns Chuỗi đã cắt ở ranh giới từ gần nhất, kèm dấu lược.
 */
function truncate(text: string, max: number): string {
  const clean = text.replace(/\s+/g, ' ').trim();

  if (clean.length <= max) {
    return clean;
  }

  const cut = clean.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');

  // Cắt giữa từ trông như lỗi hiển thị; lùi về khoảng trắng gần nhất, trừ khi
  // cả đoạn không có khoảng trắng nào.
  return (lastSpace > 0 ? cut.slice(0, lastSpace) : cut) + '…';
}
