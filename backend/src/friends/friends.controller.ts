import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags, ApiOperation } from '@nestjs/swagger';
import { FriendsService } from './friends.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@ApiTags('friends')
@Controller('friends')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class FriendsController {
  constructor(private friendsService: FriendsService) {}

  @Get()
  @ApiOperation({ summary: 'Get friends list' })
  getFriends(@CurrentUser('id') userId: string) {
    return this.friendsService.getFriends(userId);
  }

  @Get('requests')
  @ApiOperation({ summary: 'Get pending friend requests' })
  getRequests(@CurrentUser('id') userId: string) {
    return this.friendsService.getRequests(userId);
  }

  @Post('request/:userId')
  @ApiOperation({ summary: 'Send friend request' })
  sendRequest(
    @CurrentUser('id') requesterId: string,
    @Param('userId') addresseeId: string,
  ) {
    return this.friendsService.sendRequest(requesterId, addresseeId);
  }

  @Post('accept/:requestId')
  @ApiOperation({ summary: 'Accept friend request' })
  acceptRequest(
    @CurrentUser('id') userId: string,
    @Param('requestId') requestId: string,
  ) {
    return this.friendsService.acceptRequest(userId, requestId);
  }

  @Post('reject/:requestId')
  @ApiOperation({ summary: 'Reject friend request' })
  rejectRequest(
    @CurrentUser('id') userId: string,
    @Param('requestId') requestId: string,
  ) {
    return this.friendsService.rejectRequest(userId, requestId);
  }

  @Delete(':friendId')
  @ApiOperation({ summary: 'Remove friend' })
  removeFriend(
    @CurrentUser('id') userId: string,
    @Param('friendId') friendId: string,
  ) {
    return this.friendsService.removeFriend(userId, friendId);
  }
}
