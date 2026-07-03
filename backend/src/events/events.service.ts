import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { AppGateway } from '../gateway/app.gateway';
import { CreateEventDto, UpdateEventDto, AddTrackDto } from './dto/events.dto';

@Injectable()
export class EventsService {
  constructor(
    private prisma: PrismaService,
    private subscriptions: SubscriptionsService,
    private gateway: AppGateway,
  ) {}

  async create(userId: string, dto: CreateEventDto) {
    const premium = await this.subscriptions.isPremium(userId);
    if (!premium) {
      const count = await this.prisma.event.count({
        where: { creatorId: userId },
      });
      if (count >= 3) {
        throw new ForbiddenException('Free plan: max 3 events');
      }
    }

    return this.prisma.event.create({
      data: {
        ...dto,
        timeStart: dto.timeStart ? new Date(dto.timeStart) : null,
        timeEnd: dto.timeEnd ? new Date(dto.timeEnd) : null,
        creatorId: userId,
      },
      include: { creator: { select: { id: true, name: true, avatar: true } } },
    });
  }

  async findAll(userId: string) {
    return this.prisma.event.findMany({
      where: {
        OR: [
          { isPublic: true },
          { creatorId: userId },
          { invites: { some: { userId } } },
        ],
      },
      include: {
        creator: { select: { id: true, name: true, avatar: true } },
        _count: { select: { tracks: true, invites: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(eventId: string, userId: string) {
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      include: {
        creator: { select: { id: true, name: true, avatar: true } },
        tracks: {
          orderBy: { voteCount: 'desc' },
          include: {
            addedBy: { select: { id: true, name: true, avatar: true } },
          },
        },
        invites: {
          include: {
            user: { select: { id: true, name: true, avatar: true } },
          },
        },
        beacon: true,
      },
    });

    if (!event) throw new NotFoundException();
    await this.checkEventAccess(event, userId);
    return event;
  }

  async update(eventId: string, userId: string, dto: UpdateEventDto) {
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
    });
    if (!event) throw new NotFoundException();
    if (event.creatorId !== userId) throw new ForbiddenException();

    return this.prisma.event.update({
      where: { id: eventId },
      data: dto,
    });
  }

  async remove(eventId: string, userId: string) {
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
    });
    if (!event) throw new NotFoundException();
    if (event.creatorId !== userId) throw new ForbiddenException();

    await this.prisma.event.delete({ where: { id: eventId } });
    return { message: 'Event deleted' };
  }

