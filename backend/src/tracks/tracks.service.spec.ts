import { Test, TestingModule } from '@nestjs/testing';
import { TracksService } from './tracks.service';

describe('TracksService', () => {
  let service: TracksService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [TracksService],
    }).compile();

    service = module.get(TracksService);
    global.fetch = jest.fn();
  });

  it('search returns empty for blank query', async () => {
    expect(await service.search('   ')).toEqual([]);
  });

  it('search returns mapped tracks', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [
          {
            title: 'One More Time',
            artist: { name: 'Daft Punk' },
            album: { title: 'Discovery', cover_medium: 'http://cover' },
            preview: 'http://preview',
            id: 123,
          },
        ],
      }),
    });

    const results = await service.search('Daft Punk');
    expect(results.length).toBe(1);
    expect(results[0].title).toBe('One More Time');
    expect(results[0].externalId).toBe('deezer:123');
  });

  it('search returns empty when API fails', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({ ok: false });
    expect(await service.search('test')).toEqual([]);
  });

  it('search respects custom limit', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ data: [] }),
    });
    await service.search('test', 5);
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('limit=5'),
    );
  });
});
