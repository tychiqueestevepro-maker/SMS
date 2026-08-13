# PLAN.md — Riink V1

## Source de vérité et périmètre

Ce fichier est la source de vérité unique de l’implémentation.

Riink V1 reste strictement limité à :

- `Campaigns`, `Contacts`, `Inbox`, `Settings` et `/admin`.
- Supabase, Twilio, Stripe et Vercel.
- Pipeline personnalisable.
- Campagnes de 1 à 3 SMS.
- Jusqu’à 3 numéros par workspace.
- Abonnement à 89,99 $/mois.
- 2 000 SMS credits outbound inclus par période Stripe.
- 0,02 $ par SMS credit outbound supplémentaire.
- Plafond de sécurité de 10 000 credits outbound.
- Interface client entièrement en anglais.

Un SMS credit correspond exactement à un segment SMS réel côté backend.

Sont exclus : appels, email marketing, IA, scraping, calendrier, équipes et intégrations CRM.

Priorité technique : sécurité → absence de double SMS → opt-out/compliance → exactitude du billing → simplicité produit → rapidité.

## Architecture et isolation du provider

Architecture obligatoire :

```text
Product / UI
    ↓
Messaging domain
    ↓
SMS provider adapter
    ↓
External provider
```

Organisation :

```text
lib/messaging/provider.ts
lib/messaging/types.ts
lib/messaging/service.ts
lib/messaging/errors.ts
lib/providers/twilio/*
```

Le domaine utilise uniquement :

```text
sendMessage()
searchNumbers()
purchaseNumber()
releaseNumber()
getMessageStatus()
getMessageCost()
getActualSegments()
verifyWebhook()
```

- Seul `lib/providers/twilio/*` importe ou connaît le SDK Twilio.
- Aucun composant, Server Action, domaine métier ou endpoint client ne dépend directement du SDK.
- Un seul provider réel existe en V1 ; ne pas construire de système multi-provider.
- Le provider simulé des tests implémente la même interface.
- Les imports provider sont marqués `server-only`.
- Les DTO client utilisent des champs Riink génériques et excluent systématiquement SIDs, codes provider, coûts fournisseur et états télécom.

Séparer les données techniques dans des tables sans accès `authenticated` :

- `workspace_provider_accounts`
- `phone_number_provider_details`
- `message_provider_details`
- `webhook_events`
- Registres de coûts et de réconciliation

Les tables publiées via Realtime ne doivent contenir que des données produit sûres. Aucun identifiant fournisseur ne doit transiter par Supabase Realtime ou une réponse API client.

Exception : `/admin`, protégé par `ADMIN_EMAILS`, peut consulter provider, SIDs, erreurs techniques, A2P, coûts et réconciliation via des endpoints admin dédiés et le service role.

## Modèle produit et données

### Pipeline

Ajouter `pipeline_stages.is_default boolean not null`.

Garanties :

- Exactement un stage par défaut par workspace.
- `New` est créé avec `is_default = true`.
- Réordonner ne change jamais le défaut.
- `Set as default` remplace atomiquement l’ancien défaut.
- Le stage par défaut ne peut pas être supprimé avant remplacement.
- Le dernier stage restant ne peut pas être supprimé.
- Nouveaux contacts, imports sans stage et inbound inconnus utilisent le stage par défaut.
- Une contrainte unique partielle assure au plus un défaut ; une contrainte différée et les RPC assurent qu’il en reste toujours un.

### Billing

`billing_plans` centralise :

```text
monthly_price_cents = 8999
included_segments = 2000
overage_price_micro_usd = 20000
max_phone_numbers = 3
safety_cap_segments = 10000
```

Ajouter :

- `billing_periods` : période Stripe et snapshot du plan.
- `billing_period_usage` : `actual_outbound_segments` et `reserved_outbound_segments`.
- `billing_usage_ledger` : message, période, direction, segments réels, coût fournisseur, allocation included/overage, montant client, facture et position d’usage d’origine.
- `billing_invoice_runs` : idempotence Stripe.
- Registre interne optionnel pour coûts fixes des numéros et du setup télécom.

