import { GameRuntimeService } from '@modules/game-core/game-runtime.service';
import { promises as fs } from 'fs';

describe('GameRuntimeService (full gameplay flow)', () => {
  let service: GameRuntimeService;
  const cleanup: string[] = [];

  beforeEach(() => {
    service = new GameRuntimeService();
  });

  afterAll(async () => {
    await Promise.all(
      cleanup.map((f) => fs.rm(f, { force: true }).catch(() => undefined)),
    );
  });

  it('runs a round to a LAST_PLAYER_STANDING resolution and dumps a debug file', async () => {
    // 1. Host creates a session (default poker-like preset)
    const created = service.createSession();
    const gameId = created.id;

    // 2. Three participants join via their external identities
    service.join(gameId, {
      externalId: 'alice',
      displayName: 'Alice',
      initialBalance: 1000,
    });
    service.join(gameId, {
      externalId: 'bob',
      displayName: 'Bob',
      initialBalance: 1000,
    });
    service.join(gameId, {
      externalId: 'carol',
      displayName: 'Carol',
      initialBalance: 1000,
    });

    // 3. Round starts → forced bets applied (SB 5 on seat0, BB 10 on seat1)
    const snapshot = service.startRound(gameId);
    expect(snapshot.status).toBe('RUNNING');
    expect(snapshot.currentRound?.status).toBe('IN_PROGRESS');
    expect(snapshot.currentRound?.pots[0].amount).toBe(15);

    // 4. Play: Alice folds, then Bob folds → Carol is the last one standing
    const afterAlice = await service.submitAction(gameId, {
      externalId: 'alice',
      definitionId: 'fold',
    });
    expect(afterAlice.resolution).toBeUndefined();

    const afterBob = await service.submitAction(gameId, {
      externalId: 'bob',
      definitionId: 'fold',
    });

    // 5. End condition met — round resolved automatically
    expect(afterBob.resolution).toBeDefined();
    expect(afterBob.resolution?.reason).toBe('LAST_PLAYER_STANDING');

    const carolId = service.resolveParticipant(gameId, 'carol');
    expect(afterBob.resolution?.winners).toEqual([carolId]);
    expect(afterBob.snapshot.currentRound?.status).toBe('RESOLVED');

    // 6. Chips settled: Carol takes the 15-chip pot (SB 5 + BB 10)
    const balances = Object.fromEntries(
      afterBob.snapshot.participants.map((p) => [p.displayName, p.balance]),
    );
    expect(balances).toEqual({ Alice: 995, Bob: 990, Carol: 1015 });

    // 7. Debug artefact written to disk (DB persistence comes later)
    const debugFile = afterBob.resolution!.debugFile;
    cleanup.push(debugFile);
    const dumped = JSON.parse(await fs.readFile(debugFile, 'utf-8')) as {
      reason: string;
      winners: string[];
      game: { id: string };
    };
    expect(dumped.reason).toBe('LAST_PLAYER_STANDING');
    expect(dumped.winners).toEqual([carolId]);
    expect(dumped.game.id).toBe(gameId);
  });
});
