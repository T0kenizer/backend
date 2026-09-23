import type {
  AddSeatParams,
  ClaimParams,
  SeatInit,
  UpdateSeatParams,
} from '@modules/game-core/game-core.types';
import { Participant } from '@modules/game-core/runtime/participant';
import { BadRequestException } from '@nestjs/common';
import {
  MAX_SEATS,
  MIN_SEATS,
} from '@tokenizer/shared/constants/games.constants';
import {
  GameSessionStatus,
  ParticipantRole,
  type GameConfig,
} from '@tokenizer/shared/types';

export abstract class GameSession<TConfig extends GameConfig = GameConfig> {
  readonly id: string;
  status: GameSessionStatus;
  readonly config: TConfig;
  readonly ownerUuid: string;
  readonly participants: Map<string, Participant>;

  constructor(
    id: string,
    config: TConfig,
    ownerUuid: string,
    seats: SeatInit[],
  ) {
    this.id = id;
    this.config = config;
    this.ownerUuid = ownerUuid;
    this.status = GameSessionStatus.Lobby;
    if (seats.length < MIN_SEATS || seats.length > MAX_SEATS) {
      throw new BadRequestException(
        `A table holds between ${MIN_SEATS} and ${MAX_SEATS} seats`,
      );
    }
    this.participants = new Map(
      seats.map((seat) => [seat.id, new Participant(seat)]),
    );
  }

  abstract get dealInProgress(): boolean;

  abstract get dealsPlayed(): number;

  protected abstract get dealNoun(): string;

  abstract closeSession(): void;

  get seats(): Participant[] {
    return [...this.participants.values()].sort(
      (a, b) => a.seatIndex - b.seatIndex,
    );
  }

  claimSeat(params: ClaimParams): Participant {
    if (this.status === GameSessionStatus.Finished) {
      throw new BadRequestException('Session is finished');
    }

    const seats = this.seats;
    const held = seats.find((p) => p.controller === params.holderId);
    if (held) return held;

    if (
      this.status === GameSessionStatus.Running &&
      !this.config.seating.allowMidGameClaims
    ) {
      throw new BadRequestException(
        'Seat claims are locked once the game has started',
      );
    }

    let seat: Optional<Participant>;
    if (params.seatIndex !== undefined) {
      seat = seats.find((p) => p.seatIndex === params.seatIndex);
      if (!seat) {
        throw new BadRequestException(
          `Seat ${params.seatIndex} does not exist`,
        );
      }
      if (seat.claimed) {
        throw new BadRequestException(
          `Seat ${params.seatIndex} is already claimed`,
        );
      }
      if (
        seat.role === ParticipantRole.Host &&
        params.holderId !== this.ownerUuid
      ) {
        throw new BadRequestException(
          'The host seat belongs to the table owner',
        );
      }
    } else {
      seat = seats.find((p) => !p.claimed && p.role !== ParticipantRole.Host);
      if (!seat) {
        throw new BadRequestException('No free seat left');
      }
    }

    seat.claim(params.holderId, params.displayName);
    return seat;
  }

  get canAddSeat(): boolean {
    if (!this.config.seating.allowExtraSeats) return false;
    if (this.participants.size >= MAX_SEATS) return false;
    if (this.status === GameSessionStatus.Finished) return false;
    if (this.dealInProgress) return false;
    return this.seats.every((seat) => seat.claimed);
  }

  assertCanAddSeat(): void {
    if (!this.config.seating.allowExtraSeats) {
      throw new BadRequestException(
        'This table was set up with a fixed number of seats',
      );
    }
    if (this.participants.size >= MAX_SEATS) {
      throw new BadRequestException(
        `A table cannot hold more than ${MAX_SEATS} seats`,
      );
    }
    if (this.status === GameSessionStatus.Finished) {
      throw new BadRequestException('Session is finished');
    }
    if (this.dealInProgress) {
      throw new BadRequestException(
        `A seat can only be added between ${this.dealNoun}s, not during one`,
      );
    }
    if (this.seats.some((seat) => !seat.claimed)) {
      throw new BadRequestException(
        'There is still a free seat — a new player should take that one',
      );
    }
  }

  addSeat(params: AddSeatParams): Participant {
    this.assertCanAddSeat();

    const seatIndex =
      this.seats.reduce(
        (highest, seat) => Math.max(highest, seat.seatIndex),
        -1,
      ) + 1;

    const seat = new Participant({
      id: params.id,
      seatIndex,
      role: ParticipantRole.Player,
      displayNameOverride: params.displayName,
      balance:
        params.initialBalance ?? this.config.seating.defaultInitialBalance,
      controller: null,
    });

    this.participants.set(seat.id, seat);
    return seat;
  }

  updateSeat(params: UpdateSeatParams): Participant {
    const seat = this.seatOrThrow(params.participantId);
    seat.update(params.displayName);
    return seat;
  }

  seatOrThrow(participantId: string): Participant {
    const seat = this.participants.get(participantId);
    if (!seat) {
      throw new BadRequestException(`Unknown participant "${participantId}"`);
    }
    return seat;
  }

  isHost(participantId: string): boolean {
    return this.participants.get(participantId)?.role === ParticipantRole.Host;
  }

  resolveActingParticipant(
    callerParticipantId: string,
    isConnected: (participantId: string) => boolean,
    targetParticipantId?: string,
  ): Participant {
    if (targetParticipantId === undefined) {
      return this.seatOrThrow(callerParticipantId);
    }

    if (!this.isHost(callerParticipantId)) {
      throw new BadRequestException(
        'Only the host can act on behalf of another seat',
      );
    }

    const seat = this.seatOrThrow(targetParticipantId);
    if (isConnected(seat.id)) {
      throw new BadRequestException(
        'The host can only act on behalf of a seat nobody is connected to',
      );
    }
    return seat;
  }

  protected assertNotFinished(): void {
    if (this.status === GameSessionStatus.Finished) {
      throw new BadRequestException('Session is already finished');
    }
  }

  protected startPlaying(): void {
    if (this.status === GameSessionStatus.Lobby) {
      this.status = GameSessionStatus.Running;
    }
  }
}
