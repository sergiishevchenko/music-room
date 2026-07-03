import { Test, TestingModule } from '@nestjs/testing';
import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { EventsService } from './events.service';
import { PrismaService } from '../prisma/prisma.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { AppGateway } from '../gateway/app.gateway';

const mockGateway = {
  emitVoteUpdate: jest.fn(),
  emitTrackAdded: jest.fn(),
};

const mockPrisma = {
  event: {
    findUnique: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    count: jest.fn(),
  },
  eventTrack: {
    findMany: jest.fn(),
    aggregate: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  vote: {
    findUnique: jest.fn(),
    create: jest.fn(),
    delete: jest.fn(),
    count: jest.fn(),
  },
  eventInvite: { findUnique: jest.fn(), createMany: jest.fn() },
  eventBeacon: { upsert: jest.fn() },
  $transaction: jest.fn((fn) => fn(mockPrisma)),
};

const openEvent = {
  id: 'e1',
  creatorId: 'u1',
  isPublic: true,
  licenseType: 'open',
};

async function buildService(isPremium = false) {
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      EventsService,
      { provide: PrismaService, useValue: mockPrisma },
      {
        provide: SubscriptionsService,
        useValue: { isPremium: jest.fn().mockResolvedValue(isPremium) },
      },
      { provide: AppGateway, useValue: mockGateway },
    ],
  }).compile();
  return module.get(EventsService);
}

