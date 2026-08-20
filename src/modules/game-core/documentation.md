# Objets de configuration

```
GameConfig
  ├── seating: SeatingPolicy        (Axe S — la table)
  ├── economy: EconomyPolicy        (Axe A)
  ├── actionCatalog: ActionDef[]    (Axe B)
  ├── turnPolicy: TurnPolicy        (Axe C)
  └── endPolicy: EndPolicy          (Axe D)
```

```
SeatingPolicy (les sièges sont déclarés à la création)
  ├── count: number                 (sièges créés, hôte inclus ; min 2)
  ├── initialBalance: number        (solde de départ de chaque siège)
  └── allowMidGameClaims: bool      (défaut true ; false = sièges libres
                                     verrouillés dès que la partie démarre)
```

```
EconomyPolicy
  ├── potMode: enum { SINGLE, MULTIPLE_SIDEPOTS }
  ├── chipModel: enum { ABSTRACT_BALANCE, DENOMINATED }
  ├── forcedBets: ForcedBet[]       (blindes, antes)
  └── payoutMode: enum { WINNER_TAKES_ALL, SPLIT, PEER_TO_PEER }
```

```
ActionDef
  ├── id: string                    (ex: "raise")
  ├── label: string
  ├── amountForm: enum { NONE, FREE, CONSTRAINED, RAISE }
  ├── grantsInterruption: bool      (cette action peut-elle voler le tour ?)
  └── foldsParticipant: bool?       (cette action retire-t-elle le joueur du round ?)
```

```
TurnPolicy
  ├── regime: enum { SEQUENTIAL, SEQUENTIAL_INTERRUPTIBLE, SIMULTANEOUS }
  ├── direction: enum { CLOCKWISE, COUNTER_CLOCKWISE }
  └── interruptionWindow: Duration  (null si non-interruptible)
```

```
EndPolicy
  ├── resolution: enum { MANUAL_HOST, AUTOMATIC }
  └── conditions: EndCondition[]    (vide en v0 si MANUAL_HOST)
```

# Modèle de participants (sièges déclarés puis réclamés)

La création d'une session crée `seating.count` lignes `game_participants` :

- **Siège 0 = `HOST`** — réclamé immédiatement par le propriétaire de la
  session (l'utilisateur connecté, référencé par `game_sessions.owner`).
- **Sièges suivants = `PLAYER`** — libres (`WAITING`), sans nom ni contrôleur.

Un joueur **réclame** ensuite un siège (`claim`) avec son _external ID_
(UUID d'un utilisateur connecté ou ID de session d'un anonyme) : le siège
reçoit `claimedBy` / `claimedAt` / `displayName` et passe `ACTIVE`. Réclamer
avec le même external ID est idempotent (survit aux reconnexions), et reste
possible entre deux rounds tant que la session n'est pas `FINISHED` — sauf si
`seating.allowMidGameClaims` est `false`, auquel cas les sièges libres sont
verrouillés dès que la partie démarre (`RUNNING`) ; les reconnexions d'un
joueur déjà assis restent toujours permises. Un arrivant en cours de partie
n'entre pas dans le round en cours (les contendants sont figés au
`startRound`) : il joue à partir du round suivant. Un siège non réclamé reste
`WAITING` et **ne participe pas aux rounds**.

La colonne `user_uuid` (nullable) est prête pour la liaison à un compte : un
siège `PLAYER` pourra être soit lié à un user en base, soit occupé par un
joueur de la room via `claimed_by`. Elle est réservée aux sièges `PLAYER` —
l'hôte est déjà porté par `game_sessions.owner`, donc une ligne `HOST` garde
`user_uuid` vide (contrainte `CHECK` en base).

# Objets runtime (pendant une partie)

```
GameSession
  ├── id: string                    (= uuid de la ligne game_sessions)
  ├── status: enum { LOBBY, RUNNING, FINISHED }
  ├── config: GameConfig            (référence, lecture seule)
  ├── participants: Map<id, Participant>  (tous les sièges)
  ├── currentRound: Round?
  └── méthodes:
      + claimSeat()
      + startRound()                (≥ 2 sièges réclamés non éliminés)
      + closeSession()
```

```
Participant (un siège ; id = uuid de la ligne game_participants)
  ├── id, seatIndex, role: enum { HOST, PLAYER }
  ├── displayName: string?          (null tant que non réclamé)
  ├── balance: number               (persiste entre les rounds, resynchronisé en BDD à chaque résolution)
  ├── status: enum { ACTIVE, FOLDED, ELIMINATED, WAITING }
  └── controller: string?           (external ID occupant le siège ; null si libre)
```

