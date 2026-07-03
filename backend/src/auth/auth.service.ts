import {
  Injectable,
  BadRequestException,
  UnauthorizedException,
  ConflictException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../common/mail/mail.service';
import {
  RegisterDto,
  LoginDto,
  ForgotPasswordDto,
  ResetPasswordDto,
} from './dto/auth.dto';

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
    private config: ConfigService,
    private mail: MailService,
  ) {}

  private async generateTokens(userId: string, email: string) {
    const [accessToken, refreshToken] = await Promise.all([
      this.jwt.signAsync(
        { sub: userId, email },
        { secret: this.config.get('JWT_SECRET'), expiresIn: '15m' },
      ),
      this.jwt.signAsync(
        { sub: userId, email },
        { secret: this.config.get('JWT_REFRESH_SECRET'), expiresIn: '7d' },
      ),
    ]);
    return { accessToken, refreshToken };
  }

  private sanitizeUser(user: any) {
    const { passwordHash, verifyToken, resetToken, resetTokenExp, ...rest } =
      user;
    return rest;
  }

  async register(dto: RegisterDto) {
    const existing = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });
    if (existing) {
      throw new ConflictException('Email already registered');
    }

    const passwordHash = await bcrypt.hash(dto.password, 10);
    const verifyToken = crypto.randomBytes(32).toString('hex');

    const user = await this.prisma.user.create({
      data: {
        email: dto.email,
        passwordHash,
        name: dto.name,
        verifyToken,
      },
    });

    await this.prisma.subscription.create({
      data: { userId: user.id, plan: 'free' },
    });

    await this.mail.sendVerificationEmail(user.email, verifyToken);

    const tokens = await this.generateTokens(user.id, user.email);
    return { ...tokens, user: this.sanitizeUser(user) };
  }

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });
    if (!user || !user.passwordHash) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const valid = await bcrypt.compare(dto.password, user.passwordHash);
    if (!valid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const tokens = await this.generateTokens(user.id, user.email);
    return { ...tokens, user: this.sanitizeUser(user) };
  }

  async googleAuth(googleToken: string) {
    const res = await fetch(
      `https://www.googleapis.com/oauth2/v3/userinfo`,
      { headers: { Authorization: `Bearer ${googleToken}` } },
    );
    if (!res.ok) {
      throw new UnauthorizedException('Invalid Google token');
    }
    const profile = await res.json();

    let user = await this.prisma.user.findUnique({
      where: { googleId: profile.sub },
    });

    if (!user) {
      user = await this.prisma.user.findUnique({
        where: { email: profile.email },
      });
      if (user) {
        user = await this.prisma.user.update({
          where: { id: user.id },
          data: { googleId: profile.sub, emailVerified: true },
        });
      } else {
        user = await this.prisma.user.create({
          data: {
            email: profile.email,
            name: profile.name || profile.email,
            avatar: profile.picture,
            googleId: profile.sub,
            emailVerified: true,
          },
        });
        await this.prisma.subscription.create({
          data: { userId: user.id, plan: 'free' },
        });
      }
    }

    const tokens = await this.generateTokens(user.id, user.email);
    return { ...tokens, user: this.sanitizeUser(user) };
  }

  async facebookAuth(fbToken: string) {
    const res = await fetch(
      `https://graph.facebook.com/me?fields=id,name,email,picture&access_token=${fbToken}`,
    );
    if (!res.ok) {
      throw new UnauthorizedException('Invalid Facebook token');
    }
    const profile = await res.json();

    let user = await this.prisma.user.findUnique({
      where: { facebookId: profile.id },
    });

    if (!user) {
      if (profile.email) {
        user = await this.prisma.user.findUnique({
          where: { email: profile.email },
        });
      }
      if (user) {
        user = await this.prisma.user.update({
          where: { id: user.id },
          data: { facebookId: profile.id, emailVerified: true },
        });
      } else {
        user = await this.prisma.user.create({
          data: {
            email: profile.email || `${profile.id}@facebook.com`,
            name: profile.name,
            avatar: profile.picture?.data?.url,
            facebookId: profile.id,
            emailVerified: true,
          },
        });
        await this.prisma.subscription.create({
          data: { userId: user.id, plan: 'free' },
        });
      }
    }

    const tokens = await this.generateTokens(user.id, user.email);
    return { ...tokens, user: this.sanitizeUser(user) };
  }

  async verifyEmail(token: string) {
    const user = await this.prisma.user.findFirst({
      where: { verifyToken: token },
    });
    if (!user) {
      throw new BadRequestException('Invalid verification token');
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { emailVerified: true, verifyToken: null },
    });

    return { message: 'Email verified successfully' };
  }

  async forgotPassword(dto: ForgotPasswordDto) {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });
    if (!user) {
      return { message: 'If the email exists, a reset link was sent' };
    }

    const resetToken = crypto.randomBytes(32).toString('hex');
    const resetTokenExp = new Date(Date.now() + 3600000);

    await this.prisma.user.update({
      where: { id: user.id },
      data: { resetToken, resetTokenExp },
    });

    await this.mail.sendPasswordResetEmail(user.email, resetToken);

    return { message: 'If the email exists, a reset link was sent' };
  }

  async resetPassword(dto: ResetPasswordDto) {
    const user = await this.prisma.user.findFirst({
      where: {
        resetToken: dto.token,
        resetTokenExp: { gte: new Date() },
      },
    });
    if (!user) {
      throw new BadRequestException('Invalid or expired reset token');
    }

    const passwordHash = await bcrypt.hash(dto.newPassword, 10);

    await this.prisma.user.update({
      where: { id: user.id },
      data: { passwordHash, resetToken: null, resetTokenExp: null },
    });

    return { message: 'Password reset successfully' };
  }

  async refreshTokens(refreshToken: string) {
    try {
      const payload = await this.jwt.verifyAsync(refreshToken, {
        secret: this.config.get('JWT_REFRESH_SECRET'),
      });
      const user = await this.prisma.user.findUnique({
        where: { id: payload.sub },
      });
      if (!user) {
        throw new UnauthorizedException();
      }
      return this.generateTokens(user.id, user.email);
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }
  }

  async linkGoogle(userId: string, googleToken: string) {
    const res = await fetch(
      `https://www.googleapis.com/oauth2/v3/userinfo`,
      { headers: { Authorization: `Bearer ${googleToken}` } },
    );
    if (!res.ok) {
      throw new UnauthorizedException('Invalid Google token');
    }
    const profile = await res.json();

    const existing = await this.prisma.user.findUnique({
      where: { googleId: profile.sub },
    });
    if (existing && existing.id !== userId) {
      throw new ConflictException('Google account already linked to another user');
    }

    const user = await this.prisma.user.update({
      where: { id: userId },
      data: { googleId: profile.sub },
    });
    return this.sanitizeUser(user);
  }

  async linkFacebook(userId: string, fbToken: string) {
    const res = await fetch(
      `https://graph.facebook.com/me?fields=id&access_token=${fbToken}`,
    );
    if (!res.ok) {
      throw new UnauthorizedException('Invalid Facebook token');
    }
    const profile = await res.json();

    const existing = await this.prisma.user.findUnique({
      where: { facebookId: profile.id },
    });
    if (existing && existing.id !== userId) {
      throw new ConflictException('Facebook account already linked to another user');
    }

    const user = await this.prisma.user.update({
      where: { id: userId },
      data: { facebookId: profile.id },
    });
    return this.sanitizeUser(user);
  }
}
