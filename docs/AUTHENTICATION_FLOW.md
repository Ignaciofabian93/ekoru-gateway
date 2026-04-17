# Ekoru Gateway - Authentication & Security Flow

## 🔐 Overview

The Ekoru Gateway implements a secure, cookie-based JWT authentication system with token validation, automatic refresh, and proper credential propagation to GraphQL subgraphs. This document explains the complete authentication flow and security measures.

---

## 📋 Table of Contents

1. [Architecture](#architecture)
2. [Authentication Flow](#authentication-flow)
3. [Token Management](#token-management)
4. [Security Layers](#security-layers)
5. [Request Flow](#request-flow)
6. [API Endpoints](#api-endpoints)
7. [Environment Configuration](#environment-configuration)

---

## 🏗️ Architecture

```
┌─────────────┐
│   Client    │
│ (Browser)   │
└──────┬──────┘
       │ Cookies: token, refreshToken
       │ Headers: Authorization (fallback)
       ▼
┌─────────────────────────────────────────┐
│          Ekoru Gateway                   │
│  ┌───────────────────────────────────┐  │
│  │  Security Middleware (main.ts)    │  │
│  │  - Helmet (Security Headers)      │  │
│  │  - CORS (Origin Control)          │  │
│  │  - Rate Limiting (100 req/min)    │  │
│  │  - Cookie Parser                  │  │
│  └───────────────────────────────────┘  │
│                 │                        │
│                 ▼                        │
│  ┌───────────────────────────────────┐  │
│  │  Auth Endpoints (/session/*)      │  │
│  │  - POST /session/auth (Login)     │  │
│  │  - POST /session/refresh          │  │
│  │  - POST /session/logout           │  │
│  └───────────────────────────────────┘  │
│                 │                        │
│                 ▼                        │
│  ┌───────────────────────────────────┐  │
│  │  GraphQL Gateway Context          │  │
│  │  - Extract token from cookies     │  │
│  │  - Verify JWT signature           │  │
│  │  - Extract sellerId from payload  │  │
│  └───────────────────────────────────┘  │
│                 │                        │
│                 ▼                        │
│  ┌───────────────────────────────────┐  │
│  │  AuthenticatedDataSource          │  │
│  │  - Validate token before forward  │  │
│  │  - Set Authorization header       │  │
│  │  - Set x-seller-id header         │  │
│  └───────────────────────────────────┘  │
└──────────────┬──────────────────────────┘
               │ HTTP Headers:
               │ - Authorization: Bearer <token>
               │ - x-seller-id: <sellerId>
               ▼
    ┌──────────────────┐
    │   Subgraphs      │
    │  - Users         │
    │  - Products      │
    │  - Blog          │
    └──────────────────┘
```

---

## 🔄 Authentication Flow

### 1. **Login** (`POST /session/auth`)

```typescript
// Client sends credentials
{
  "email": "seller@ekoru.cl",
  "password": "secure_password"
}
```

**Server Process:**

1. **Validate Credentials** (`AuthService.login`)
   - Lowercase email normalization
   - Query Prisma database for seller
   - Compare password using bcrypt

2. **Generate Tokens**

   ```typescript
   // Access Token (15 minutes)
   const token = jwtService.sign({ sellerId: user.id }, { expiresIn: '15m' });

   // Refresh Token (7 days)
   const refreshToken = jwtService.sign(
     { sellerId: user.id },
     { secret: JWT_REFRESH_SECRET, expiresIn: '7d' },
   );
   ```

3. **Set Secure Cookies**

   ```typescript
   res.cookie('token', token, {
     httpOnly: true, // Prevents XSS
     secure: isProduction, // HTTPS only in prod
     sameSite: 'strict', // CSRF protection
     maxAge: 15 * 60 * 1000, // 15 minutes
     domain: '.ekoru.cl', // Cross-subdomain
   });

   res.cookie('refreshToken', refreshToken, {
     httpOnly: true,
     secure: isProduction,
     sameSite: 'strict',
     maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
     domain: '.ekoru.cl',
   });
   ```

4. **Response**
   ```json
   {
     "token": "eyJhbGciOiJIUzI1NiIs...",
     "message": "Inicio de sesión exitoso"
   }
   ```

---

### 2. **Token Refresh** (`POST /session/refresh`)

When the access token expires (after 15 minutes), the client uses the refresh token to get a new one.

```typescript
// Client sends
{
  "refreshToken": "eyJhbGciOiJIUzI1NiIs..."
}
```

**Server Process:**

1. **Verify Refresh Token**

   ```typescript
   const payload = jwtService.verify(refreshToken, {
     secret: JWT_REFRESH_SECRET,
   });
   ```

2. **Generate New Access Token**

   ```typescript
   const newToken = jwtService.sign(
     { sellerId: payload.sellerId },
     { expiresIn: '15m' },
   );
   ```

3. **Update Cookie**

   ```typescript
   res.cookie('token', newToken, {
     /* same options */
   });
   ```

4. **Response**
   ```json
   {
     "token": "eyJhbGciOiJIUzI1NiIs...",
     "success": true
   }
   ```

---

### 3. **Logout** (`POST /session/logout`)

Properly clears authentication cookies.

**Server Process:**

```typescript
res.clearCookie('token', {
  httpOnly: true,
  secure: isProduction,
  sameSite: 'strict',
  domain: '.ekoru.cl',
});

res.clearCookie('refreshToken', {
  httpOnly: true,
  secure: isProduction,
  sameSite: 'strict',
  domain: '.ekoru.cl',
});
```

**Response:**

```json
{
  "success": true,
  "message": "Sesión cerrada exitosamente"
}
```

---

## 🎫 Token Management

### Token Structure

```json
{
  "sellerId": "cm123xyz",
  "iat": 1702835200, // Issued At
  "exp": 1702836100 // Expiration
}
```

### Token Validation (`TokenService`)

The `TokenService` provides secure token validation:

```typescript
class TokenService {
  // Verifies signature AND expiration
  private verifyToken(token: string, useRefreshSecret = false) {
    const secret = useRefreshSecret ? JWT_REFRESH_SECRET : JWT_SECRET;

    try {
      return verify(token, secret); // Throws if invalid/expired
    } catch {
      return null;
    }
  }

  // Try access token first, then refresh token
  getSellerIdFromToken(token: string): string | null {
    let decoded = this.verifyToken(token, false);
    if (!decoded) {
      decoded = this.verifyToken(token, true);
    }
    return decoded?.sellerId || null;
  }
}
```

---

## 🛡️ Security Layers

### Layer 1: HTTP Security Headers (Helmet)

```typescript
helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", 'data:', 'https:'],
    },
  },
  crossOriginEmbedderPolicy: false,
});
```

**Protects Against:**

- XSS (Cross-Site Scripting)
- Clickjacking
- MIME type sniffing
- Protocol downgrade attacks

---

### Layer 2: CORS (Cross-Origin Resource Sharing)

```typescript
app.enableCors({
  origin: 'https://app.ekoru.cl', // Whitelist only
  credentials: true, // Allow cookies
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Cookie'],
});
```

**Protects Against:**

- Unauthorized cross-origin requests
- CSRF attacks from malicious domains

---

### Layer 3: Rate Limiting (Throttler)

```typescript
ThrottlerModule.forRoot([
  {
    ttl: 60000, // 1 minute window
    limit: 100, // Max 100 requests
  },
]);
```

**Protects Against:**

- Brute force attacks
- DDoS attempts
- API abuse

---

### Layer 4: Cookie Security

```typescript
{
  httpOnly: true,       // No JavaScript access
  secure: true,         // HTTPS only
  sameSite: 'strict',   // No cross-site requests
  domain: '.ekoru.cl'   // Subdomain sharing
}
```

**Protects Against:**

- XSS cookie theft
- CSRF attacks
- Session hijacking

---

### Layer 5: JWT Validation

```typescript
class AuthenticatedDataSource {
  private validateToken(token: string): boolean {
    try {
      verify(token, JWT_SECRET); // Validates signature + expiration
      return true;
    } catch {
      return false; // Don't forward invalid tokens
    }
  }
}
```

**Protects Against:**

- Token tampering
- Expired token usage
- Forged tokens
- Replay attacks

---

## 🚀 Request Flow

### GraphQL Request with Authentication

```
1. Client makes GraphQL request
   ├─ Cookie: token=eyJhbGci...
   └─ Cookie: refreshToken=eyJhbGci...

2. Gateway Context Extraction (app.module.ts)
   ├─ Extract token from cookies (priority)
   ├─ Fallback to Authorization header
   ├─ Verify token signature with JWT_SECRET
   ├─ Extract sellerId from payload
   └─ Build context: { token, sellerId, req, res }

3. AuthenticatedDataSource.willSendRequest()
   ├─ Validate token (verify signature + expiration)
   ├─ If valid:
   │  ├─ Set header: Authorization: Bearer <token>
   │  └─ Set header: x-seller-id: <sellerId>
   └─ If invalid: Don't forward credentials

4. Subgraph receives request
   ├─ Authorization: Bearer eyJhbGci...
   └─ x-seller-id: cm123xyz

5. Subgraph validates token independently
   └─ Uses same JWT_SECRET to verify
```

### Example Flow Diagram

```
┌────────────┐
│   Client   │
└─────┬──────┘
      │ POST /graphql
      │ Cookie: token=abc123
      │ Body: { query: "{ me { id name } }" }
      ▼
┌─────────────────────────────────┐
│  Gateway Context Builder        │
│  1. cookieToken = req.cookies.token
│  2. token = cookieToken || headerToken
│  3. decoded = verify(token, JWT_SECRET)
│  4. sellerId = decoded.sellerId
│  5. context = { token, sellerId }
└─────────┬───────────────────────┘
          ▼
┌─────────────────────────────────┐
│  AuthenticatedDataSource        │
│  1. isValid = validateToken(token)
│  2. if (isValid):
│     - headers.set('Authorization', 'Bearer ' + token)
│     - headers.set('x-seller-id', sellerId)
└─────────┬───────────────────────┘
          │ Forward to subgraph
          ▼
┌─────────────────────────────────┐
│  Users Subgraph                 │
│  1. Receives headers
│  2. Validates token
│  3. Executes query
│  4. Returns user data
└─────────┬───────────────────────┘
          │
          ▼
┌─────────────────────────────────┐
│  Client receives response       │
│  { "data": { "me": { ... } } }  │
└─────────────────────────────────┘
```

---

## 🔌 API Endpoints

### Authentication Endpoints

| Endpoint           | Method | Description          | Request Body          | Response                       |
| ------------------ | ------ | -------------------- | --------------------- | ------------------------------ |
| `/session/auth`    | POST   | User login           | `{ email, password }` | `{ token, message }` + cookies |
| `/session/refresh` | POST   | Refresh access token | `{ refreshToken }`    | `{ token, success }` + cookie  |
| `/session/logout`  | POST   | Clear session        | None                  | `{ success, message }`         |

### GraphQL Endpoint

| Endpoint   | Method | Description               | Headers                                   |
| ---------- | ------ | ------------------------- | ----------------------------------------- |
| `/graphql` | POST   | GraphQL queries/mutations | Optional: `Authorization: Bearer <token>` |

---

## ⚙️ Environment Configuration

### Required Environment Variables

```bash
# JWT Secrets (use different secrets!)
JWT_SECRET=your-super-secret-access-token-key
JWT_REFRESH_SECRET=your-super-secret-refresh-token-key

# Environment
ENVIRONMENT=development  # development | qa | production

# Server
PORT=4000

# Subgraph URLs (per environment)
USER_SERVICE_DEV_URL=http://localhost:4001/graphql
USER_SERVICE_QA_URL=https://qa.users.ekoru.cl/graphql
USER_SERVICE_PROD_URL=https://users.ekoru.cl/graphql

PRODUCT_SERVICE_DEV_URL=http://localhost:4002/graphql
PRODUCT_SERVICE_QA_URL=https://qa.products.ekoru.cl/graphql
PRODUCT_SERVICE_PROD_URL=https://products.ekoru.cl/graphql

BLOG_SERVICE_DEV_URL=http://localhost:4003/graphql
BLOG_SERVICE_QA_URL=https://qa.blog.ekoru.cl/graphql
BLOG_SERVICE_PROD_URL=https://blog.ekoru.cl/graphql

# Database
DATABASE_URL=postgresql://user:password@localhost:5432/ekoru_gateway
```

### Environment-Specific Security

| Feature           | Development    | QA              | Production   |
| ----------------- | -------------- | --------------- | ------------ |
| Cookie `httpOnly` | ✅ true        | ✅ true         | ✅ true      |
| Cookie `secure`   | ❌ false       | ✅ true         | ✅ true      |
| Cookie `sameSite` | lax            | strict          | strict       |
| Cookie `domain`   | undefined      | .ekoru.cl       | .ekoru.cl    |
| CSP Headers       | ❌ disabled    | ✅ enabled      | ✅ enabled   |
| CORS Origin       | localhost:3000 | qa.app.ekoru.cl | app.ekoru.cl |

---

## 🔍 Security Best Practices

### ✅ What We Do Right

1. **JWT Signature Validation**: All tokens are verified before use
2. **HttpOnly Cookies**: Prevents XSS token theft
3. **SameSite Strict**: Prevents CSRF in production
4. **Short-lived Access Tokens**: 15-minute expiration limits exposure
5. **Separate Refresh Token Secret**: Isolates refresh token compromise
6. **Rate Limiting**: Prevents brute force attacks
7. **Helmet Security Headers**: Multiple XSS/clickjacking protections
8. **Token Validation at Gateway**: Invalid tokens never reach subgraphs
9. **CORS Whitelisting**: Only allowed origins can make requests
10. **Secure Cookie Clearing**: Logout properly cleans up session

### 🚨 Important Security Notes

1. **Never expose JWT secrets**: Keep them in environment variables
2. **Use HTTPS in production**: Cookie `secure` flag requires it
3. **Rotate secrets periodically**: Especially if compromised
4. **Monitor failed auth attempts**: Implement alerting for brute force
5. **Keep dependencies updated**: Regularly update security packages
6. **Validate on subgraphs too**: Gateway validation is not enough
7. **Use strong passwords**: Implement password policies
8. **Log security events**: Track logins, logouts, failed attempts

---

## 📊 Token Lifecycle

```
┌─────────────────────────────────────────────────────────────┐
│                     Token Lifecycle                         │
└─────────────────────────────────────────────────────────────┘

Login
  │
  ├─> Access Token Generated (15m TTL)
  │     ├─> Stored in httpOnly cookie
  │     └─> Used for GraphQL requests
  │
  └─> Refresh Token Generated (7d TTL)
        ├─> Stored in httpOnly cookie
        └─> Used to renew access token

After 15 minutes:
  │
  ├─> Access Token Expires
  │     └─> GraphQL requests fail with 401
  │
  └─> Client calls /session/refresh
        ├─> Validates refresh token
        ├─> Generates new access token
        └─> Updates cookie

After 7 days:
  │
  └─> Refresh Token Expires
        └─> User must login again

Logout:
  │
  └─> Both cookies cleared
        └─> Session terminated
```

---

## 🧪 Testing Authentication

### Test Login

```bash
curl -X POST http://localhost:4000/session/auth \
  -H "Content-Type: application/json" \
  -d '{"email": "seller@ekoru.cl", "password": "password"}' \
  -c cookies.txt
```

### Test Authenticated GraphQL Request

```bash
curl -X POST http://localhost:4000/graphql \
  -H "Content-Type: application/json" \
  -b cookies.txt \
  -d '{"query": "{ me { id name } }"}'
```

### Test Refresh Token

```bash
curl -X POST http://localhost:4000/session/refresh \
  -H "Content-Type: application/json" \
  -b cookies.txt \
  -d '{"refreshToken": "your_refresh_token"}'
```

### Test Logout

```bash
curl -X POST http://localhost:4000/session/logout \
  -b cookies.txt \
  -c cookies.txt
```

---

## 🔧 Troubleshooting

### Problem: Cookies not being set

**Solution:** Ensure:

- Using `{ passthrough: true }` in `@Res()` decorator
- CORS `credentials: true` is enabled
- Client sends `credentials: 'include'` in fetch

### Problem: Token validation fails

**Solution:** Check:

- JWT_SECRET matches between gateway and subgraphs
- Token hasn't expired
- Token format is correct (Bearer prefix removed)

### Problem: CORS errors

**Solution:** Verify:

- Client origin matches CORS configuration
- `credentials: true` in CORS config
- Client sends correct `Origin` header

---

## 📝 Summary

The Ekoru Gateway implements a **multi-layered security architecture**:

1. **Transport Layer**: HTTPS, Helmet headers, CORS
2. **Rate Limiting**: Throttler prevents abuse
3. **Authentication**: Cookie-based JWT with refresh tokens
4. **Validation**: Signature verification before forwarding
5. **Authorization**: sellerId extraction and propagation
6. **Session Management**: Secure logout and cookie clearing

This design ensures that:

- ✅ Only authenticated users can access protected resources
- ✅ Tokens are validated at every step
- ✅ Credentials are never exposed to client-side JavaScript
- ✅ Subgraphs receive verified authentication context
- ✅ Sessions can be properly terminated
- ✅ Multiple security threats are mitigated

---

**Last Updated:** December 17, 2025  
**Maintained By:** Ekoru Engineering Team
