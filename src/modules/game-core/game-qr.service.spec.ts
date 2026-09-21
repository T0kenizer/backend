import type { ConfigService } from '@modules/config/config.service';
import { GameQrService } from '@modules/game-core/game-qr.service';

const GAME_UUID = '11111111-1111-4111-8111-111111111111';
const OTHER_UUID = '22222222-2222-4222-8222-222222222222';

/** PNG magic number, so a render is checked for being an actual image. */
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

function makeService(frontendUrl = 'https://tokenizer.fr') {
  const configService = {
    get: jest.fn(() => frontendUrl),
  } as unknown as ConfigService;

  return { service: new GameQrService(configService), configService };
}

describe('GameQrService', () => {
  describe('joinUrl', () => {
    it('points at the join screen for the session uuid', () => {
      const { service } = makeService();

      expect(service.joinUrl(GAME_UUID)).toBe(
        `https://tokenizer.fr/game/join/${GAME_UUID}`,
      );
    });

    it('does not double the slash when the origin carries a trailing one', () => {
      const { service } = makeService('https://tokenizer.fr/');

      expect(service.joinUrl(GAME_UUID)).toBe(
        `https://tokenizer.fr/game/join/${GAME_UUID}`,
      );
    });
  });

  describe('render', () => {
    it('renders a png', async () => {
      const { service } = makeService();

      const { png } = await service.render(GAME_UUID);

      expect(png.subarray(0, 4)).toEqual(PNG_SIGNATURE);
    });

    it('tags the same room with the same etag, so a revalidation is a 304', async () => {
      const { service } = makeService();

      const first = await service.render(GAME_UUID);
      const second = await service.render(GAME_UUID);

      expect(first.etag).toBe(second.etag);
    });

    it('tags two rooms apart', async () => {
      const { service } = makeService();

      const mine = await service.render(GAME_UUID);
      const theirs = await service.render(OTHER_UUID);

      expect(mine.etag).not.toBe(theirs.etag);
    });

    // The symbol encodes the origin, so the same room behind a different public
    // URL is a different image — caching it under one tag would serve a link
    // into the wrong deployment.
    it('tags the same room apart across origins', async () => {
      const { service: production } = makeService('https://tokenizer.fr');
      const { service: local } = makeService('http://localhost:8080');

      const fromProduction = await production.render(GAME_UUID);
      const fromLocal = await local.render(GAME_UUID);

      expect(fromProduction.etag).not.toBe(fromLocal.etag);
    });
  });
});
