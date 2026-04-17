# Deployment Guide

## Docker Deployment

### QA Environment

1. **Create environment file:**

   ```bash
   cp .env.qa.example .env.qa
   # Edit .env.qa with actual values
   ```

2. **Build and deploy:**

   ```bash
   docker compose -f compose.qa.yml up -d --build
   ```

3. **View logs:**

   ```bash
   docker compose -f compose.qa.yml logs -f
   ```

4. **Stop:**
   ```bash
   docker compose -f compose.qa.yml down
   ```

### Production Environment

1. **Create environment file:**

   ```bash
   cp .env.prod.example .env.prod
   # Edit .env.prod with actual values
   ```

2. **Build and deploy:**

   ```bash
   docker compose -f compose.prod.yml up -d --build
   ```

3. **View logs:**

   ```bash
   docker compose -f compose.prod.yml logs -f
   ```

4. **Stop:**
   ```bash
   docker compose -f compose.prod.yml down
   ```

## Key Changes Made

### 1. Multi-stage Dockerfile

- **Builder stage**: Compiles TypeScript and generates Prisma client
- **Production stage**: Only includes production dependencies and compiled code
- **Benefits**: Smaller image size, faster deployments, more secure

### 2. Environment-specific Images

- QA: `ekoru-gateway:qa`
- Production: `ekoru-gateway:prod`
- **Benefits**: Prevents image conflicts, allows rollback to previous versions

### 3. Container Names

- QA: `ekoru-gateway-qa`
- Production: `ekoru-gateway`
- **Benefits**: Can run both environments on same server without conflicts

### 4. Port Mapping

- QA: Host `9000` → Container `9000`
- Production: Host `9100` → Container `9000`
- **Benefits**: Both can run simultaneously on same server

## Volume Permissions

The images volume (`/home/ekoru/images`) needs proper permissions:

```bash
# On the server, ensure the directory exists and has correct permissions
sudo mkdir -p /home/ekoru/images
sudo chown -R 1000:1000 /home/ekoru/images
sudo chmod -R 755 /home/ekoru/images
```

## Database Migrations

Run migrations before deploying:

```bash
# For QA
docker compose -f compose.qa.yml exec ekoru-gateway-qa npx prisma migrate deploy

# For Production
docker compose -f compose.prod.yml exec ekoru-gateway npx prisma migrate deploy
```

## Health Check

Verify the service is running:

```bash
# QA
curl http://localhost:9000

# Production
curl http://localhost:9100
```

## Troubleshooting

### Check container status

```bash
docker ps -a | grep ekoru-gateway
```

### View logs

```bash
# QA
docker logs ekoru-gateway-qa --tail 100 -f

# Production
docker logs ekoru-gateway --tail 100 -f
```

### Enter container

```bash
# QA
docker exec -it ekoru-gateway-qa sh

# Production
docker exec -it ekoru-gateway sh
```

### Rebuild without cache

```bash
# QA
docker compose -f compose.qa.yml build --no-cache

# Production
docker compose -f compose.prod.yml build --no-cache
```
