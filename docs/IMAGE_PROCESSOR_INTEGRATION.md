# Image Processor Integration

How the gateway delegates image uploads to the **ekoru-image-processor** Rust service, and how images are served back to clients.

> Counterpart doc on the processor side: `ekoru-image-processor/README.md` (the "Integrating with the gateway" section is the contract this doc implements).

---

## Why this exists

Until now, the gateway accepted multipart uploads from the mobile/web app and wrote the raw bytes to a local disk volume (`/app/images`), then served them back through `app.useStaticAssets('/images')`. That meant:

- The gateway container needed a persistent volume.
- Images were not resized or re-encoded — a 4 MB phone photo was stored and served as 4 MB.
- Scaling the gateway horizontally required a shared filesystem.
- Backups, retention and CDN caching were all our problem.

The new flow moves all that work out:

- The gateway is a thin proxy: it receives the multipart from the app, forwards it to the image processor, and stores the returned **object key** in the database.
- The processor resizes per entity preset, encodes WebP, and uploads to Cloudflare R2.
- R2 buckets are fronted by Cloudflare custom domains (`cdn-staging.ekoru.cl`, `cdn.ekoru.cl`) — that's the URL clients fetch images from.

The gateway no longer reads, writes, or serves any image bytes.

---

## End-to-end flow

```
   ┌───────────────┐
   │  Mobile / web │   POST /api/profile-image
   │     client    │   multipart/form-data, field: file
   └───────┬───────┘
           │ (1) HTTPS, JWT cookie
           ▼
   ┌──────────────────────────────────────────────┐
   │  Gateway (NestJS)                            │
   │                                              │
   │  ProfileImageController                      │
   │    → ImageProcessorClient.upload(            │
   │         file, 'user_avatar', sellerId)       │
   │                                              │
   │      POST http://ekoru-image-processor:8090/process
   │      Header: X-Internal-Token: <secret>      │
   │      Body:   file + entity + entity_id       │
   └──────┬───────────────────────────────────────┘
          │ (2) docker internal network
          ▼
   ┌──────────────────────────────────────────────┐
   │  ekoru-image-processor (Rust + axum)         │
   │                                              │
   │  - validates X-Internal-Token                │
   │  - resizes per entity preset                 │
   │  - re-encodes to WebP                        │
   │  - PUT to R2 with key                        │
   │      {entity}/{entity_id}/{uuid}.webp        │
   │  - returns { key, url, sizes, dimensions }   │
   └──────┬───────────────────────────────────────┘
          │ (3) S3 PutObject
          ▼
   ┌──────────────────────────────────────────────┐
   │  Cloudflare R2 bucket (per env)              │
   │    staging → ekoru-images-staging            │
   │    prod    → ekoru-images-prod               │
   └──────┬───────────────────────────────────────┘
          │ (4) public read, fronted by custom domain
          ▼
   ┌──────────────────────────────────────────────┐
   │  CDN                                         │
   │    staging → https://cdn-staging.ekoru.cl    │
   │    prod    → https://cdn.ekoru.cl            │
   └──────────────────────────────────────────────┘

   Back at the gateway (after step 2):
   - the controller stores `processed.key` in the DB column
     (e.g. `personProfile.profileImage = 'user_avatar/123/abc.webp'`)
   - the response to the client includes the full CDN URL
     so the app can render the new image immediately
```

---

## What the gateway does (and does not) do

| Responsibility                              | Before          | Now            |
| ------------------------------------------- | --------------- | -------------- |
| Receive multipart from app                  | Gateway         | Gateway        |
| Validate JWT / scope upload to a user       | Gateway         | Gateway        |
| Save bytes to disk                          | Gateway         | — (gone)       |
| Resize / re-encode                          | — (not done)    | Image processor |
| Persist binary                              | Local disk      | Cloudflare R2  |
| Serve image bytes back to clients           | Gateway static  | Cloudflare CDN |
| Store image reference in DB                 | Gateway         | Gateway        |

The gateway never holds the bytes after the forward — it streams them to the processor and discards them.

---

## Components added in the gateway

| File                                     | Purpose                                                                                     |
| ---------------------------------------- | ------------------------------------------------------------------------------------------- |
| `src/images/image-processor.client.ts`   | Tiny `fetch`-based HTTP client. One method per processor endpoint (`upload`, `delete`).    |
| `src/images/images.module.ts`            | Registers `ImageProcessorClient` as a provider and exports it. Multer limit raised to 10 MB. |

Removed:

- `src/images/images.service.ts` and `images.service.spec.ts` — disk I/O is gone.
- `test/images/images.e2e-spec.ts` — covered behavior that no longer exists.
- `app.useStaticAssets(...)` in `src/main.ts` — gateway no longer serves images.
- `GET /api/images/:category/:filename` in `images.controller.ts` — serving is now R2/CDN.

---

## Controllers

Each controller does the same dance:

1. Read existing image **key(s)** from the DB.
2. If any, call `imageProcessor.delete(key)` so we don't orphan R2 objects.
3. Call `imageProcessor.upload(file, entity, entityId)`.
4. Persist the returned `key` in the DB column.
5. Return `{ key, imageUrl, ...sizes }` to the client.

