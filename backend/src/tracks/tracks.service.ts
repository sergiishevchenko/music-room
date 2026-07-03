import { Injectable } from '@nestjs/common';

@Injectable()
export class TracksService {
  async search(query: string, limit = 20) {
    if (!query?.trim()) return [];

    const res = await fetch(
      `https://api.deezer.com/search?q=${encodeURIComponent(query)}&limit=${limit}`,
    );

    if (!res.ok) return [];

    const data = await res.json();

    return (data.data || []).map((item: any) => ({
      title: item.title,
      artist: item.artist?.name || 'Unknown',
      album: item.album?.title,
      coverUrl: item.album?.cover_medium,
      previewUrl: item.preview,
      externalId: `deezer:${item.id}`,
    }));
  }
}
