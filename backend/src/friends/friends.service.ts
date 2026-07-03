import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class FriendsService {
  constructor(private prisma: PrismaService) {}

  async sendRequest(requesterId: string, addresseeId: string) {
    if (requesterId === addresseeId) {
      throw new BadRequestException('Cannot send request to yourself');
    }

    const existing = await this.prisma.friendship.findFirst({
      where: {
        OR: [
          { requesterId, addresseeId },
          { requesterId: addresseeId, addresseeId: requesterId },
        ],
      },
    });

    if (existing) {
      if (existing.status === 'accepted') {
        throw new ConflictException('Already friends');
      }
      throw new ConflictException('Request already exists');
    }

    return this.prisma.friendship.create({
      data: { requesterId, addresseeId },
      include: {
        addressee: { select: { id: true, name: true, avatar: true } },
      },
    });
  }

  async acceptRequest(userId: string, requestId: string) {
    const friendship = await this.prisma.friendship.findUnique({
      where: { id: requestId },
    });
    if (!friendship || friendship.addresseeId !== userId) {
      throw new NotFoundException();
    }
    return this.prisma.friendship.update({
      where: { id: requestId },
      data: { status: 'accepted' },
      include: {
        requester: { select: { id: true, name: true, avatar: true } },
      },
    });
  }

  async rejectRequest(userId: string, requestId: string) {
    const friendship = await this.prisma.friendship.findUnique({
      where: { id: requestId },
    });
    if (!friendship || friendship.addresseeId !== userId) {
      throw new NotFoundException();
    }
    return this.prisma.friendship.update({
      where: { id: requestId },
      data: { status: 'rejected' },
    });
  }

  async removeFriend(userId: string, friendId: string) {
    const friendship = await this.prisma.friendship.findFirst({
      where: {
        status: 'accepted',
        OR: [
          { requesterId: userId, addresseeId: friendId },
          { requesterId: friendId, addresseeId: userId },
        ],
      },
    });
    if (!friendship) throw new NotFoundException();
    await this.prisma.friendship.delete({ where: { id: friendship.id } });
    return { message: 'Friend removed' };
  }

  async getFriends(userId: string) {
    const friendships = await this.prisma.friendship.findMany({
      where: {
        status: 'accepted',
        OR: [{ requesterId: userId }, { addresseeId: userId }],
      },
      include: {
        requester: { select: { id: true, name: true, avatar: true } },
        addressee: { select: { id: true, name: true, avatar: true } },
      },
    });

    return friendships.map((f) =>
      f.requesterId === userId ? f.addressee : f.requester,
    );
  }

  async getRequests(userId: string) {
    return this.prisma.friendship.findMany({
      where: { addresseeId: userId, status: 'pending' },
      include: {
        requester: { select: { id: true, name: true, avatar: true } },
      },
    });
  }
}
