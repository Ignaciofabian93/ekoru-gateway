import { PayloadTooLargeException } from '@nestjs/common';
import type { Request, Response } from 'express';
import { MAX_WEBHOOK_BYTES, PaymentsController } from './payments.controller';
import type { PaymentsService } from './payments.service';

/** TRX-25: the public webhook routes pass on only what a provider would send. */
describe('PaymentsController webhooks (TRX-25)', () => {
  const payments = { processWebhook: jest.fn().mockResolvedValue('ok') };
  const controller = new PaymentsController(
    payments as unknown as PaymentsService,
  );
  const response = () => {
    const res = { status: jest.fn(), json: jest.fn() };
    res.status.mockReturnValue(res);
    res.json.mockReturnValue(res);
    return res;
  };
  const request = (rawBody: string) =>
    ({ rawBody, query: {} }) as unknown as Request & { rawBody?: string };
  const notice = { type: 'payment', data: { id: '123' } };
  const oversized = 'x'.repeat(MAX_WEBHOOK_BYTES + 1);

  beforeEach(() => jest.clearAllMocks());

  it('passes a Mercado Pago notice on with what it signed', async () => {
    const res = response();
    const rawBody = JSON.stringify(notice);

    await controller.mercadoPagoWebhook(
      request(rawBody),
      res as unknown as Response,
      'ts=1,v1=abc',
      'req-1',
      notice,
    );

    expect(payments.processWebhook).toHaveBeenCalledWith(
      'MERCADOPAGO',
      'payment',
      notice,
      rawBody,
      'ts=1,v1=abc',
      { requestId: 'req-1', query: {} },
    );
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('answers 413 to a Mercado Pago body over 64 KB and passes nothing on', async () => {
    const res = response();

    await controller.mercadoPagoWebhook(
      request(oversized),
      res as unknown as Response,
      'ts=1,v1=abc',
      'req-1',
      notice,
    );

    expect(res.status).toHaveBeenCalledWith(413);
    expect(payments.processWebhook).not.toHaveBeenCalled();
  });

  it('answers 413 to a Khipu body over 64 KB and passes nothing on', async () => {
    await expect(
      controller.khipuWebhook(request(oversized), 'signature', notice),
    ).rejects.toBeInstanceOf(PayloadTooLargeException);
    expect(payments.processWebhook).not.toHaveBeenCalled();
  });

  it('counts bytes, not characters', async () => {
    const res = response();
    // 3 bytes each in UTF-8: under the limit in characters, over it in bytes.
    const multibyte = '€'.repeat(Math.ceil(MAX_WEBHOOK_BYTES / 3) + 1);

    await controller.mercadoPagoWebhook(
      request(multibyte),
      res as unknown as Response,
      'ts=1,v1=abc',
      'req-1',
      notice,
    );

    expect(res.status).toHaveBeenCalledWith(413);
  });
});
