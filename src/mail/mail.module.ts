import { Module } from '@nestjs/common';
import { NotificationsClient } from './notifications.client';

/**
 * The gateway's only mail concern: telling the users subgraph that a sign-in
 * happened. Templates, preferences and SMTP all live in ekoru-users.
 */
@Module({
  providers: [NotificationsClient],
  exports: [NotificationsClient],
})
export class MailModule {}
