import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  UseGuards,
  Headers,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags, ApiOperation } from '@nestjs/swagger';
import { EventsService } from './events.service';
import {
  CreateEventDto,
  UpdateEventDto,
  AddTrackDto,
  InviteUsersDto,
} from './dto/events.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@ApiTags('events')
@Controller('events')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class EventsController {
  constructor(private eventsService: EventsService) {}

  @Post()
  @ApiOperation({ summary: 'Create event' })
  create(@CurrentUser('id') userId: string, @Body() dto: CreateEventDto) {
    return this.eventsService.create(userId, dto);
  }

  @Get()
  @ApiOperation({ summary: 'List events' })
  findAll(@CurrentUser('id') userId: string) {
    return this.eventsService.findAll(userId);
  }

  @Get('nearby/beacons')
  @ApiOperation({ summary: 'Find nearby events with beacons' })
  findNearby(
    @Headers('x-latitude') lat: string,
    @Headers('x-longitude') lng: string,
  ) {
    return this.eventsService.findNearbyBeacons(
      parseFloat(lat),
      parseFloat(lng),
    );
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get event details' })
  findOne(@Param('id') id: string, @CurrentUser('id') userId: string) {
    return this.eventsService.findOne(id, userId);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update event' })
  update(
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
    @Body() dto: UpdateEventDto,
  ) {
    return this.eventsService.update(id, userId, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete event' })
  remove(@Param('id') id: string, @CurrentUser('id') userId: string) {
    return this.eventsService.remove(id, userId);
  }

  @Post(':id/tracks')
  @ApiOperation({ summary: 'Add track to event' })
  addTrack(
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
    @Body() dto: AddTrackDto,
  ) {
    return this.eventsService.addTrack(id, userId, dto);
  }

  @Get(':id/tracks')
  @ApiOperation({ summary: 'Get event tracks sorted by votes' })
  getTracks(@Param('id') id: string, @CurrentUser('id') userId: string) {
    return this.eventsService.getTracks(id, userId);
  }

  @Post(':id/tracks/:trackId/vote')
  @ApiOperation({ summary: 'Vote for a track' })
  vote(
    @Param('id') id: string,
    @Param('trackId') trackId: string,
    @CurrentUser('id') userId: string,
    @Headers('x-latitude') lat?: string,
    @Headers('x-longitude') lng?: string,
  ) {
    return this.eventsService.vote(
      id,
      trackId,
      userId,
      lat ? parseFloat(lat) : undefined,
      lng ? parseFloat(lng) : undefined,
    );
  }

  @Delete(':id/tracks/:trackId/vote')
  @ApiOperation({ summary: 'Remove vote' })
  unvote(
    @Param('id') id: string,
    @Param('trackId') trackId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.eventsService.unvote(id, trackId, userId);
  }

  @Post(':id/invite')
  @ApiOperation({ summary: 'Invite users to event' })
  invite(
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
    @Body() dto: InviteUsersDto,
  ) {
    return this.eventsService.inviteUsers(id, userId, dto.userIds);
  }

  @Post(':id/beacon')
  @ApiOperation({ summary: 'Register iBeacon for event' })
  registerBeacon(
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
    @Body() body: { uuid: string; major: number; minor: number },
  ) {
    return this.eventsService.registerBeacon(id, userId, body);
  }
}