note Participant ≠ User : le découplage permet les sièges anonymes et, plus
tard, les actions par procuration (l'hôte qui joue pour un participant).

```
Round
  ├── id: RoundId
  ├── status: enum { INIT, IN_PROGRESS, RESOLVED }
  ├── pots: Pot[]                   (pot principal ; side-pots à venir)
  ├── turnState: TurnState
  ├── actionLog: Action[]           (flux ordonné, append-only)
  └── méthodes:
      + applyForcedBets()
      + submitAction(Action)        (valide via ActionDef + TurnPolicy)
      + resolve()                   (via EndPolicy ; répartit les pots)
```

```
TurnState (l'état "qui agit maintenant", piloté par TurnPolicy)
  ├── activeParticipant, interruptionOpen, pendingClaims
  └── méthodes:
      + computeLegalActions()       (fenêtre ouverte ⇒ actions interruptives uniquement)
      + advance()                   (siège suivant encore ACTIVE — un fold passe au
                                     siège d'après, jamais retour au siège 0)
      + openInterruptionWindow() / resolveClaims()
```

Pendant qu'une fenêtre d'interruption est ouverte, **seules** les actions
`grantsInterruption` sont acceptées (pour tout le monde) : les réclamations en
attente ne peuvent pas être écrasées par une action normale.

# Runtime API (POC)

## Couches

```
GameRuntimeController (REST)  ─┐
GameRuntimeGateway (WebSocket) ┘→ GameRoomsService ── orchestration + persistance
                                    │        (claims, soldes, closed_at, rooms Redis)
                                    ├→ GameSessionsService (lignes game_sessions/participants)
                                    └→ GameRuntimeService ── registre en mémoire
                                         └ agrégat : GameSession └ Round └ TurnState / Pot
```

- **GameRuntimeService** — runtime pur en mémoire, sans transport ni BDD.
- **GameRoomsService** — ouvre les rooms _lazily_ depuis les lignes persistées
  (config + sièges + soldes), resynchronise les soldes à chaque résolution de
  round et à la fermeture, ferme une room vide après 5 minutes (occupation des
  sockets suivie dans Redis core). Une room fermée pour inactivité se ré-ouvre
  au prochain fetch **sans perte d'état**.
- **game-runtime.snapshot.ts** — read-models plats (`GameSnapshot`). Seules ces
  formes franchissent la frontière du module.

## Identité & autorisations

- Le **claim** et les **actions** portent l'external ID (POC ; une version
  durcie le dériverait du handshake de session Passport).
- Les transitions d'hôte — `start_round`, `resolve`, `close` — sont réservées
  à l'occupant du siège `HOST` : côté REST c'est l'utilisateur connecté
  (`req.user`), côté WebSocket l'identité attachée au socket.
- Tous les payloads WebSocket sont validés avec les schémas Zod partagés,
  comme les routes REST.

## Endpoints REST — routeur `games`

| Méthode & route                          | Rôle                                                         |
| ---------------------------------------- | ------------------------------------------------------------ |
| `POST /games`                            | Crée la session + ses sièges (`config` optionnelle)          |
| `GET /games/:id`                         | Snapshot courant (ré-ouvre la room au besoin)                |
| `POST /games/:id/participants`           | Réclame un siège (`externalId`, `displayName`, `seatIndex?`) |
| `POST /games/:id/rounds`                 | **Hôte** — démarre un round + forced bets                    |
| `POST /games/:id/actions`                | Soumet une action (`externalId`, `definitionId`, `amount?`)  |
| `POST /games/:id/rounds/current/resolve` | **Hôte** — résolution manuelle (`winnerExternalIds?`)        |
| `DELETE /games/:id`                      | **Hôte** — ferme la session                                  |

## Événements WebSocket (socket.io)

Le client émet des messages `game:*` (avec ack) ; le serveur diffuse l'état à
tous les sockets de la room `game:<id>`.

**Émis par le client :**

| Message            | Payload                                                           |
| ------------------ | ----------------------------------------------------------------- |
| `game:create`      | `{ externalId (uuid), config? }` — le siège hôte est déjà réclamé |
| `game:join`        | `{ gameId, externalId, displayName, seatIndex? }`                 |
| `game:start_round` | `{ gameId }` (hôte)                                               |
| `game:action`      | `{ gameId, definitionId, amount? }` (identité = socket)           |
| `game:resolve`     | `{ gameId, winnerExternalIds? }` (hôte)                           |
| `game:snapshot`    | `{ gameId }`                                                      |
| `game:close`       | `{ gameId }` (hôte)                                               |

**Diffusés par le serveur (room) :** `game:participant_joined`,
`game:round_started`, `game:action_applied`, `game:round_resolved`
(+ `resolution`), `game:session_closed`, `game:error`.

## Flux de gameplay type

1. `game:create` → l'hôte crée la session ; ses sièges existent déjà, le sien
   (seat 0) est réclamé.
2. `game:join` ×N → les joueurs réclament les sièges libres.
3. `game:start_round` (hôte) → forced bets appliqués, round `IN_PROGRESS` ;
   les sièges non réclamés restent `WAITING` hors du round.
4. `game:action` (check / call / raise / fold) chacun à son tour.
5. Après chaque action, les conditions de fin sont évaluées ; à la résolution,
   les pots sont répartis et **les soldes sont persistés en BDD**.
6. `game:close` (hôte) → soldes finaux persistés, `closed_at` posé : la
   session ne se ré-ouvrira plus.

## Conditions de fin (v0)

- `MANUAL_HOST` — l'hôte termine via `game:resolve` / l'endpoint REST.
- `AUTOMATIC` + condition `LAST_PLAYER_STANDING` — dès qu'il ne reste qu'un
  seul contendant, le round se résout et le survivant remporte le(s) pot(s).

## Preset par défaut

Sièges : 4 (hôte inclus), solde 1000. Économie : pot `SINGLE`,
`ABSTRACT_BALANCE`, `WINNER_TAKES_ALL`, forced bets small blind (5) / big
blind (10). Catalogue : `check`, `call`, `raise`, `fold`. Tours : `SEQUENTIAL`
/ `CLOCKWISE`. Fin : `AUTOMATIC` + `LAST_PLAYER_STANDING`.
