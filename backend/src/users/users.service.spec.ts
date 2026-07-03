import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { UsersService } from './users.service';
import { PrismaService } from '../prisma/prisma.service';

const mockPrisma = {
  user: {
    findUnique: jest.fn(),
    findMany: jest.fn(),
    update: jest.fn(),
  },
  friendship: {
    findFirst: jest.fn(),
  },
};

describe('UsersService', () => {
  let service: UsersService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get(UsersService);
    jest.clearAllMocks();
  });

  it('getMe throws when user not found', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null);
    await expect(service.getMe('x')).rejects.toThrow(NotFoundException);
  });

  it('getMe returns sanitized user', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      id: '1',
      email: 'a@b.com',
      name: 'Test',
      passwordHash: 'hash',
      verifyToken: 'tok',
    });
    const result = await service.getMe('1');
    expect(result.email).toBe('a@b.com');
    expect(result.passwordHash).toBeUndefined();
    expect(result.verifyToken).toBeUndefined();
  });

  it('updateMe updates profile fields', async () => {
    mockPrisma.user.update.mockResolvedValue({
      id: '1',
      name: 'New',
      passwordHash: 'hash',
    });
    const result = await service.updateMe('1', { name: 'New' });
    expect(result.name).toBe('New');
  });

  it('search returns matching users', async () => {
    mockPrisma.user.findMany.mockResolvedValue([{ id: '1', name: 'Alice' }]);
    expect((await service.search('Ali')).length).toBe(1);
  });

  it('getPublicProfile returns base fields', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      id: '2',
      name: 'Bob',
      avatar: 'a.png',
      publicInfo: { bio: 'hi' },
      friendsInfo: { city: 'Paris' },
      musicPrefs: { genre: 'rock' },
    });
    const profile = await service.getPublicProfile('2');
    expect(profile.name).toBe('Bob');
    expect(profile.friendsInfo).toBeUndefined();
  });

  it('getPublicProfile includes friends info for friends', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      id: '2',
      name: 'Bob',
      publicInfo: {},
      friendsInfo: { city: 'Paris' },
    });
    mockPrisma.friendship.findFirst.mockResolvedValue({ id: 'f1' });
    const profile = await service.getPublicProfile('2', '1');
    expect(profile.friendsInfo).toEqual({ city: 'Paris' });
  });

  it('getPublicProfile throws for missing user', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null);
    await expect(service.getPublicProfile('x')).rejects.toThrow(
      NotFoundException,
    );
  });
});
