import { Module } from '@nestjs/common';
import { EventsController } from './events.controller';
import { EventsService } from './events.service';
import { GatewayModule } from '../gateway/gateway.module';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';

@Module({
  imports: [GatewayModule, SubscriptionsModule],
  controllers: [EventsController],
  providers: [EventsService],
  exports: [EventsService],
})
export class EventsModule {}