Formules :

```text
customer_usage =
actual outbound SMS segments

overage_segments =
max(0, customer_usage - included_segments)

overage_amount_micro_usd =
overage_segments × overage_price_micro_usd
```

Le coût fournisseur est enregistré mais ne détermine jamais le prix client.

Pour un inbound :

```text
direction = inbound
included_segments = 0
overage_segments = 0
customer_billable_amount = 0
```

Un outbound traversant la limite est réparti transactionnellement. À 1 999 credits utilisés, un SMS réel de 3 segments consomme 1 credit inclus et 2 credits supplémentaires.

Chaque outbound accepté reçoit définitivement :

- Le `billing_period_id` correspondant à sa date réelle d’envoi.
- Une `usage_position` monotone dans cette période.
- Les snapshots `included_segments` et `overage_price_micro_usd` de cette période.

Ces rattachements sont immuables.

### Usage et plafond

```text
effective_usage =
actual_outbound_segments
+ reserved_outbound_segments
```

- À la réservation, ajouter l’estimation du message rendu.
- Conserver cette estimation comme réservée tant que `num_segments` réel n’est pas connu.
- Dès réception du nombre réel, retirer l’estimation et ajouter les segments réels dans une transaction.
- En cas d’échec avant envoi, retirer la réservation sans ajouter d’usage.
- Refuser toute réservation qui ferait dépasser 10 000.
- Si le réel dépasse l’estimation et franchit le plafond, suspendre immédiatement les nouveaux envois.
- Dépasser 2 000 credits ne bloque jamais.
- Manuel et automatique utilisent le même compteur.
- Statistiques de livraison et comptabilisation billing restent indépendantes : un message explicitement Failed est exclu du Reply Rate, mais ses segments réels restent comptabilisés si l’infrastructure provider indique qu’ils ont effectivement été consommés.

### Soft delete

Un inbound correspondant à un contact soft-deleted :

- Réutilise le même `contact_id`.
- Ne crée pas de doublon.
- Ne restaure pas le contact.
- Affiche la conversation sous `Deleted contact`.
- Maintient les informations en lecture seule.
- Ne redémarre aucune séquence.
- Traite toujours STOP, START et les autres commandes.

Un numéro totalement inconnu crée un contact minimal dans le stage par défaut.

La réimportation CSV peut restaurer un contact supprimé, mais ne retire jamais une suppression.

## Expérience client Riink

### Vocabulaire

Aucune mention de Twilio ou d’un autre fournisseur ne doit apparaître dans :

- Campaigns, Contacts, Inbox, Settings.
- Onboarding et billing.
- Modals, tooltips, toasts, empty/loading states.
- Emails transactionnels.
- Réponses API destinées au client.
- Messages d’erreur.

Termes interdits hors `/admin` :

```text
Twilio
SID
Messaging Service
subaccount
Auth Token
carrier fee
A2P Campaign
Twilio webhook
Twilio cost
Twilio segment
```

Vocabulaire client :

```text
Phone number
Number setup in progress
SMS delivery
SMS credits
Message failed to send
Riink messaging infrastructure
```

Pour un numéro Pending :

```text
We're setting up your Riink phone number.
You'll be able to start sending messages once it's ready.
```

### SMS credits

Le backend conserve les noms techniques :

```text
num_segments
included_segments
overage_segments
reserved_outbound_segments
```

L’interface utilise uniquement `SMS credits`.

Settings :

```text
SMS usage

1,247 / 2,000 SMS credits used
```

Après dépassement :

```text
2,450 SMS credits used
450 additional credits
Additional usage: $9.00
```

Helper text discret :

```text
Message length and special characters can cause a single message
to use more than one SMS credit.
```

Composer :

```text
142 characters · 1 SMS credit
280 characters · 2 SMS credits
```

Le compteur du composer est une estimation basée sur le contenu rendu ; le billing utilise toujours `num_segments` réel.

Afficher des avertissements simples à environ 75 %, 90 % et 100 % des 2 000 credits inclus. Le dépassement ne bloque pas ; seul le plafond de 10 000 bloque.

