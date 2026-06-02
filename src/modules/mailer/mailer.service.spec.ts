import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { EmailTemplateService } from './email-template.service';
import { MailerService } from './mailer.service';

describe('MailerService', () => {
  let service: MailerService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MailerService,
        {
          provide: 'MAILER',
          useValue: { email: { send: jest.fn() } },
        },
        {
          provide: ConfigService,
          useValue: { get: jest.fn() },
        },
        {
          provide: EmailTemplateService,
          useValue: {
            shouldWrap: jest.fn().mockReturnValue(false),
            wrapBody: jest.fn((html: string) => html),
          },
        },
      ],
    }).compile();

    service = module.get<MailerService>(MailerService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
