import { File } from '@entities/file.entity';
import { EntityRepository } from '@mikro-orm/core';
import { FilesService } from '@modules/files/files.service';
import * as Types from '@modules/files/files.types';
import { FirebaseService } from '@modules/firebase/firebase.service';
import { RedisCacheService } from '@modules/redis/services/redis-cache.service';
import { BadRequestException } from '@nestjs/common';
import sharp from 'sharp';

/** Exposes the protected re-encoding step, which is what formats flow through. */
class TestFilesService extends FilesService {
  public processContent(file: File, content: Buffer) {
    return this.process(file, content);
  }
}

function makeService() {
  return new TestFilesService(
    {} as EntityRepository<File>,
    {} as Types.FilesQueue,
    {} as FirebaseService,
    {} as RedisCacheService,
  );
}

function makeFile(mimeType: string): File {
  return { mimeType } as File;
}

function makeImage(
  format: keyof sharp.FormatEnum,
  background: sharp.Color = { r: 255, g: 0, b: 0, alpha: 1 },
): Promise<Buffer> {
  return sharp({
    create: { width: 16, height: 16, channels: 4, background },
  })
    .toFormat(format)
    .toBuffer();
}

describe('FilesService', () => {
  describe('process', () => {
    it.each([
      ['image/png', 'png'],
      ['image/jpeg', 'jpeg'],
      ['image/webp', 'webp'],
      ['image/gif', 'gif'],
    ] as const)('re-encodes %s into webp', async (mimeType, format) => {
      const service = makeService();

      const processed = await service.processContent(
        makeFile(mimeType),
        await makeImage(format),
      );

      expect(processed.mimeType).toBe('image/webp');
      await expect(
        sharp(processed.content)
          .metadata()
          .then((meta) => meta.format),
      ).resolves.toBe('webp');
    });

    it('stores an animated upload as a still image', async () => {
      const service = makeService();
      // Distinct frames: identical ones get collapsed into a single page.
      const frames = await Promise.all([
        makeImage('png', { r: 255, g: 0, b: 0, alpha: 1 }),
        makeImage('png', { r: 0, g: 0, b: 255, alpha: 1 }),
      ]);
      const animated = await sharp(frames, { join: { animated: true } })
        .gif({ delay: [100, 100], loop: 0 })
        .toBuffer();
      // Guards the fixture: a still gif would pass the assertions below anyway.
      await expect(
        sharp(animated, { animated: true })
          .metadata()
          .then((meta) => meta.pages),
      ).resolves.toBe(2);

      const processed = await service.processContent(
        makeFile('image/gif'),
        animated,
      );

      expect(processed.mimeType).toBe('image/webp');
      const metadata = await sharp(processed.content).metadata();
      expect(metadata.format).toBe('webp');
      // Only the first frame, not the frames stacked into one tall image.
      expect(metadata.pages ?? 1).toBe(1);
      expect(metadata.height).toBe(16);
    });

    it('stores a non-image upload untouched', async () => {
      const service = makeService();
      const content = Buffer.from('%PDF-1.7');

      const processed = await service.processContent(
        makeFile('application/pdf'),
        content,
      );

      expect(processed.mimeType).toBe('application/pdf');
      expect(processed.content).toBe(content);
    });

    it('rejects content that cannot be decoded', async () => {
      const service = makeService();

      await expect(
        service.processContent(
          makeFile('image/png'),
          Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x00]),
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