### Erreurs produit

Toutes les erreurs provider sont interceptées côté serveur.

Conserver uniquement en backend/admin :

- Code et message provider originaux.
- Identifiant provider.
- Contexte technique de debugging.

Réponses client limitées à des erreurs Riink stables :

```text
Message couldn't be sent. Please try again later.
This phone number isn't ready for messaging yet.
This contact can't receive messages.
```

Les réponses API client contiennent uniquement un code produit stable et une formulation sûre. Aucun payload ou message brut de SDK externe ne peut être propagé.

## Campagnes et statistiques

### Confirmation de grosse campagne

Avant lancement, recalculer côté serveur :

- Recipients réellement éligibles.
- Estimation minimale des credits du premier step après rendu par contact.
- Usage effectif actuel.
- Credits inclus restants.
- Probabilité de dépassement.

Configuration centralisée serveur :

```text
large_campaign_recipient_threshold = 1000
large_campaign_overage_credit_threshold = 1
```

Afficher la confirmation si :

- Le nombre éligible atteint 1 000 ; ou
- Le premier step ferait probablement entrer le workspace en overage.

Ces seuils sont configurables dans une seule source serveur et ne sont jamais dispersés dans les composants.

Modal :

```text
Launch campaign?

You're about to enroll 4,382 contacts.

This campaign may use SMS credits beyond your included allowance
and generate additional usage charges.

Cancel
Launch campaign
```

Cette confirmation :

- Ne crée aucune nouvelle limite.
- N’empêche pas le lancement après confirmation.
- Ne remplace jamais le plafond de 10 000.
- N’expose aucun calcul fournisseur.
- Est recomputée côté serveur lors de la confirmation.

### Reply Rate définitif

Un outbound est `successfully sent` pour les statistiques avec la logique SQL exacte :

```sql
dispatch_state = 'accepted'
AND delivery_state IS DISTINCT FROM 'failed'
```

`IS DISTINCT FROM` est obligatoire afin qu’un statut de livraison encore `NULL` n’exclue pas un message déjà accepté.

`Delivered` n’est jamais requis.

```text
Replies =
unique recipients who replied after at least one successfully sent
outbound message from this campaign

Reply rate =
unique recipients who replied
/
unique recipients with at least one successfully sent outbound message
```

Exclure :

- Messages Failed.
- Messages jamais envoyés.
- Contacts ignorés au lancement.
- Recipients stoppés avant leur premier envoi.
- Réservations sans appel provider accepté.

Si le seul message admissible d’un recipient devient ensuite explicitement Failed, le retirer dynamiquement du dénominateur. S’il possède un autre outbound accepté et non Failed, il reste admissible.

Une réponse inbound tardive est associée au dernier outbound pertinent de la campagne pour le même contact et numéro d’envoi. Les statistiques sont calculées depuis les messages et recipients, sans compteur dénormalisé susceptible de devenir obsolète.

```text
Remaining =
recipients actifs susceptibles de recevoir une prochaine étape
```

Les recipients arrêtés pour reply, opt-out, suppression, erreur ou fin sont exclus.

### Cycle de campagne

- Un draft peut être créé et sauvegardé sans numéro Ready.
- Le lancement exige un numéro Ready, le consentement et un workspace autorisé.
- Les steps actifs restent read-only.
- Une pause décale les échéances de la durée de pause.
- Un contact ne participe qu’à une séquence active.
- La suppression passe par une seule RPC :
  - Soft-delete de la campagne.
  - Arrêt des recipients.
  - Annulation de `next_send_at`.
  - Annulation des réservations encore annulables.
  - Libération des estimations concernées.
  - Préservation des messages.
- `dispatch_unknown` reste stoppé jusqu’à réconciliation et n’est jamais rejoué.

## Worker, Inbox et opt-out

### Anti-double-envoi

Conserver obligatoirement :

- `FOR UPDATE SKIP LOCKED`.
- Unicité `(campaign_recipient_id, step_order)`.
- Réservation transactionnelle.
- Compteur d’usage transactionnel.
- Revérification immédiatement avant le provider.
- Webhooks idempotents.
- `dispatch_unknown`.
- Aucun retry automatique après résultat ambigu.

