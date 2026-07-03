import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateProfileDto } from './dto/users.dto';

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  private sanitize(user: any) {
    const { passwordHash, verifyToken, resetToken, resetTokenExp, ...rest } =
      user;
    return rest;
  }

  async getMe(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { subscription: true },
    });
    if (!user) throw new NotFoundException();
    return this.sanitize(user);
  }

  async updateMe(userId: string, dto: UpdateProfileDto) {
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: {
        name: dto.name,
        avatar: dto.avatar,
        publicInfo: dto.publicInfo,
        friendsInfo: dto.friendsInfo,
        privateInfo: dto.privateInfo,
        musicPrefs: dto.musicPrefs,
      },
    });
    return this.sanitize(user);
  }

  async getPublicProfile(userId: string, requesterId?: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });
    if (!user) throw new NotFoundException();

    const base: any = {
      id: user.id,
      name: user.name,
      avatar: user.avatar,
      publicInfo: user.publicInfo,
      musicPrefs: user.musicPrefs,
    };

    if (requesterId) {
      const friendship = await this.prisma.friendship.findFirst({
        where: {
          status: 'accepted',
          OR: [
            { requesterId, addresseeId: userId },
            { requesterId: userId, addresseeId: requesterId },
          ],
        },
      });
      if (friendship) {
        base.friendsInfo = user.friendsInfo;
      }
    }

    return base;
  }

  async search(query: string, limit = 20) {
    const users = await this.prisma.user.findMany({
      where: {
        name: { contains: query, mode: 'insensitive' },
      },
      select: { id: true, name: true, avatar: true },
      take: limit,
    });
    return users;
  }
}