  async addTrack(eventId: string, userId: string, dto: AddTrackDto) {
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
    });
    if (!event) throw new NotFoundException();
    await this.checkEventAccess(event, userId);

    const maxPos = await this.prisma.eventTrack.aggregate({
      where: { eventId },
      _max: { position: true },
    });

    const track = await this.prisma.eventTrack.create({
      data: {
        ...dto,
        eventId,
        addedById: userId,
        position: (maxPos._max.position || 0) + 1,
      },
      include: {
        addedBy: { select: { id: true, name: true, avatar: true } },
      },
    });

    this.gateway.emitTrackAdded(eventId, track);
    await this.broadcastTracks(eventId);
    return track;
  }

  async vote(
    eventId: string,
    trackId: string,
    userId: string,
    userLat?: number,
    userLng?: number,
  ) {
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
    });
    if (!event) throw new NotFoundException();
    await this.checkVoteAccess(event, userId, userLat, userLng);

    const premium = await this.subscriptions.isPremium(userId);
    if (!premium) {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const voteCount = await this.prisma.vote.count({
        where: { userId, createdAt: { gte: today } },
      });
      if (voteCount >= 10) {
        throw new ForbiddenException('Free plan: max 10 votes per day');
      }
    }

    const existing = await this.prisma.vote.findUnique({
      where: {
        eventId_trackId_userId: { eventId, trackId, userId },
      },
    });
    if (existing) throw new ConflictException('Already voted');

    const track = await this.prisma.$transaction(async (tx) => {
      await tx.vote.create({
        data: { eventId, trackId, userId },
      });

      return tx.eventTrack.update({
        where: { id: trackId },
        data: { voteCount: { increment: 1 } },
      });
    });

    await this.broadcastTracks(eventId);
    return track;
  }

  async unvote(eventId: string, trackId: string, userId: string) {
    const existing = await this.prisma.vote.findUnique({
      where: {
        eventId_trackId_userId: { eventId, trackId, userId },
      },
    });
    if (!existing) throw new NotFoundException('Vote not found');

    const track = await this.prisma.$transaction(async (tx) => {
      await tx.vote.delete({
        where: { id: existing.id },
      });

      return tx.eventTrack.update({
        where: { id: trackId },
        data: { voteCount: { decrement: 1 } },
      });
    });

    await this.broadcastTracks(eventId);
    return track;
  }

  async getTracks(eventId: string, userId: string) {
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
    });
    if (!event) throw new NotFoundException();
    await this.checkEventAccess(event, userId);

    const tracks = await this.prisma.eventTrack.findMany({
      where: { eventId },
      orderBy: { voteCount: 'desc' },
      include: {
        addedBy: { select: { id: true, name: true, avatar: true } },
        votes: { where: { userId }, select: { id: true } },
      },
    });

    return tracks.map((t) => ({
      ...t,
      hasVoted: t.votes.length > 0,
      votes: undefined,
    }));
  }

  async inviteUsers(eventId: string, userId: string, userIds: string[]) {
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
    });
    if (!event) throw new NotFoundException();
    if (event.creatorId !== userId) throw new ForbiddenException();

    const data = userIds.map((uid) => ({ eventId, userId: uid }));
    await this.prisma.eventInvite.createMany({
      data,
      skipDuplicates: true,
    });

    return { message: `Invited ${userIds.length} users` };
  }

  async registerBeacon(
    eventId: string,
    userId: string,
    data: { uuid: string; major: number; minor: number },
  ) {
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
    });
    if (!event) throw new NotFoundException();
    if (event.creatorId !== userId) throw new ForbiddenException();

    return this.prisma.eventBeacon.upsert({
      where: { eventId },
      update: data,
      create: { eventId, ...data },
    });
  }

  async findNearbyBeacons(latitude: number, longitude: number) {
    const events = await this.prisma.event.findMany({
      where: {
        isPublic: true,
        beacon: { isNot: null },
        latitude: { not: null },
        longitude: { not: null },
      },
      include: {
        beacon: true,
        creator: { select: { id: true, name: true } },
      },
    });

    return events.filter((event) => {
      const distance = this.haversineDistance(
        latitude,
        longitude,
        event.latitude!,
        event.longitude!,
      );
      return distance <= (event.radius || 200);
    });
  }

  private async broadcastTracks(eventId: string) {
    const tracks = await this.prisma.eventTrack.findMany({
      where: { eventId },
      orderBy: { voteCount: 'desc' },
      include: {
        addedBy: { select: { id: true, name: true, avatar: true } },
      },
    });
    this.gateway.emitVoteUpdate(eventId, tracks);
  }

  private async checkEventAccess(event: any, userId: string) {
    if (event.isPublic) return;
    if (event.creatorId === userId) return;

    const invite = await this.prisma.eventInvite.findUnique({
      where: { eventId_userId: { eventId: event.id, userId } },
    });
    if (!invite) throw new ForbiddenException('Not invited to this event');
  }

  private async checkVoteAccess(
    event: any,
    userId: string,
    userLat?: number,
    userLng?: number,
  ) {
    await this.checkEventAccess(event, userId);

    if (event.licenseType === 'invite_only') {
      if (event.creatorId === userId) return;
      const invite = await this.prisma.eventInvite.findUnique({
        where: { eventId_userId: { eventId: event.id, userId } },
      });
      if (!invite) throw new ForbiddenException('Only invited users can vote');
    }

    if (event.licenseType === 'geo_time') {
      const now = new Date();
      if (event.timeStart && now < event.timeStart) {
        throw new ForbiddenException('Voting not yet started');
      }
      if (event.timeEnd && now > event.timeEnd) {
        throw new ForbiddenException('Voting has ended');
      }

      if (
        event.latitude != null &&
        event.longitude != null &&
        event.radius != null
      ) {
        if (userLat == null || userLng == null) {
          throw new ForbiddenException('Location required for this event');
        }
        const distance = this.haversineDistance(
          event.latitude,
          event.longitude,
          userLat,
          userLng,
        );
        if (distance > event.radius) {
          throw new ForbiddenException('You are too far from the event location');
        }
      }
    }
  }

  private haversineDistance(
    lat1: number,
    lon1: number,
    lat2: number,
    lon2: number,
  ): number {
    const R = 6371000;
    const toRad = (deg: number) => (deg * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }
}