Dernière validation :

- Campagne active et non supprimée.
- Recipient actif.
- Contact actif.
- Aucune suppression.
- Workspace autorisé.
- Numéro Ready.
- Plafond non atteint.
- Réservation toujours valide.

Principe : manquer un SMS est préférable à un double envoi.

### Inbox et opt-out

- Reply inbound, arrêt de séquence et enregistrement restent cohérents.
- STOP, UNSUBSCRIBE, CANCEL, END et QUIT maintiennent la suppression.
- START/UNSTOP retire la suppression uniquement après confirmation provider.
- Un nouvel opt-in ne relance aucune campagne.
- Vérifier la suppression immédiatement avant chaque envoi automatique ou manuel.
- Conserver Advanced Opt-Out et le parser interne.
- L’interface parle uniquement de Riink, de messages, de numéros et de SMS delivery.

## Provider, Stripe et administration

### Provider SMS

- Un sous-compte et un Messaging Service par workspace, uniquement comme détails backend/admin.
- Jusqu’à trois numéros dont les coûts fixes sont absorbés par Riink.
- Récupérer `num_segments`, statuts et coûts réels.
- Les coûts récurrents des numéros et frais fixes A2P n’entrent jamais dans `Additional SMS usage`.
- L’utilisateur voit uniquement `Pending`/`Ready` et `Sent`/`Delivered`/`Failed`.

### Stripe

- Enregistrer la carte sans débit avant activation.
- Créer l’abonnement à 89,99 $ lorsque le premier numéro devient activable.
- Facturer uniquement les credits outbound réels au-delà de 2 000.
- Ajouter au maximum une ligne agrégée :

```text
Additional SMS usage
```

- Relier cette ligne aux entrées exactes du ledger.
- Rendre le calcul idempotent par `stripe_invoice_id`.
- Un webhook rejoué réutilise le résultat existant.
- Aucun message n’est facturé sur une estimation.
- Conserver la résiliation et la grâce de sept jours sans reprise automatique.

Late reconciliation rule :

- Tout message reste rattaché à la période Stripe pendant laquelle il a réellement été envoyé.
- Si `num_segments` devient disponible après facturation de cette période, utiliser obligatoirement le snapshot, les credits inclus et la position d’usage de la période d’origine.
- Recalculer l’allocation included/overage de la période d’origine, jamais celle de la période courante.
- Calculer l’éventuel delta d’overage non encore facturé de manière idempotente.
- Ce delta peut être ajouté à l’unique ligne agrégée de la prochaine facture Stripe.
- Il ne doit jamais consommer les SMS credits inclus de la période suivante.
- `billing_period_id`, `usage_position` et snapshots de pricing sont immuables, même après clôture.

### Administration

`/admin` peut afficher :

- Provider et identifiants.
- SIDs.
- Erreurs techniques.
- États A2P.
- Coûts fournisseur.
- Réconciliation.
- Détails nécessaires au support.

Toutes les routes admin revérifient `ADMIN_EMAILS` côté serveur. Ces données ne sont jamais accessibles via une route workspace, une API client ou Realtime.

### Observabilité

Chaque log structuré inclut lorsque disponible :

```text
workspace_id
campaign_id
campaign_recipient_id
contact_id
message_id
provider_message_id
stripe_event_id
dispatch_state
event
timestamp
```

Événements minimum :

- Réservation et validation refusée.
- Appel provider et résultat.
- Callback et opt-out.
- Réconciliation des segments et coûts.
- Allocation included/overage.
- Création de ligne Stripe.

Ne jamais logger secrets, clés API, Auth Tokens, credentials ou données de carte.

## Ordre des vertical slices

### Slice 1 — Foundation

- Créer `PLAN.md`.
- Scaffold Next.js, Auth, workspace, RLS, navigation et Settings.
- Créer `New` comme stage par défaut.
- Ajouter la fenêtre horaire du workspace.
- Poser la séparation Product/Messaging/Provider.