describe('EventsService', () => {
  let service: EventsService;

  beforeEach(async () => {
    service = await buildService(false);
    jest.clearAllMocks();
  });

  describe('create', () => {
    it('limits free users to 3 events', async () => {
      mockPrisma.event.count.mockResolvedValue(3);
      await expect(
        service.create('u1', { name: 'E', isPublic: true, licenseType: 'open' }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('creates event for free user under limit', async () => {
      mockPrisma.event.count.mockResolvedValue(1);
      mockPrisma.event.create.mockResolvedValue({ id: 'e1', name: 'E' });
      const result = await service.create('u1', {
        name: 'E',
        isPublic: true,
        licenseType: 'open',
        timeStart: '2026-01-01T00:00:00Z',
        timeEnd: '2026-12-31T00:00:00Z',
      });
      expect(result.id).toBe('e1');
    });

    it('creates event for premium user', async () => {
      const premium = await buildService(true);
      mockPrisma.event.create.mockResolvedValue({ id: 'e2' });
      const result = await premium.create('u1', {
        name: 'E',
        isPublic: true,
        licenseType: 'open',
      });
      expect(result.id).toBe('e2');
    });
  });

  describe('findAll', () => {
    it('returns events list', async () => {
      mockPrisma.event.findMany.mockResolvedValue([{ id: 'e1' }]);
      const list = await service.findAll('u1');
      expect(list.length).toBe(1);
    });
  });

  describe('findOne', () => {
    it('throws for missing event', async () => {
      mockPrisma.event.findUnique.mockResolvedValue(null);
      await expect(service.findOne('e1', 'u1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws for private event without invite', async () => {
      mockPrisma.event.findUnique.mockResolvedValue({
        ...openEvent,
        isPublic: false,
        creatorId: 'other',
      });
      mockPrisma.eventInvite.findUnique.mockResolvedValue(null);
      await expect(service.findOne('e1', 'u1')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('returns public event', async () => {
      mockPrisma.event.findUnique.mockResolvedValue(openEvent);
      const event = await service.findOne('e1', 'u1');
      expect(event.id).toBe('e1');
    });
  });

  describe('update', () => {
    it('throws when not creator', async () => {
      mockPrisma.event.findUnique.mockResolvedValue({
        ...openEvent,
        creatorId: 'other',
      });
      await expect(
        service.update('e1', 'u1', { name: 'New' }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('updates event', async () => {
      mockPrisma.event.findUnique.mockResolvedValue(openEvent);
      mockPrisma.event.update.mockResolvedValue({ id: 'e1', name: 'New' });
      const result = await service.update('e1', 'u1', { name: 'New' });
      expect(result.name).toBe('New');
    });
  });

  describe('remove', () => {
    it('deletes event', async () => {
      mockPrisma.event.findUnique.mockResolvedValue(openEvent);
      mockPrisma.event.delete.mockResolvedValue({});
      const result = await service.remove('e1', 'u1');
      expect(result.message).toBe('Event deleted');
    });
  });

  describe('addTrack', () => {
    it('adds track and broadcasts', async () => {
      mockPrisma.event.findUnique.mockResolvedValue(openEvent);
      mockPrisma.eventTrack.aggregate.mockResolvedValue({ _max: { position: 1 } });
      mockPrisma.eventTrack.create.mockResolvedValue({ id: 't1', title: 'Song' });
      mockPrisma.eventTrack.findMany.mockResolvedValue([]);

      const track = await service.addTrack('e1', 'u1', {
        title: 'Song',
        artist: 'Artist',
      });
      expect(track.id).toBe('t1');
      expect(mockGateway.emitTrackAdded).toHaveBeenCalled();
    });
  });

  describe('vote', () => {
    it('votes via transaction', async () => {
      mockPrisma.event.findUnique.mockResolvedValue(openEvent);
      mockPrisma.vote.findUnique.mockResolvedValue(null);
      mockPrisma.vote.create.mockResolvedValue({});
      mockPrisma.eventTrack.update.mockResolvedValue({ id: 't1', voteCount: 1 });
      mockPrisma.eventTrack.findMany.mockResolvedValue([]);

      await service.vote('e1', 't1', 'u1');
      expect(mockPrisma.$transaction).toHaveBeenCalled();
    });

    it('rejects duplicate vote', async () => {
      mockPrisma.event.findUnique.mockResolvedValue(openEvent);
      mockPrisma.vote.findUnique.mockResolvedValue({ id: 'v1' });
      await expect(service.vote('e1', 't1', 'u1')).rejects.toThrow(
        ConflictException,
      );
    });

    it('rejects when daily vote limit reached', async () => {
      mockPrisma.event.findUnique.mockResolvedValue(openEvent);
      mockPrisma.vote.count.mockResolvedValue(10);
      await expect(service.vote('e1', 't1', 'u1')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('rejects invite-only vote without invite', async () => {
      mockPrisma.event.findUnique.mockResolvedValue({
        ...openEvent,
        licenseType: 'invite_only',
        creatorId: 'other',
        isPublic: false,
      });
      mockPrisma.eventInvite.findUnique.mockResolvedValue(null);
      await expect(service.vote('e1', 't1', 'u2')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('rejects geo_time vote without location', async () => {
      mockPrisma.event.findUnique.mockResolvedValue({
        ...openEvent,
        licenseType: 'geo_time',
        latitude: 46.5,
        longitude: 6.6,
        radius: 100,
        timeStart: new Date(Date.now() - 3600000),
        timeEnd: new Date(Date.now() + 3600000),
      });
      await expect(service.vote('e1', 't1', 'u1')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('rejects geo_time vote when too far', async () => {
      mockPrisma.event.findUnique.mockResolvedValue({
        ...openEvent,
        licenseType: 'geo_time',
        latitude: 46.5,
        longitude: 6.6,
        radius: 10,
        timeStart: new Date(Date.now() - 3600000),
        timeEnd: new Date(Date.now() + 3600000),
      });
      await expect(service.vote('e1', 't1', 'u1', 48.0, 2.0)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('allows geo_time vote when in range', async () => {
      mockPrisma.event.findUnique.mockResolvedValue({
        ...openEvent,
        licenseType: 'geo_time',
        latitude: 46.5197,
        longitude: 6.6323,
        radius: 5000,
        timeStart: new Date(Date.now() - 3600000),
        timeEnd: new Date(Date.now() + 3600000),
      });
      mockPrisma.vote.count.mockResolvedValue(0);
      mockPrisma.vote.findUnique.mockResolvedValue(null);
      mockPrisma.vote.create.mockResolvedValue({});
      mockPrisma.eventTrack.update.mockResolvedValue({ id: 't1' });
      mockPrisma.eventTrack.findMany.mockResolvedValue([]);

      await service.vote('e1', 't1', 'u1', 46.52, 6.63);
      expect(mockGateway.emitVoteUpdate).toHaveBeenCalled();
    });

    it('rejects vote before event start', async () => {
      mockPrisma.event.findUnique.mockResolvedValue({
        ...openEvent,
        licenseType: 'geo_time',
        timeStart: new Date(Date.now() + 86400000),
      });
      await expect(service.vote('e1', 't1', 'u1')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('rejects vote after event end', async () => {
      mockPrisma.event.findUnique.mockResolvedValue({
        ...openEvent,
        licenseType: 'geo_time',
        timeEnd: new Date(Date.now() - 86400000),
      });
      await expect(service.vote('e1', 't1', 'u1')).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  describe('unvote', () => {
    it('throws when vote missing', async () => {
      mockPrisma.vote.findUnique.mockResolvedValue(null);
      await expect(service.unvote('e1', 't1', 'u1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('removes vote', async () => {
      mockPrisma.vote.findUnique.mockResolvedValue({ id: 'v1' });
      mockPrisma.vote.delete.mockResolvedValue({});
      mockPrisma.eventTrack.update.mockResolvedValue({ id: 't1', voteCount: 0 });
      mockPrisma.eventTrack.findMany.mockResolvedValue([]);

      const result = await service.unvote('e1', 't1', 'u1');
      expect(result.voteCount).toBe(0);
    });
  });

  describe('getTracks', () => {
    it('returns tracks with hasVoted flag', async () => {
      mockPrisma.event.findUnique.mockResolvedValue(openEvent);
      mockPrisma.eventTrack.findMany.mockResolvedValue([
        { id: 't1', votes: [{ id: 'v1' }] },
        { id: 't2', votes: [] },
      ]);

      const tracks = await service.getTracks('e1', 'u1');
      expect(tracks[0].hasVoted).toBe(true);
      expect(tracks[1].hasVoted).toBe(false);
    });
  });

  describe('inviteUsers', () => {
    it('throws when not creator', async () => {
      mockPrisma.event.findUnique.mockResolvedValue({
        ...openEvent,
        creatorId: 'other',
      });
      await expect(service.inviteUsers('e1', 'u1', ['u2'])).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('invites users', async () => {
      mockPrisma.event.findUnique.mockResolvedValue(openEvent);
      mockPrisma.eventInvite.createMany.mockResolvedValue({ count: 1 });
      const result = await service.inviteUsers('e1', 'u1', ['u2', 'u3']);
      expect(result.message).toContain('Invited 2');
    });
  });

  describe('registerBeacon', () => {
    it('registers beacon for creator', async () => {
      mockPrisma.event.findUnique.mockResolvedValue(openEvent);
      mockPrisma.eventBeacon.upsert.mockResolvedValue({ uuid: 'beacon-1' });
      const result = await service.registerBeacon('e1', 'u1', {
        uuid: 'beacon-1',
        major: 1,
        minor: 2,
      });
      expect(result.uuid).toBe('beacon-1');
    });
  });

  describe('findNearbyBeacons', () => {
    it('filters events by distance', async () => {
      mockPrisma.event.findMany.mockResolvedValue([
        {
          id: 'e1',
          latitude: 46.5197,
          longitude: 6.6323,
          radius: 5000,
          beacon: { uuid: 'b1' },
        },
        {
          id: 'e2',
          latitude: 48.0,
          longitude: 2.0,
          radius: 100,
          beacon: { uuid: 'b2' },
        },
      ]);

      const nearby = await service.findNearbyBeacons(46.52, 6.63);
      expect(nearby.length).toBe(1);
      expect(nearby[0].id).toBe('e1');
    });
  });
});
