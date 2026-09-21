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
  session (l'utilisateur connecté, référencé par `game_sessions.owner`), à la
  création, dans le runtime comme en base. Un joueur qui prend « le premier
  siège libre » ne peut jamais tomber dessus : l'autorité d'hôte est portée
  par le siège, donc le céder au premier arrivant reviendrait à lui donner le
  contrôle de la partie.
- **Sièges suivants = `PLAYER`** — libres (`WAITING`), sans nom ni contrôleur.

Un joueur **réclame** ensuite un siège (`claim`). Son identité n'est jamais
fournie par le client : elle est décidée côté serveur — l'UUID de
l'utilisateur si la session Passport est présente, sinon un identifiant
anonyme généré. Cet identifiant (`claimedBy`) reste **interne au module** : il
ne figure dans aucun snapshot. Le siège reçoit `claimedBy` / `claimedAt` /
`displayName` et passe `ACTIVE`. Réclamer avec la même identité est
idempotent (survit aux reconnexions), et reste
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

# Architecture d'exécution

Trois supports, trois rôles, et aucun recouvrement — c'est la contrainte
structurante du module.

```
PostgreSQL ── source de vérité          statut, sièges, soldes, claims, activité
Redis ────── code éphémère uniquement   game_code:{code} → uuid  (+ l'index inverse)
Socket.IO ── présence                   adapter.rooms.get(`game:{uuid}`)
BullMQ ───── décisions différées        grâces + balayage de secours
```

L'agrégat runtime en mémoire (`GameRuntimeService`) est un **cache** des
lignes persistées, reconstruit à l'ouverture d'une room et resynchronisé à
chaque règlement. Ce n'est pas une source de vérité : le perdre ne coûte
qu'une relecture.

## 1. Modèle de données (PostgreSQL)

`game_sessions` — `uuid` (PK), `name`, `config` (jsonb), `status`
(`LOBBY` / `RUNNING` / `FINISHED` / `ABANDONED`), `owner_uuid`, `created_at`,
`last_activity_at`, `closed_at`.

**Aucune colonne `join_code`.** Le code est éphémère par nature : une colonne
l'aurait rendu incapable d'expirer sans écriture, et son index unique aurait
gardé un code otage d'une partie terminée depuis des mois.

`game_participants` — un siège déclaré : `seat_index`, `role`, `display_name`
(override), `initial_balance`, `balance`, `claimed_by`, `claimed_at`,
`user_uuid`.

Index `idx_game_sessions_stale` sur `(status, last_activity_at)` filtré sur
`closed_at is null` : exactement le prédicat du balayage périodique.

## 2. Redis : le code à 6 chiffres

```
game_code:{code} → {uuid}     TTL 30 min, glissant
game_uuid:{uuid} → {code}     TTL 30 min, glissant (même mapping, lu à l'envers)
```

Le tirage est **revendiqué** par `SET NX EX`, jamais précédé d'une lecture :
un `GET` puis `SET` laisserait ouverte précisément la course que le `NX`
ferme. Un `NX` refusé déclenche un nouveau tirage, jusqu'à
`JOIN_CODE_MAX_ATTEMPTS` — dix collisions sur 10^6 signifient que l'espace est
saturé, et la réponse est alors un code plus long, pas une tentative de plus.

L'index inverse est la **seule** extension à la règle « Redis ne porte que
`code → uuid` », et c'est le même mapping lu dans l'autre sens. Sans lui
l'hôte ne peut pas afficher le code à dicter, et chaque rechargement de page
devrait en frapper un nouveau — invalidant celui déjà dicté à voix haute.

Le TTL est repoussé à chaque activité (join, action, résolution). Un code déjà
expiré n'est **pas** ressuscité : re-frapper ici donnerait à une room vivante
un code que personne n'a entendu.

Une partie qui perd son code reste parfaitement jouable par son UUID. C'est
tout l'intérêt de séparer les deux.

## 3. Flux d'accès

**a. Par lien `/game/{uuid}`** — `GET /games/:uuid` vérifie l'existence et le
statut en PostgreSQL, ouvre la room, renvoie le snapshot.

**b. Par code à 6 chiffres**

| Route                           | Rôle                                            | Limite   |
| ------------------------------- | ----------------------------------------------- | -------- |
| `POST /games/join-by-code`      | `{ code }` → `{ gameUuid }`, rien d'autre       | 10 / min |
| `GET /games/room-by-code/:code` | Vue publique : nom, statut, sièges pris / total | 20 / min |

La vue publique **n'inclut pas l'UUID** : voir une room et y être admis sont
deux privilèges distincts. Un code inexistant et un code expiré renvoient le
même 404 au même corps — les distinguer confirmerait quels codes ont été
émis, ce que cherche exactement un énumérateur. Un espace de 10^6 non limité
serait cartographié en quelques minutes.

## 4. Présence et cycle de vie

La présence est lue directement sur l'adapter Socket.IO. Les connexions y
sont déjà ; les recopier ailleurs ne créerait qu'une seconde version de la
vérité, capable de diverger si le process meurt au milieu d'un disconnect.

Tout passe par `GamePresenceService.isRoomEmpty(uuid)` / `roomSize(uuid)` —
jamais par un accès direct à l'adapter. C'est délibéré : passer en
multi-instance revient à remplacer le corps de ces deux méthodes, et rien
d'autre dans le module.

Deux horloges indépendantes, toutes deux portées par BullMQ :

```
déconnexion d'un socket
   ├─ PLAYER_DISCONNECT_GRACE_MS (15 s)  jobId = player-disconnected:{uuid}:{seat}
   │     └─ à l'échéance : le siège a-t-il un socket ? sinon → PARTICIPANT_LEFT
   └─ si la room est vide :
      ROOM_EMPTY_GRACE_MS (5 min)        jobId = close-empty-room:{uuid}
            └─ à l'échéance : la room est-elle encore vide ? sinon → on ne touche à rien
                                          si oui → statut ABANDONED, sockets fermés
```

Les `jobId` sont **dérivés**, jamais aléatoires : une reconnexion peut annuler
un job par son nom seul, sans avoir gardé de poignée dessus, et une seconde
planification remplace la première au lieu de s'empiler dessus.

Chaque job **revérifie la présence avant d'agir**. Il a été planifié parce que
la room semblait vide il y a cinq minutes ; entre-temps quelqu'un a pu
revenir, et fermer la partie sous ses pieds serait pire que ne jamais la
fermer. La course est réelle, la vérification n'est pas optionnelle.

Un siège dont le joueur ne revient pas **reste le sien** : son token le
réclame toujours, et libérer un siège en plein round corromprait la partie.
Seule la table est informée, pour que chacun voie qui est réellement là.

Rien n'est fait sur Redis à l'abandon : le TTL retire le code tout seul.

### Pourquoi une queue et pas un `setTimeout`

C'était un `setTimeout` dans une `Map` du service. Un redémarrage — déploiement,
crash, OOM kill — vidait la map, et les rooms qu'elle suivait restaient
ouvertes pour toujours, sans plus rien pour les fermer. Survivre au process est
toute la raison d'être de l'indirection.

## 5. Job de secours

`sweep-stale-sessions`, toutes les 10 minutes (`upsertJobScheduler` sur un id
fixe, pour qu'une boucle de redémarrage ne empile pas les plannings) : ferme
les sessions encore `LOBBY`/`RUNNING` silencieuses depuis plus d'une heure, par
lots de 200.

C'est le filet pour un job perdu entre sa planification et son exécution. Sans
lui une telle session resterait jouable indéfiniment, et plus rien ne la
regarderait jamais. Là encore la présence a le dernier mot : une partie peut
sembler morte sur le papier et être simplement en pleine réflexion.

## 6. Identité et autorisations

### Le token joueur

Avant, l'identité in-game était un `externalId` **envoyé dans le payload**. Or
pour un joueur connecté cet `externalId` était son UUID utilisateur, et le
snapshot le diffusait à toute la room : n'importe qui à la table pouvait le
recopier et jouer à sa place. Pour un anonyme, c'était un identifiant
auto-déclaré sans aucune preuve.

Un join réussi (`POST /games/:uuid/participants`, ou la création de partie qui
assied l'hôte) émet un **JWT signé** portant `{ gameUuid, participantId }` :

- **L'identité est décidée côté serveur** : session Passport si elle existe,
  sinon un identifiant anonyme généré. Le client n'en propose jamais.
- **Il est cantonné à un siège d'une partie.** Un token valide pour une autre
  partie est refusé à la vérification, pas plus loin.
- **Il porte la reconnexion.** Le joueur qui recharge sa page le représente et
  retrouve sa chaise — ce qui donne un sens au délai de tolérance serveur.

Le socket ne frappe aucune identité : `game:attach` rejoue ce token, et tous
les messages suivants sont autorisés à partir de ce à quoi le socket a été
lié — jamais à partir de leur payload.

Le snapshot **ne porte plus `controller`**. Chaque siège expose `claimed`
(occupé ou non) et `connected` (socket vivant) ; un client reconnaît le sien
par le `participantId` de son propre token.

### Ce que le code ne permet pas

Le code n'ouvre que le lobby. Il ne donne accès à aucune donnée d'un autre
joueur, ni à aucune transition d'hôte. La room socket est **exclusivement**
nommée par l'UUID : une room nommée par le code lierait sa durée de vie à un
TTL qui n'a rien à voir avec la partie.

## 7. Limites connues — et ce qu'il faudra faire ensuite

**Cette architecture suppose une seule instance backend.** C'est une hypothèse
assumée, pas un oubli :

- La présence vit dans l'adapter Socket.IO **en mémoire** du process. Une
  seconde instance ne verrait pas les sockets de la première : chacune
  croirait la room vide et toutes deux planifieraient sa fermeture.
- Les broadcasts ne franchissent pas la frontière du process : un joueur
  connecté à l'instance A ne recevrait pas les actions jouées sur l'instance B.
- L'agrégat runtime en mémoire serait dupliqué, deux copies dérivant entre
  deux relectures.
- Le compteur du `ThrottlerModule` est lui aussi en mémoire : avec N instances,
  les limites des routes de code deviennent de fait N fois plus permissives —
  soit exactement l'inverse de ce qu'elles protègent. Il faudra un
  `ThrottlerStorageRedisService` partagé.

**Ce qu'il faudrait ajouter le jour où le besoin existe** (et pas avant) :

- soit des **sticky sessions par `game_uuid`** au niveau du load balancer —
  toutes les connexions d'une partie sur la même instance, ce qui conserve
  l'intégralité du modèle actuel ;
- soit un **pub/sub inter-instances** (`socket.io-redis-adapter`) **plus** une
  présence distribuée (Set Redis avec TTL par membre), et alors le runtime en
  mémoire doit disparaître au profit d'un état de round persisté.

**Le point d'ancrage est déjà isolé** : `isRoomEmpty(uuid)` et `roomSize(uuid)`
sont les deux seuls endroits qui lisent la présence. Les réécrire suffit pour
le premier volet ; rien d'autre dans le module n'y touche.

**Ce qui n'est pas encore fait** : l'état de round (`Round`, `TurnState`,
`Pot`, `actionLog`) vit toujours en mémoire et n'est persisté qu'à la
résolution, sous forme de soldes. Un crash en plein round perd le round en
cours, pas la partie. Le rendre pleinement conforme au principe « PostgreSQL
seule source de vérité » demande des tables `game_rounds` /
`game_round_actions` et un runtime rechargé à chaque transition — c'est le
chantier suivant, et c'est aussi le préalable au multi-instance.

# Runtime API

## Couches

```
GameRuntimeController (REST)  ─┐
GameRuntimeGateway (WebSocket) ┘→ GameRoomsService ── orchestration
                                    ├→ GameSessionsService  lignes persistées (vérité)
                                    ├→ GameCodesService     code éphémère (Redis)
                                    ├→ GamePresenceService  qui est connecté
                                    ├→ GameLifecycleService décisions différées (BullMQ)
                                    ├→ GameTokensService    token joueur (JWT)
                                    └→ GameRuntimeService   cache en mémoire
                                         └ agrégat : GameSession └ Round └ TurnState / Pot
```

## Endpoints REST — routeur `games`

| Méthode & route                            | Rôle                                                          |
| ------------------------------------------ | ------------------------------------------------------------- |
| `POST /games`                              | **Connecté** — crée la session, assied l'hôte, émet son token |
| `POST /games/join-by-code`                 | Résout un code → `{ gameUuid }` (10/min)                      |
| `GET /games/room-by-code/:code`            | Vue publique allégée (20/min)                                 |
| `GET /games/:uuid`                         | Snapshot courant (ouvre la room au besoin)                    |
| `POST /games/:uuid/participants`           | Prend un siège, **émet le token joueur**                      |
| `PATCH /games/:uuid/participants/current`  | Renomme son propre siège                                      |
| `POST /games/:uuid/rounds`                 | **Hôte** — démarre un round                                   |
| `POST /games/:uuid/actions`                | Soumet une action                                             |
| `POST /games/:uuid/rounds/current/resolve` | **Hôte** — résolution manuelle                                |
| `DELETE /games/:uuid`                      | **Hôte** — ferme la session                                   |

Sauf `POST /games` (session Passport) et les deux routes de code (publiques),
chaque route lit le token joueur dans l'en-tête **`x-player-token`**.

## Événements WebSocket (socket.io)

Room : `game:<uuid>`. Jamais le code.

**Émis par le client :**

| Message            | Payload                                           |
| ------------------ | ------------------------------------------------- |
| `game:attach`      | `{ gameUuid, token }` — lie le socket à son siège |
| `game:update_seat` | `{ displayName? }`                                |
| `game:start_round` | — (hôte)                                          |
| `game:action`      | `{ definitionId, amount?, targetParticipantId? }` |
| `game:resolve`     | `{ winnerParticipantIds? }` (hôte)                |
| `game:snapshot`    | —                                                 |
| `game:close`       | — (hôte)                                          |

Aucun de ces payloads ne nomme la partie ni le siège : les deux viennent de ce
à quoi `game:attach` a lié le socket.

**Diffusés par le serveur (room) :** `game:participant_joined`,
`game:participant_updated`, `game:participant_disconnected`,
`game:participant_left`, `game:round_started`, `game:action_applied`,
`game:round_resolved` (+ `resolution`), `game:session_closed`, `game:error`.

## Flux de gameplay type

1. `POST /games` → l'hôte crée la session ; il occupe le siège 0 et reçoit son
   token. Le code à 6 chiffres est frappé dans Redis.
2. Un joueur arrive par lien (`/game/{uuid}`) ou par code
   (`POST /games/join-by-code` → `{ gameUuid }`).
3. `POST /games/:uuid/participants` → il prend un siège et reçoit son token.
4. `game:attach` → son socket rejoint la room `game:<uuid>` ; toute fermeture
   en attente est annulée.
5. `game:start_round` (hôte) → forced bets appliqués, statut `RUNNING`.
6. `game:action` chacun à son tour ; à la résolution les soldes sont persistés.
7. `game:close` (hôte) → soldes finaux, statut `FINISHED`, code révoqué,
   sockets fermés.

Si tout le monde part : 5 minutes plus tard, statut `ABANDONED`. Si le job est
perdu, le balayage horaire le rattrape.

## Conditions de fin (v0)

- `MANUAL_HOST` — l'hôte termine via `game:resolve` / l'endpoint REST.
- `AUTOMATIC` + condition `LAST_PLAYER_STANDING` — dès qu'il ne reste qu'un
  seul contendant, le round se résout et le survivant remporte le(s) pot(s).

## Preset par défaut

Sièges : 4 (hôte inclus), solde 1000. Économie : pot `SINGLE`,
`ABSTRACT_BALANCE`, `WINNER_TAKES_ALL`, forced bets small blind (5) / big
blind (10). Catalogue : `check`, `call`, `raise`, `fold`. Tours : `SEQUENTIAL`
/ `CLOCKWISE`. Fin : `AUTOMATIC` + `LAST_PLAYER_STANDING`.