The entity mapping is:

| Controller / endpoint                       | Entity        | `entity_id`                |
| ------------------------------------------- | ------------- | -------------------------- |
| `POST /api/profile-image`                   | `user_avatar` | authenticated `sellerId`   |
| `POST /api/cover-image`                     | `user_cover`  | authenticated `sellerId`   |
| `POST /api/product-images`                  | `product`     | `productId` from body      |
| `POST /api/business-image` (storeProduct)   | `product`     | `itemId` from body         |
| `POST /api/business-image` (service)        | `service`     | `itemId` from body         |
| `POST /api/images/upload/department`        | `asset`       | `entityId` from body       |
| `POST /api/images/upload/product`           | `product`     | `entityId` from body       |
| `POST /api/images/upload/user`              | `user_avatar` | `entityId` from body       |

The entity decides which **resize preset** runs in the processor — see the processor README's "Resize presets" table.

---

## What is stored in the database

Just the **object key** — e.g. `user_avatar/0190a8c9-1234-.../d8f1e2c3-....webp`.

Columns affected:

| Model             | Column          | Type        |
| ----------------- | --------------- | ----------- |
| `PersonProfile`   | `profileImage`  | `String?`   |
| `PersonProfile`   | `coverImage`    | `String?`   |
| `BusinessProfile` | `logo`          | `String?`   |
| `BusinessProfile` | `coverImage`    | `String?`   |
| `Product`         | `images`        | `String[]`  |
| `StoreProduct`    | `images`        | `String[]`  |
| `Service`         | `images`        | `String[]`  |

We store the **key**, not the full URL, so we can change the CDN domain without a data migration. Anything that needs to render the image rebuilds the URL as `${PUBLIC_BASE_URL}/${key}`.

---

## How images are served

There is no gateway endpoint that serves bytes anymore. Clients fetch directly from the CDN:

```
https://cdn-staging.ekoru.cl/<key>     # staging
https://cdn.ekoru.cl/<key>             # prod
```

The custom domain is connected to the bucket in the Cloudflare R2 dashboard (R2 → bucket → Settings → Public access → Connect Domain). That gives the bucket Cloudflare's cache + WAF in front of it for free.

**The gateway upload response already contains the full URL** (`processed.url`), so the app can use it as-is for "I just uploaded, show me the new image" flows. For loading existing rows, the app or the subgraph that owns the field should prepend the public base URL to the stored key.

A typical resolver pattern (in the relevant subgraph, not in the gateway):

```ts
@ResolveField('profileImageUrl')
resolveProfileImageUrl(@Parent() profile: PersonProfile): string | null {
  if (!profile.profileImage) return null;
  return `${process.env.IMAGES_PUBLIC_BASE_URL}/${profile.profileImage}`;
}
```

Where `IMAGES_PUBLIC_BASE_URL` is whichever of the two CDN domains matches the environment.

---

## Network topology

Both services share an **external docker network** per environment:

| Env     | Network                  | Gateway DNS name        | Processor DNS name                      |
| ------- | ------------------------ | ----------------------- | --------------------------------------- |
| dev     | host networking          | `localhost:4000`        | `localhost:8090`                        |
| staging | `ekoru-staging-network`  | `ekoru-gateway-staging` | `ekoru-image-processor-staging`         |
| prod    | `ekoru-network`          | `ekoru-gateway`         | `ekoru-image-processor`                 |

The processor has **no `ports:` mapping** in its compose files — it is only reachable from inside the docker network. The only way in from the outside is by going through the gateway, which is exactly the boundary we want.

---

## Authentication between the two services

A single shared secret in the `X-Internal-Token` HTTP header. Set the **same** value in both repos for each environment:

| Variable in gateway        | Variable in processor | Generated with                              |
| -------------------------- | --------------------- | ------------------------------------------- |
| `IMAGE_PROCESSOR_TOKEN`    | `INTERNAL_TOKEN`      | `openssl rand -hex 32` (≥ 16 chars required) |

The processor refuses to start if `INTERNAL_TOKEN` is shorter than 16 characters or missing.

If the two values drift, every upload returns `401` and you'll see `image-processor returned 401` in the gateway logs.

---

## Environment variables

The gateway now needs two new variables. The disk-related ones (`DEV_IMAGES_PATH`, `IMAGES_PATH`, `IMAGES_BASE_URL`, `GATEWAY_EXTERNAL_URL`, `HOME`) were removed.

### Dev (`.env`)

```env
IMAGE_PROCESSOR_URL="http://localhost:8090"
IMAGE_PROCESSOR_TOKEN="dev-internal-token-please-change-me"
```

### Staging (`.env.staging`)

```env
IMAGE_PROCESSOR_URL="http://ekoru-image-processor-staging:8090"
IMAGE_PROCESSOR_TOKEN="<same value as ekoru-image-processor/.env.staging INTERNAL_TOKEN>"
```

### Prod (`.env.prod`)

```env
IMAGE_PROCESSOR_URL="http://ekoru-image-processor:8090"
IMAGE_PROCESSOR_TOKEN="<same value as ekoru-image-processor/.env.prod INTERNAL_TOKEN>"
```

