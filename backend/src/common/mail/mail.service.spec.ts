import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { MailService } from './mail.service';

jest.mock('nodemailer', () => ({
  createTransport: jest.fn(() => ({
    sendMail: jest.fn().mockResolvedValue({ messageId: '1' }),
  })),
}));

describe('MailService', () => {
  let service: MailService;

  const buildService = async (config: Record<string, string>) => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MailService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => config[key]),
          },
        },
      ],
    }).compile();
    return module.get(MailService);
  };

  it('sendVerificationEmail logs when SMTP not configured', async () => {
    service = await buildService({ APP_URL: 'http://localhost:3000' });
    const warnSpy = jest.spyOn(service['logger'], 'warn');
    await service.sendVerificationEmail('test@example.com', 'token123');
    expect(warnSpy).toHaveBeenCalled();
  });

  it('sendPasswordResetEmail logs when SMTP not configured', async () => {
    service = await buildService({ APP_URL: 'http://localhost:3000' });
    const warnSpy = jest.spyOn(service['logger'], 'warn');
    await service.sendPasswordResetEmail('test@example.com', 'token456');
    expect(warnSpy).toHaveBeenCalled();
  });

  it('sendMail uses transporter when configured', async () => {
    service = await buildService({
      SMTP_HOST: 'smtp.test.com',
      SMTP_USER: 'user@test.com',
      SMTP_PASS: 'pass',
      SMTP_PORT: '587',
    });
    await service.sendMail('to@test.com', 'Subject', '<p>Hi</p>');
    const nodemailer = require('nodemailer');
    expect(nodemailer.createTransport).toHaveBeenCalled();
  });
});
