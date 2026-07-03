import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private transporter: nodemailer.Transporter | null = null;

  constructor(private config: ConfigService) {
    const host = this.config.get('SMTP_HOST');
    const user = this.config.get('SMTP_USER');
    const pass = this.config.get('SMTP_PASS');

    if (host && user && pass) {
      this.transporter = nodemailer.createTransport({
        host,
        port: Number(this.config.get('SMTP_PORT') || 587),
        secure: false,
        auth: { user, pass },
      });
    }
  }

  async sendMail(to: string, subject: string, html: string) {
    const from = this.config.get('SMTP_USER') || 'noreply@musicroom.app';

    if (!this.transporter) {
      this.logger.warn(`Mail not configured. Would send to ${to}: ${subject}`);
      this.logger.warn(html);
      return;
    }

    await this.transporter.sendMail({ from, to, subject, html });
  }

  async sendVerificationEmail(to: string, token: string) {
    const appUrl = this.config.get('APP_URL') || 'http://localhost:3000';
    const link = `${appUrl}/api/auth/verify-email?token=${token}`;
    await this.sendMail(
      to,
      'Verify your Music Room email',
      `<p>Click to verify: <a href="${link}">${link}</a></p><p>Or use token: <code>${token}</code></p>`,
    );
  }

  async sendPasswordResetEmail(to: string, token: string) {
    const appUrl = this.config.get('APP_URL') || 'http://localhost:3000';
    const link = `${appUrl}/reset-password?token=${token}`;
    await this.sendMail(
      to,
      'Reset your Music Room password',
      `<p>Click to reset: <a href="${link}">${link}</a></p><p>Or use token: <code>${token}</code></p>`,
    );
  }
}