The corresponding values on the processor side live in `ekoru-image-processor/.env.staging` and `ekoru-image-processor/.env.prod`. R2 credentials, bucket names and the `R2_PUBLIC_BASE_URL` (the CDN domain) all live there — the gateway does not need to know them.

---

## R2 buckets

Two buckets, one per environment, both already created:

| Env     | Bucket                  | Custom domain (public URL)    |
| ------- | ----------------------- | ----------------------------- |
| staging | `ekoru-images-staging`  | `https://cdn-staging.ekoru.cl` |
| prod    | `ekoru-images-prod`     | `https://cdn.ekoru.cl`        |

These are configured **only** in the processor's env files — `R2_BUCKET` + `R2_PUBLIC_BASE_URL` + R2 credentials. The gateway never talks to R2 directly.

---

## Deploying the change

The gateway and processor are deployed independently, but the first time you roll this change out, do the processor first so the gateway has somewhere to call.

### One-time, per environment

1. **Cloudflare**: confirm the bucket exists, has an R2 API token, and the custom domain is connected.
2. **Processor**: populate `ekoru-image-processor/.env.staging` (and `.env.prod`) with real R2 credentials and an `INTERNAL_TOKEN` (`openssl rand -hex 32`).
3. **Gateway**: set `IMAGE_PROCESSOR_TOKEN` in `.env.staging` / `.env.prod` to the **same** `INTERNAL_TOKEN` value.
4. **Docker network** (only if not present): `docker network create ekoru-staging-network` and `docker network create ekoru-network` on the respective hosts.

### Every deploy

```bash
# 1. processor
cd ekoru-image-processor
git pull
docker compose -f compose.staging.yml up -d --build
docker compose -f compose.staging.yml logs -f       # wait for "listening on 0.0.0.0:8090"

# 2. gateway
cd ../ekoru-gateway
git pull
docker compose -f compose.staging.yml up -d --build
```

Same pattern for prod with `compose.prod.yml`.

---

## Smoke test

After deploy, hit the gateway as a normal authenticated user (or curl against dev):

```bash
curl -X POST http://localhost:4000/api/profile-image \
  -H "Cookie: token=<jwt>" \
  -F "file=@./photo.jpg"
```

Expected response:

```json
{
  "message": "File uploaded and processed successfully",
  "key": "user_avatar/<sellerId>/<uuid>.webp",
  "imageUrl": "https://cdn-staging.ekoru.cl/user_avatar/<sellerId>/<uuid>.webp",
  "originalSize": 2034512,
  "processedSize": 41024,
  "width": 400,
  "height": 400
}
```

Open `imageUrl` in a browser — it should render. If it returns 403/404, the issue is in the R2 / custom domain setup on the processor side, not the gateway.

---

## What about images already in the old `/app/images` volume?

Existing DB rows still point at paths like `/images/profile-images/profile-123-….jpg`. With static serving removed, those URLs return 404.

There are two options, and we have **not** picked one yet — decide before the change ships to prod:

1. **Backfill**: write a one-shot script that reads each old path off the volume, uploads it via the gateway flow (or directly through the processor), and rewrites the DB column to the returned key. Then delete the volume.
2. **Drop and re-upload**: NULL the old image columns. Users / admins re-upload through the app. Simpler, more user-visible.

In staging, option 2 is almost always fine. For prod, option 1 is friendlier.

The gateway code does not need to change either way — it already only deals with new uploads going through the processor.

---

## Operational notes

### Logs

- Gateway: every failed processor call logs the status code + body via `Logger` (see `ImageProcessorClient`). Look for `image-processor /process 4xx` or `delete returned 4xx`.
- Processor: structured `tracing` output; filter with `RUST_LOG=info,aws=warn` (default).

### Failure modes

| What the user sees | Where to look |
| ------------------ | ------------- |
| `500 image-processor returned 401` | `IMAGE_PROCESSOR_TOKEN` ≠ `INTERNAL_TOKEN`. Re-sync the values. |
| `500 image-processor returned 413` | File bigger than `MAX_UPLOAD_BYTES` (default 10 MB). Either resize on the client or raise the limit on the processor side. |
| `500 image-processor returned 422` | File wasn't a decodable image. Add stricter client-side validation. |
| `500 image-processor returned 500` | Almost always R2 upload failure. Check processor logs for `dispatch failure` / `Access Denied`. |
| Upload succeeds but `imageUrl` 403/404 | Custom domain isn't connected to the bucket, or `R2_PUBLIC_BASE_URL` doesn't match. Processor side, not gateway. |

### Orphaned objects

We call `imageProcessor.delete(oldKey)` best-effort whenever we replace an image. If the delete fails (network blip, processor down), we log a warning and keep going — the new image still uploads successfully. Worst case: a few dozen abandoned objects in R2, which can be reaped by a Cloudflare R2 lifecycle rule later.

### Removing an entire user / product

When a record that owns images is hard-deleted, the caller is responsible for iterating its `images` / `profileImage` / `coverImage` columns and calling the processor's delete endpoint for each. There is no GC inside the gateway today.
