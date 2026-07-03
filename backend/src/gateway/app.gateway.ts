import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  ConnectedSocket,
  MessageBody,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';

@WebSocketGateway({
  cors: { origin: '*' },
  namespace: '/',
})
export class AppGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private userSockets = new Map<string, Set<string>>();
  private playlistUsers = new Map<string, Set<string>>();

  constructor(
    private jwt: JwtService,
    private config: ConfigService,
  ) {}

  async handleConnection(client: Socket) {
    try {
      const token =
        client.handshake.auth?.token ||
        client.handshake.headers?.authorization?.replace('Bearer ', '');

      if (!token) {
        client.disconnect();
        return;
      }

      const payload = this.jwt.verify(token, {
        secret: this.config.get('JWT_SECRET'),
      });

      client.data.userId = payload.sub;

      if (!this.userSockets.has(payload.sub)) {
        this.userSockets.set(payload.sub, new Set());
      }
      this.userSockets.get(payload.sub).add(client.id);
    } catch {
      client.disconnect();
    }
  }

  handleDisconnect(client: Socket) {
    const userId = client.data.userId;
    if (userId && this.userSockets.has(userId)) {
      this.userSockets.get(userId).delete(client.id);
      if (this.userSockets.get(userId).size === 0) {
        this.userSockets.delete(userId);
      }
    }

    for (const [playlistId, users] of this.playlistUsers.entries()) {
      if (users.has(userId)) {
        users.delete(userId);
        this.server
          .to(`playlist:${playlistId}`)
          .emit('playlist:users_online', {
            playlistId,
            userIds: Array.from(users),
          });
      }
    }
  }

  @SubscribeMessage('event:join')
  async handleJoinEvent(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { eventId: string },
  ) {
    client.join(`event:${data.eventId}`);
    return { joined: data.eventId };
  }

  @SubscribeMessage('event:leave')
  async handleLeaveEvent(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { eventId: string },
  ) {
    client.leave(`event:${data.eventId}`);
  }

  @SubscribeMessage('playlist:join')
  async handleJoinPlaylist(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { playlistId: string },
  ) {
    client.join(`playlist:${data.playlistId}`);

    if (!this.playlistUsers.has(data.playlistId)) {
      this.playlistUsers.set(data.playlistId, new Set());
    }
    this.playlistUsers.get(data.playlistId).add(client.data.userId);

    this.server
      .to(`playlist:${data.playlistId}`)
      .emit('playlist:users_online', {
        playlistId: data.playlistId,
        userIds: Array.from(this.playlistUsers.get(data.playlistId)),
      });

    return { joined: data.playlistId };
  }

  @SubscribeMessage('playlist:leave')
  async handleLeavePlaylist(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { playlistId: string },
  ) {
    const users = this.playlistUsers.get(data.playlistId);
    if (users) {
      users.delete(client.data.userId);
      this.server
        .to(`playlist:${data.playlistId}`)
        .emit('playlist:users_online', {
          playlistId: data.playlistId,
          userIds: Array.from(users),
        });
    }
    client.leave(`playlist:${data.playlistId}`);
  }

  emitVoteUpdate(eventId: string, tracks: any[]) {
    this.server
      .to(`event:${eventId}`)
      .emit('vote:updated', { eventId, tracks });
  }

  emitTrackAdded(eventId: string, track: any) {
    this.server
      .to(`event:${eventId}`)
      .emit('vote:track_added', { eventId, track });
  }

  emitPlaylistUpdate(playlistId: string, action: string, data: any) {
    this.server
      .to(`playlist:${playlistId}`)
      .emit(`playlist:${action}`, { playlistId, ...data });
  }

  emitDelegationUpdate(userId: string, data: any) {
    const sockets = this.userSockets.get(userId);
    if (sockets) {
      sockets.forEach((socketId) => {
        this.server.to(socketId).emit('delegation:updated', data);
      });
    }
  }
}
