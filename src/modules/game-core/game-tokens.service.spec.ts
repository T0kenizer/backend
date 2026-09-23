import type { ConfigService } from '@modules/config/config.service';
import { GameTokensService } from '@modules/game-core/game-tokens.service';
import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

const GAME_UUID = '11111111-1111-4111-8111-111111111111';
const OTHER_GAME = '33333333-3333-4333-8333-333333333333';
const PARTICIPANT_ID = '22222222-2222-4222-8222-222222222222';

function build(secret = 'test-secret') {
  const config = { get: jest.fn().mockReturnValue(secret) };
  const service = new GameTokensService(
    new JwtService(),
    config as unknown as ConfigService,
  );
  return { service };
}

describe('GameTokensService', () => {
  it('round-trips the seat it was issued for', () => {
    const { service } = build();

    const token = service.issue({
      gameUuid: GAME_UUID,
      participantId: PARTICIPANT_ID,
    });

    expect(service.verify(token, GAME_UUID)).toMatchObject({
      gameUuid: GAME_UUID,
      participantId: PARTICIPANT_ID,
    });
  });

  it('refuses a valid token issued for another game', () => {
    const { service } = build();
    const token = service.issue({
      gameUuid: GAME_UUID,
      participantId: PARTICIPANT_ID,
    });

    // Scoping is the point: a token is worth a seat in one session, nowhere
    // else, so holding one game's token opens no door in another.
    expect(() => service.verify(token, OTHER_GAME)).toThrow(
      UnauthorizedException,
    );
  });

  it('refuses a token signed with a different secret', () => {
    const mint = build('the-real-secret').service;
    const token = mint.issue({
      gameUuid: GAME_UUID,
      participantId: PARTICIPANT_ID,
    });

    const { service } = build('a-forger-secret');
    expect(() => service.verify(token, GAME_UUID)).toThrow(
      UnauthorizedException,
    );
  });

  it('refuses a tampered token', () => {
    const { service } = build();
    const token = service.issue({
      gameUuid: GAME_UUID,
      participantId: PARTICIPANT_ID,
    });
    // Swapping the payload for another seat's is exactly the attack the old
    // payload-carried externalId allowed.
    const [header, , signature] = token.split('.');
    const forgedPayload = Buffer.from(
      JSON.stringify({
        gameUuid: GAME_UUID,
        participantId: '44444444-4444-4444-8444-444444444444',
      }),
    ).toString('base64url');

    expect(() =>
      service.verify(`${header}.${forgedPayload}.${signature}`, GAME_UUID),
    ).toThrow(UnauthorizedException);
  });

  it('refuses a well-signed token whose payload is not a seat binding', () => {
    const jwt = new JwtService();
    const token = jwt.sign({ hello: 'world' }, { secret: 'test-secret' });

    const { service } = build();
    expect(() => service.verify(token, GAME_UUID)).toThrow(
      UnauthorizedException,
    );
  });

  it('refuses garbage', () => {
    const { service } = build();
    expect(() => service.verify('not-a-token', GAME_UUID)).toThrow(
      UnauthorizedException,
    );
  });
});
