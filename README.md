# go-resohealth

Standalone consumer-facing app for go.resohealth.life — BioAge calculator and longevity member management.

## Phase G: BioAge → /me/ member registration handoff

The BioAge page at `/bio-age` lets anonymous visitors take the assessment, then offers a "Save report & create my account" CTA that hands the result off to the member portal at `https://resohealth.life/me/sign-up/`.

### How the handoff works

1. User completes the assessment client-side; result is stored in `localStorage` (`bioAgeLastResult`) for back-button safety.
2. Clicking "Save report & create my account" POSTs to `/api/bio-age/intakes`, which:
   - Writes a doc to Firestore collection `bio_age_intakes/{intakeId}` via Firebase Admin.
   - Generates a 32-char hex `claimToken` (`crypto.randomBytes(16)`).
   - Sets `expiresAt = createdAt + 30 days` for Firestore TTL auto-cleanup.
   - Rate-limits by IP at 20 requests / hour (token bucket, in-memory).
3. Server returns `{ intakeId, claimToken }`. Client redirects to:
   `https://resohealth.life/me/sign-up/?bioAgeRef={intakeId}&t={claimToken}&email=…`
4. The `/me/` portal handles the claim on successful sign-up (see `longevity-companion`).

### Firestore schema — `bio_age_intakes/{intakeId}`

```
answers:           Array<{ q, a }>
chronologicalAge:  number
biologicalAge:     number
delta:             number
score:             number | null
category:          string | null
locale:            string | null
email:             string | null
fullName:          string | null
source:            'go.resohealth.life/bio-age'
createdAt:         Timestamp
expiresAt:         Timestamp   ← TTL field, set to createdAt + 30 days
claimToken:        string      ← 32-char hex, server-only
claimedBy:         string | null
claimedAt:         Timestamp | null
```

### Required manual setup (one-time)

The deploying engineer must enable a Firestore TTL policy on the `expiresAt`
field of the `bio_age_intakes` collection so unclaimed intakes auto-delete
after 30 days. The subagent does **not** run `gcloud`. Apply with:

```
gcloud firestore fields ttls update expiresAt \
  --collection-group=bio_age_intakes \
  --enable-ttl \
  --project=dave-487819
```

(Or use the Firestore console: Indexes → TTL → "Create policy", collection
group `bio_age_intakes`, timestamp field `expiresAt`.)

`firestore.rules` (at repo root) locks `bio_age_intakes` down to admin-only —
no client read or write. Members can read their own `users/{uid}/bioAgeReports/`
subcollection.

### Environment variables

The Firebase Admin SDK uses Application Default Credentials when running on
Cloud Run. For local development, either set `GOOGLE_APPLICATION_CREDENTIALS`
to a service-account JSON path, or set the `FIREBASE_SERVICE_ACCOUNT` env var
to the JSON contents directly. `FIREBASE_PROJECT_ID` (or
`GOOGLE_CLOUD_PROJECT`) defaults to `dave-487819`.

### Scripts

```
npm run dev         # start Next.js dev server
npm run build       # production build
npm run lint        # next lint
npm run typecheck   # tsc --noEmit
npm test            # vitest run
```
