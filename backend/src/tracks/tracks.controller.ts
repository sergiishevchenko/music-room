import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { TracksService } from './tracks.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';

@ApiTags('tracks')
@Controller('tracks')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class TracksController {
  constructor(private tracksService: TracksService) {}

  @Get('search')
  @ApiOperation({ summary: 'Search tracks via Deezer API' })
  @ApiQuery({ name: 'q', example: 'Daft Punk' })
  search(@Query('q') query: string) {
    return this.tracksService.search(query || '');
  }
}
