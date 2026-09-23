import { ConfigService } from '@modules/config/config.service';
import * as Constants from '@modules/game-core/game-core.constants';
import { Injectable } from '@nestjs/common';
import { buildGameJoinPath } from '@tokenizer/shared/utils/games.utils';
import * as crypto from 'crypto';
import * as QRCode from 'qrcode';

export interface GameQrImage {
  png: Buffer;
  etag: string;
}

@Injectable()
export class GameQrService {
  constructor(private readonly configService: ConfigService) {}

  public joinUrl(gameUuid: string): string {
    const origin = this.configService.get('FRONTEND_URL').replace(/\/+$/, '');
    return `${origin}${buildGameJoinPath(gameUuid)}`;
  }

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
