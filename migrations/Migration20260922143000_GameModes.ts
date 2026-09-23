import { Migration } from '@mikro-orm/migrations';

/**
 * Stamps the mode onto `game_sessions.config`, rewriting the rows that predate
 * the discriminator into poker's shape.
 *
 * The column is jsonb, so nothing about the table changes — but the config is
 * re-validated against `gameConfigSchema` every time a room is re-opened, and a
 * row carrying neither `mode` nor poker's `rules` would fail that parse and
 * take its session with it. Every table that existed before the discriminator
 * was poker in all but name, so the mapping is direct: the forced bets labelled
 * `small_blind` and `big_blind` were the blinds, an `ante` was an ante, and the
 * old raise form had no cap, which is no-limit.
 *
 * Only rows with no `mode` are touched. The shape being rewritten here is also
 * the shape a `FREE` table legitimately carries, so a config that already names
 * its mode is left exactly as it is — a free table is not an unmigrated poker
 * one.
 */
export class Migration20260922143000_GameModes extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      update "game_sessions" s
      set "config" = jsonb_build_object(
        'mode', 'POKER',
        'seating', s."config"->'seating',
        'rules', jsonb_build_object(
          'blinds', jsonb_build_object(
            'small', coalesce((
              select (b->>'amount')::int
              from jsonb_array_elements(coalesce(s."config"->'economy'->'forcedBets', '[]'::jsonb)) b
              where b->>'label' = 'small_blind'
              limit 1
            ), 5),
            'big', coalesce((
              select (b->>'amount')::int
              from jsonb_array_elements(coalesce(s."config"->'economy'->'forcedBets', '[]'::jsonb)) b
              where b->>'label' = 'big_blind'
              limit 1
            ), 10)
          ),
          'ante', coalesce((
            select (b->>'amount')::int
            from jsonb_array_elements(coalesce(s."config"->'economy'->'forcedBets', '[]'::jsonb)) b
            where b->>'label' = 'ante'
            limit 1
          ), 0),
          'bettingStructure', 'NO_LIMIT',
          'chipModel', coalesce(s."config"->'economy'->>'chipModel', 'ABSTRACT_BALANCE')
        )
      )
      where s."config" ? 'economy'
        and not (s."config" ? 'mode');
    `);

    // A table whose big blind was set under its small one was legal in the old
    // shape and is not in this one, so it is lifted rather than left to fail
    // the very parse this migration exists to satisfy.
    this.addSql(`
      update "game_sessions"
      set "config" = jsonb_set(
        "config",
        '{rules,blinds,big}',
        "config"->'rules'->'blinds'->'small'
      )
      where "config" ? 'rules'
        and ("config"->'rules'->'blinds'->>'big')::int
          < ("config"->'rules'->'blinds'->>'small')::int;
    `);
  }

  /**
   * Back to the shape the free mode carries, rebuilt from the blinds and the
   * defaults every row held: the turn policy, the end policy and the action
   * catalog were the same four actions on every table that existed before the
   * discriminator, so restoring them is a real inverse rather than a guess.
   *
   * Poker's rows only. A `FREE` config is already in this shape and was never
   * produced by the up migration, so rewriting it would be inventing blinds it
   * never had.
   */
  override async down(): Promise<void> {
    this.addSql(`
      update "game_sessions" s
      set "config" = jsonb_build_object(
        'mode', 'FREE',
        'seating', s."config"->'seating',
        'economy', jsonb_build_object(
          'potMode', 'SINGLE',
          'chipModel', s."config"->'rules'->>'chipModel',
          'payoutMode', 'WINNER_TAKES_ALL',
          'forcedBets', (
            case when (s."config"->'rules'->>'ante')::int > 0
              then jsonb_build_array(
                jsonb_build_object('label', 'ante', 'amount', (s."config"->'rules'->>'ante')::int, 'seatOffset', 0)
              )
              else '[]'::jsonb
            end
            || jsonb_build_array(
              jsonb_build_object('label', 'small_blind', 'amount', (s."config"->'rules'->'blinds'->>'small')::int, 'seatOffset', 0),
              jsonb_build_object('label', 'big_blind', 'amount', (s."config"->'rules'->'blinds'->>'big')::int, 'seatOffset', 1)
            )
          )
        ),
        'actionCatalog', '[
          {"id":"check","label":"Check","amountForm":"NONE","grantsInterruption":false},
          {"id":"call","label":"Call","amountForm":"CONSTRAINED","grantsInterruption":false},
          {"id":"raise","label":"Raise","amountForm":"RAISE","grantsInterruption":false},
          {"id":"fold","label":"Fold","amountForm":"NONE","grantsInterruption":false,"foldsParticipant":true}
        ]'::jsonb,
        'turnPolicy', jsonb_build_object(
          'regime', 'SEQUENTIAL',
          'direction', 'CLOCKWISE',
          'interruptionWindow', null
        ),
        'endPolicy', jsonb_build_object(
          'resolution', 'AUTOMATIC',
          'conditions', jsonb_build_array(
            jsonb_build_object('type', 'LAST_PLAYER_STANDING', 'params', null)
          )
        )
      )
      where s."config"->>'mode' = 'POKER';
    `);
  }
}
