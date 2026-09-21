import { ConfigService } from '@modules/config/config.service';
import * as Constants from '@modules/game-core/game-core.constants';
import { Injectable } from '@nestjs/common';
import { buildGameJoinPath } from '@tokenizer/shared/schemas';
import * as crypto from 'crypto';
import * as QRCode from 'qrcode';

/** A rendered join QR and the tag that identifies these exact bytes. */
export interface GameQrImage {
  png: Buffer;
  etag: string;
}

/**
 * Renders the QR a host points the table at.
 *
 * It encodes the join _link_, not the 6-digit code: the code is an ephemeral
 * Redis key that lapses under its own TTL, so a QR carrying it would go stale
 * on a wall while the room it names is still perfectly playable. The link
 * carries the session uuid, which never changes — which is also why the image
 * is safe to cache forever.
 *
 * Nothing is stored. The bytes are a pure function of the uuid and the public
 * origin, so rendering on demand costs one call and saves a bucket object, a
 * cleanup path, and a way for the two to disagree.
 */
@Injectable()
export class GameQrService {
  constructor(private readonly configService: ConfigService) {}

  /** The absolute URL a scan lands on. */
  public joinUrl(gameUuid: string): string {
    const origin = this.configService.get('FRONTEND_URL').replace(/\/+$/, '');
    return `${origin}${buildGameJoinPath(gameUuid)}`;
  }

  /**
   * The join QR as a PNG, with the tag a conditional request revalidates on.
   *
   * The tag is taken over the encoded payload rather than the bytes: it is the
   * payload that identifies the room, and hashing it means a re-render under a
   * different png encoder still answers 304 to a client holding the same link.
   */
  public async render(gameUuid: string): Promise<GameQrImage> {
    const payload = this.joinUrl(gameUuid);

    const png = await QRCode.toBuffer(payload, {
      type: 'png',
      errorCorrectionLevel: Constants.JOIN_QR_ERROR_CORRECTION,
      width: Constants.JOIN_QR_WIDTH_PX,
      margin: Constants.JOIN_QR_MARGIN_MODULES,
    });

    const digest = crypto.createHash('sha256').update(payload).digest('hex');
    return { png, etag: `"${digest}"` };
  }
}