### Slice 2 — Contacts

- CRUD, CSV, export, recherche et filtres.
- Pipeline List/Kanban.
- Gestion de `is_default`.
- Soft delete, restauration CSV et inbound des contacts supprimés.

### Slice 3 — Campaigns avec provider simulé

- Drafts, recipients, variables et 1 à 3 SMS.
- Compteur estimé en SMS credits.
- Confirmation de grosse campagne.
- Scheduling, pause/reprise et statistiques définitives.
- Réservation et anti-double-envoi.

### Slice 4 — Inbox

- Conversations et inbound simulé.
- Arrêt sur réponse et nouveau Reply Rate.
- SMS manuel, opt-out et Realtime.
- Conversation `Deleted contact`.

### Slice 5 — Twilio

- Adapter provider unique.
- Sous-comptes, Messaging Services et numéros.
- Webhooks signés et idempotents.
- Segments réels, statuts, erreurs mappées et coûts internes.
- Transition estimation → réel.

### Slice 6 — Number onboarding / A2P

- Acquisition de numéro et état Pending.
- Administration interne du setup.
- Passage à Ready sans vocabulaire provider côté client.

### Slice 7 — Stripe

- SetupIntent et abonnement.
- Snapshots de période.
- 2 000 credits inclus et overage à 0,02 $.
- Ledger, facture agrégée et écran `SMS usage`.
- Réconciliation tardive strictement rattachée à la période d’origine.

### Slice 8 — Hardening

- Cron, réconciliation, résiliation et grâce.
- Administration interne.
- Logs structurés.
- Concurrence, Playwright, responsive et QA.

Après chaque slice :

- Application compilable et navigable.
- Migrations applicables depuis zéro.
- Tests existants verts.
- Aucune slice précédente cassée.
- Aucun secret versionné.
- Aucun détail provider exposé au client.

## Tests d’acceptation

- Exactement un stage par défaut ; reorder sans effet sur le défaut.
- Contact inconnu dans le défaut ; soft-deleted non restauré par inbound.
- Reply Rate utilisant `IS DISTINCT FROM 'failed'`.
- Message accepté avec `delivery_state = NULL` inclus dans le dénominateur.
- Recalcul correct lorsqu’un message devient Failed.
- Confirmation des grosses campagnes sans nouvelle limite.
- Affichage `SMS credits`, jamais `segments` comme unité client.
- SMS multi-segments consommant plusieurs credits.
- Dépassement des 2 000 credits sans blocage.
- Plafond de 10 000 toujours bloquant.
- Transition réservation/réel sans double comptage.
- Réconciliation tardive conservant la période, le snapshot et la position d’origine.
- Usage de juillet réconcilié en août n’utilisant jamais les credits inclus d’août.
- Une seule ligne Stripe après replay webhook.
- Reply et opt-out stoppant la séquence.
- Deux workers produisant un seul appel provider.
- Campagne supprimée incapable d’envoyer.
- Erreurs provider transformées en erreurs Riink.
- Absence d’erreurs SDK brutes dans les APIs client.
- Scan de toutes les vues client, emails et textes rendus interdisant :
  - `Twilio`
  - `SID`
  - `Messaging Service`
  - `carrier fee`
  - `subaccount`
  - `Auth Token`
  - `A2P Campaign`
- `/admin` est la seule exception au scan provider.
- DTO et Realtime ne contiennent aucun champ technique provider.
- RLS empêche tout accès inter-workspace.

## Prérequis d’exécution

- Remplacer la clé Supabase invalide et fournir l’accès migrations.
- Faire tourner le mot de passe PostgreSQL précédemment exposé.
- Configurer les secrets provider, Stripe, Vercel, `ADMIN_EMAILS` et `https://www.riink.app`.
- Conserver exclusivement :
  - 89,99 $/mois.
  - 2 000 SMS credits outbound inclus.
  - 0,02 $ par credit outbound supplémentaire.
  - 10 000 credits de safety cap.
  - 3 numéros maximum.
- La prochaine étape d’implémentation est Slice 1 — Foundation.
