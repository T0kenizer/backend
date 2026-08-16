import { File } from '@entities/file.entity';
import { MikroOrmModule } from '@mikro-orm/nestjs';
import * as Constants from '@modules/files/files.constants';
import { FilesConsumer } from '@modules/files/files.consumer';
import { FilesController } from '@modules/files/files.controller';
import { FilesService } from '@modules/files/files.service';
import { FirebaseModule } from '@modules/firebase/firebase.module';
import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';

@Module({
  controllers: [FilesController],
  providers: [FilesService, FilesConsumer],
  exports: [FilesService],
  imports: [
    MikroOrmModule.forFeature([File]),
    BullModule.registerQueue({
      name: Constants.FILES_QUEUE,
      defaultJobOptions: {
        removeOnComplete: { count: 100, age: 24 * 3600 },
        removeOnFail: { count: 500, age: 7 * 24 * 3600 },
      },
    }),
    FirebaseModule,
  ],
})
export class FilesModule {}
