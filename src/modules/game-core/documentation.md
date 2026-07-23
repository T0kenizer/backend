# Objets de configuration

```
GameConfig
  ├── economy: EconomyPolicy        (Axe A)
  ├── actionCatalog: ActionDef[]    (Axe B)
  ├── turnPolicy: TurnPolicy        (Axe C)
  └── endPolicy: EndPolicy          (Axe D)
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
  └── grantsInterruption: bool      (cette action peut-elle voler le tour ?)
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

# Objets runtime (pendant une partie)

```
GameSession
  ├── id: GameSessionId
  ├── status: enum { LOBBY, RUNNING, FINISHED }
  ├── config: GameConfig            (référence, lecture seule)
  ├── participants: Participant[]
  ├── currentRound: Round?
  └── méthodes:
      + addParticipant()
      + startRound()
      + closeSession()
```

```
Participant
  ├── id: ParticipantId
  ├── displayName: string
  ├── balance: number               (persiste entre les rounds)
  ├── seatIndex: number             (ordre pour les tours)
  ├── status: enum { ACTIVE, FOLDED, ELIMINATED, WAITING }
  └── controller: UserId     (= soi-même par défaut ; = hôte si procuration)
```

note Participant /= User (pour activer les actions par procuration (l'hote qui joue pour un participant)

```
Round
  ├── id: RoundId
  ├── status: enum { INIT, IN_PROGRESS, RESOLVED }
  ├── pots: Pot[]                   (créés selon EconomyPolicy)
  ├── turnState: TurnState
  ├── actionLog: Action[]           (flux ordonné, append-only)
  └── méthodes:
      + applyForcedBets()
      + submitAction(Action)        (valide via ActionDef + TurnPolicy)
      + resolve()                   (via EndPolicy)
```

```
Pot (le contenant des mises d'un round)
  ├── id: PotId
  ├── amount: number
  ├── eligibleParticipants: ParticipantId[]   (pour les side-pots)
  └── méthodes:
      + addContribution()
      + awardTo()
```

```
TurnState (l'état "qui agit maintenant", piloté par TurnPolicy)
  ├── activeParticipant: ParticipantId
  ├── interruptionOpen: bool
  ├── pendingClaims: InterruptionClaim[]   (Mahjong : réclamations concurrentes)
  └── méthodes:
      + computeLegalActions(): ActionDef[]  (filtre le catalogue selon l'état)
      + advance()                            (prochain joueur)
      + openInterruptionWindow()
      + resolveClaims()                      (priorité entre voleurs)
```

```
Action (l'événement atomique, une instance exécutée d'un ActionDef)
  ├── id: ActionId
  ├── participantId: ParticipantId
  ├── definitionId: string          (référence l'ActionDef du catalogue)
  ├── amount: number?
  ├── timestamp
  └── (immuable une fois loggée)
```

# Runtime API (POC)

La couche runtime expose les objets ci-dessus via **REST** (inspection /
scripts) et **WebSocket** (gameplay live). Elle suppose que l'appelant est déjà
authentifié.

## Couches (DDD)

```
GameRuntimeController (REST)  ─┐
GameRuntimeGateway (WebSocket) ┘→ GameRuntimeService ── registre en mémoire
                                    (Map<GameSessionId, GameSession>)
                                    │
                                    └→ agrégat domaine : GameSession
                                         └ Round └ TurnState / Pot / Action
```

- **GameRuntimeService** — l'unique « game manager ». Détient les sessions en
  mémoire, orchestre le cycle de vie, résout les identités et évalue les
  conditions de fin. Aucune dépendance HTTP/WS.
- **game-runtime.snapshot.ts** — read-models plats (`GameSnapshot`). Seules ces
  formes franchissent la frontière du module ; les objets domaine restent
  internes.
- **game-runtime.presets.ts** — `defaultGameConfig()` (preset type poker).
- La persistance BDD n'est pas branchée : à la résolution d'un round, un
  artefact JSON est écrit dans `./debug/round-<id>.json` (dossier gitignoré).

## Modèle d'identité (Participant ⇔ external ID)

Un `Participant` est découplé de l'utilisateur. Il est dérivé d'un **external
ID** : l'UUID de l'utilisateur connecté ou l'ID de session d'un anonyme. Le
service tient une table `external ID → participantId` par session, donc rejoindre
avec le même external ID est idempotent (survit aux reconnexions).

> POC : l'external ID est fourni dans le payload. Une version durcie le dériverait
> du handshake de session Passport.

## Endpoints REST — routeur `games`

| Méthode & route                     | Rôle                                          |
| ----------------------------------- | --------------------------------------------- |
| `POST /games`                       | Crée une session (`config` optionnelle)       |
| `GET /games/:id`                    | Snapshot courant                              |
| `POST /games/:id/participants`      | Rejoint (`externalId`, `displayName`, solde)  |
| `POST /games/:id/rounds`            | Démarre un round + applique les forced bets   |
| `POST /games/:id/actions`           | Soumet une action (`externalId`, `definitionId`, `amount?`) |
| `POST /games/:id/rounds/current/resolve` | Résolution manuelle par l'hôte (`winnerExternalIds?`) |
| `DELETE /games/:id`                 | Ferme la session                              |

## Événements WebSocket (socket.io)

Le client émet des messages `game:*` (avec ack) ; le serveur diffuse l'état à
tous les sockets de la room `game:<id>`.

**Émis par le client :**

| Message            | Payload                                          |
| ------------------ | ------------------------------------------------ |
| `game:create`      | `{ externalId, displayName, initialBalance?, config? }` |
| `game:join`        | `{ gameId, externalId, displayName, initialBalance? }`  |
| `game:start_round` | `{ gameId }`                                     |
| `game:action`      | `{ gameId, definitionId, amount? }` (identité = socket) |
| `game:resolve`     | `{ gameId, winnerExternalIds? }`                 |
| `game:snapshot`    | `{ gameId }`                                     |
| `game:close`       | `{ gameId }`                                     |

**Diffusés par le serveur (room) :** `game:participant_joined`,
`game:round_started`, `game:action_applied`, `game:round_resolved`
(+ `resolution`), `game:session_closed`, `game:error`.

## Flux de gameplay type

1. `game:create` → l'hôte crée et rejoint (seat 0).
2. `game:join` ×N → les autres participants rejoignent.
3. `game:start_round` → forced bets appliqués (blindes), round `IN_PROGRESS`.
4. `game:action` (check / call / raise / fold) chacun à son tour ; `fold`
   retire le participant du round (`foldsParticipant`).
5. Après chaque action, les conditions de fin sont évaluées.
6. Condition remplie → le round est résolu, les pots attribués, un
   `game:round_resolved` est diffusé et un `debug/round-<id>.json` est écrit.

## Conditions de fin (v0)

- `MANUAL_HOST` — l'hôte termine via `game:resolve` / l'endpoint REST.
- `AUTOMATIC` + condition `LAST_PLAYER_STANDING` — dès qu'il ne reste qu'un seul
  contendant (les autres ayant `fold`), le round se résout automatiquement et le
  survivant remporte le(s) pot(s).

## Preset par défaut

Économie : pot `SINGLE`, `ABSTRACT_BALANCE`, `WINNER_TAKES_ALL`, forced bets
small blind (5) / big blind (10). Catalogue : `check`, `call`, `raise`, `fold`.
Tours : `SEQUENTIAL` / `CLOCKWISE`. Fin : `AUTOMATIC` +
`LAST_PLAYER_STANDING`.
