import { ProductService } from '../product/product.service';
import { ProductGrpcService } from './product.grpc.service';

function build() {
  const products = { findOne: jest.fn(), checkStock: jest.fn() };

  return {
    products,
    service: new ProductGrpcService(products as unknown as ProductService),
  };
}

describe('ProductGrpcService', () => {
  it('asks for the public view, not the admin one', async () => {
    // An internal service is not an admin: a draft or soft-deleted product is
    // as invisible here as it is to a customer.
    const { service, products } = build();
    products.findOne.mockResolvedValue({
      id: 'p-1',
      name: 'Bàn phím',
      price: 617.2,
      quantity: 5,
      status: 'ACTIVE',
    });

    const result = await service.getProduct({ id: 'p-1' });

    expect(products.findOne).toHaveBeenCalledWith('p-1', true);
    expect(result).toEqual({
      id: 'p-1',
      name: 'Bàn phím',
      price: '617.20',
      quantity: 5,
      status: 'ACTIVE',
    });
  });

  it('forwards the requested lines to the service', async () => {
    const { service, products } = build();
    products.checkStock.mockResolvedValue({ allAvailable: true, lines: [] });

    await service.checkStock({
      items: [{ productId: 'p-1', quantity: 2 }],
    });

    expect(products.checkStock).toHaveBeenCalledWith([
      { productId: 'p-1', quantity: 2 },
    ]);
  });

  it('survives a request that carries no items field at all', async () => {
    // `defaults: true` makes proto-loader hand over [], but a hand-rolled
    // client on the other side is not obliged to send the field.
    const { service, products } = build();
    products.checkStock.mockResolvedValue({ allAvailable: false, lines: [] });

    await service.checkStock({
      items: undefined as unknown as [],
    });

    expect(products.checkStock).toHaveBeenCalledWith([]);
  });
});
