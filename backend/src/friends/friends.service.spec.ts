import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { FriendsService } from './friends.service';
import { PrismaService } from '../prisma/prisma.service';

const mockPrisma = {
  friendship: {
    findFirst: jest.fn(),
    create: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
    findMany: jest.fn(),
    delete: jest.fn(),
  },
};

describe('FriendsService', () => {
  let service: FriendsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FriendsService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get(FriendsService);
    jest.clearAllMocks();
  });

  it('rejects self friend request', async () => {
    await expect(service.sendRequest('u1', 'u1')).rejects.toThrow(
      BadRequestException,
    );
  });

  it('rejects duplicate pending request', async () => {
    mockPrisma.friendship.findFirst.mockResolvedValue({ status: 'pending' });
    await expect(service.sendRequest('u1', 'u2')).rejects.toThrow(
      ConflictException,
    );
  });

  it('rejects request when already friends', async () => {
    mockPrisma.friendship.findFirst.mockResolvedValue({ status: 'accepted' });
    await expect(service.sendRequest('u1', 'u2')).rejects.toThrow(
      ConflictException,
    );
  });

  it('creates friend request', async () => {
    mockPrisma.friendship.findFirst.mockResolvedValue(null);
    mockPrisma.friendship.create.mockResolvedValue({ id: 'f1' });
    const result = await service.sendRequest('u1', 'u2');
    expect(result.id).toBe('f1');
  });

  it('accepts friend request', async () => {
    mockPrisma.friendship.findUnique.mockResolvedValue({
      id: 'f1',
      addresseeId: 'u2',
    });
    mockPrisma.friendship.update.mockResolvedValue({ id: 'f1', status: 'accepted' });
    const result = await service.acceptRequest('u2', 'f1');
    expect(result.status).toBe('accepted');
  });

  it('throws when accepting unknown request', async () => {
    mockPrisma.friendship.findUnique.mockResolvedValue(null);
    await expect(service.acceptRequest('u2', 'f1')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('rejects friend request', async () => {
    mockPrisma.friendship.findUnique.mockResolvedValue({
      id: 'f1',
      addresseeId: 'u2',
    });
    mockPrisma.friendship.update.mockResolvedValue({ status: 'rejected' });
    const result = await service.rejectRequest('u2', 'f1');
    expect(result.status).toBe('rejected');
  });

  it('removes friend', async () => {
    mockPrisma.friendship.findFirst.mockResolvedValue({ id: 'f1' });
    mockPrisma.friendship.delete.mockResolvedValue({});
    const result = await service.removeFriend('u1', 'u2');
    expect(result.message).toBe('Friend removed');
  });

  it('throws when removing non-friend', async () => {
    mockPrisma.friendship.findFirst.mockResolvedValue(null);
    await expect(service.removeFriend('u1', 'u2')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('returns friends list', async () => {
    mockPrisma.friendship.findMany.mockResolvedValue([
      {
        requesterId: 'u1',
        addressee: { id: 'u2', name: 'Bob' },
        requester: { id: 'u1', name: 'Alice' },
      },
    ]);
    const friends = await service.getFriends('u1');
    expect(friends[0].name).toBe('Bob');
  });

  it('returns pending requests', async () => {
    mockPrisma.friendship.findMany.mockResolvedValue([{ id: 'r1' }]);
    expect((await service.getRequests('u2')).length).toBe(1);
  });
});
