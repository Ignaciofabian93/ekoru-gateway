# 🚀 Ekoru Gateway

> A high-performance API Gateway built with NestJS, serving as the central entry point for the Ekoru e-commerce platform.

[![NestJS](https://img.shields.io/badge/NestJS-11.x-E0234E?logo=nestjs)](https://nestjs.com/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript)](https://www.typescriptlang.org/)
[![Prisma](https://img.shields.io/badge/Prisma-6.x-2D3748?logo=prisma)](https://www.prisma.io/)
[![Docker](https://img.shields.io/badge/Docker-Ready-2496ED?logo=docker)](https://www.docker.com/)

---

## 📋 Table of Contents

- [Overview](#-overview)
- [Architecture](#-architecture)
- [Features](#-features)
- [Tech Stack](#-tech-stack)
- [Getting Started](#-getting-started)
- [Project Structure](#-project-structure)
- [API Documentation](#-api-documentation)
- [Environment Configuration](#-environment-configuration)
- [Database](#-database)
- [Testing](#-testing)
- [Deployment](#-deployment)
- [Development Guidelines](#-development-guidelines)

---

## 🎯 Overview

**Ekoru Gateway** is the backbone API service for the Ekoru marketplace platform. It handles:

- ✅ Authentication & Authorization (JWT-based)
- 🖼️ Image upload and management
- 🔐 Secure session handling with cookies
- 🌐 CORS configuration for multi-environment support
- 📦 File storage with environment-specific paths

This gateway serves as a unified interface between the frontend applications and backend services, providing a secure, scalable, and maintainable architecture.

---

## 🏗️ Architecture

```
┌─────────────────┐
│  Frontend Apps  │
│  (Next.js)      │
└────────┬────────┘
         │
         │ HTTPS/REST
         │
┌────────▼────────────────────────┐
│     Ekoru Gateway (NestJS)      │
│  ┌──────────────────────────┐   │
│  │   Authentication Layer   │   │
│  │   (JWT + Cookies)        │   │
│  └──────────┬───────────────┘   │
│             │                    │
│  ┌──────────▼───────────────┐   │
│  │   Business Logic         │   │
│  │   - Auth Service         │   │
│  │   - Images Service       │   │
│  └──────────┬───────────────┘   │
│             │                    │
│  ┌──────────▼───────────────┐   │
│  │   Prisma ORM             │   │
│  └──────────┬───────────────┘   │
└─────────────┼───────────────────┘
              │
      ┌───────▼────────┐
      │   PostgreSQL   │
      │   Database     │
      └────────────────┘
```

---

## ✨ Features

### 🔐 Authentication & Authorization

- **JWT Token Management**: Secure access tokens with 15-minute expiry
- **Refresh Token Flow**: 7-day refresh tokens for seamless session management
- **HTTP-Only Cookies**: Enhanced security for token storage
- **Environment-Aware Security**: Different cookie settings for dev/QA/production
- **Password Encryption**: bcrypt hashing for secure password storage

### 🖼️ Image Management

- **Multi-category Upload**: Separate endpoints for departments, products, and users
- **File Validation**: Type checking and size limits (5MB max)
- **Unique Filename Generation**: Timestamp-based naming to prevent collisions
- **Environment-Specific Storage**: Different paths for dev/QA/production
- **Direct File Serving**: Efficient image retrieval by category and filename

### 🌐 Multi-Environment Support

- **Development**: Local development with hot-reload
- **QA**: Staging environment for testing
- **Production**: Optimized for performance and security

### 🛡️ Security Features

- **CORS Protection**: Environment-specific origin whitelist
- **Cookie Security**: HttpOnly, Secure, and SameSite attributes
- **Input Validation**: class-validator for request validation
- **SQL Injection Prevention**: Prisma ORM with parameterized queries

---

## 🛠️ Tech Stack

### Core Framework

- **[NestJS](https://nestjs.com/)** v11 - Progressive Node.js framework
- **[TypeScript](https://www.typescriptlang.org/)** v5 - Type-safe JavaScript
- **[Express](https://expressjs.com/)** - Web server framework

### Database & ORM

- **[Prisma](https://www.prisma.io/)** v6 - Next-generation ORM
- **[PostgreSQL](https://www.postgresql.org/)** - Relational database

### Authentication

- **[Passport](http://www.passportjs.org/)** - Authentication middleware
- **[@nestjs/jwt](https://docs.nestjs.com/security/authentication)** - JWT implementation
- **[bcrypt](https://github.com/kelektiv/node.bcrypt.js)** - Password hashing

### File Handling

- **[Multer](https://github.com/expressjs/multer)** - Multipart/form-data handling

### Development Tools

- **[ESLint](https://eslint.org/)** - Code linting
- **[Prettier](https://prettier.io/)** - Code formatting
- **[Jest](https://jestjs.io/)** - Testing framework

### DevOps

- **[Docker](https://www.docker.com/)** - Containerization
- **[Docker Compose](https://docs.docker.com/compose/)** - Multi-container orchestration

---

## 🚀 Getting Started

### Prerequisites

```bash
# Required
Node.js >= 18.x
npm >= 9.x
PostgreSQL >= 14.x

# Optional (for Docker deployment)
Docker >= 24.x
Docker Compose >= 2.x
```

### Installation

1. **Clone the repository**

   ```bash
   git clone https://github.com/Ignaciofabian93/ekoru-gateway.git
   cd ekoru-gateway
   ```

2. **Install dependencies**

   ```bash
   npm install
   ```

3. **Set up environment variables**

   ```bash
   cp .env.example .env
   # Edit .env with your configuration
   ```

4. **Generate Prisma Client**

   ```bash
   npx prisma generate
   ```

5. **Run database migrations**

   ```bash
   npx prisma migrate dev
   ```

6. **Start development server**
   ```bash
   npm run start:dev
   ```

The server will start at `http://localhost:9000`

---

## 📁 Project Structure

```
ekoru-gateway/
├── prisma/
│   └── schema.prisma          # Database schema
├── src/
│   ├── auth/                  # Authentication module
│   │   ├── auth.controller.ts # Login & refresh endpoints
│   │   ├── auth.service.ts    # Auth business logic
│   │   ├── auth.module.ts     # Module configuration
│   │   └── strategies/        # Passport strategies
│   │       └── jwt.strategy.ts
│   ├── images/                # Image management module
│   │   ├── images.controller.ts       # Upload & retrieve endpoints
│   │   ├── images.service.ts          # File handling logic
│   │   ├── images.module.ts           # Module configuration
│   │   ├── profile-image.controller.ts
│   │   ├── cover-image.controller.ts
│   │   ├── business-image.controller.ts
│   │   └── product-images.controller.ts
│   ├── prisma/                # Prisma module
│   │   ├── prisma.service.ts  # Prisma client service
│   │   └── prisma.module.ts   # Module configuration
│   ├── config/                # Configuration files
│   ├── app.module.ts          # Root module
│   └── main.ts                # Application entry point
├── test/
│   ├── auth/                  # Auth e2e tests
│   └── images/                # Images e2e tests
├── docker/
├── .env.example               # Environment variables template
├── .env.qa.example            # QA environment template
├── .env.prod.example          # Production environment template
├── Dockerfile                 # Docker build configuration
├── compose.qa.yml             # QA deployment config
├── compose.prod.yml           # Production deployment config
├── DEPLOYMENT.md              # Deployment guide
└── README.md                  # This file
```

---

## 📚 API Documentation

### Authentication Endpoints

#### `POST /session/auth`

Login endpoint with email and password.

**Request:**

```json
{
  "email": "user@example.com",
  "password": "SecurePass123!"
}
```

**Response:**

```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "message": "Inicio de sesión exitoso"
}
```

**Cookies Set:**

- `token` - Access token (15 min expiry)
- `refreshToken` - Refresh token (7 day expiry)

---

#### `POST /session/refresh`

Refresh access token using refresh token.

**Request:**

```json
{
  "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

**Response:**

```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "success": true
}
```

---

### Image Upload Endpoints

#### `POST /api/images/upload/department`

Upload department image.

**Request:**

- Content-Type: `multipart/form-data`
- Field: `image` (file)
- Max size: 5MB
- Allowed types: image/\*

**Response:**

```json
{
  "success": true,
  "imagePath": "/images/departments/department-1234567890-987654321.jpg",
  "imageUrl": "http://localhost:9000/images/departments/department-1234567890-987654321.jpg"
}
```

---

#### `POST /api/images/upload/product`

Upload product image.

**Request:** Same as department upload

**Response:**

```json
{
  "success": true,
  "imagePath": "/images/products/product-1234567890-987654321.jpg",
  "imageUrl": "http://localhost:9000/images/products/product-1234567890-987654321.jpg"
}
```

---

#### `POST /api/images/upload/user`

Upload user profile image.

**Request:** Same as department upload

**Response:**

```json
{
  "success": true,
  "imagePath": "/images/users/user-1234567890-987654321.jpg",
  "imageUrl": "http://localhost:9000/images/users/user-1234567890-987654321.jpg"
}
```

---

#### `GET /api/images/:category/:filename`

Retrieve uploaded image.

**Example:**

```
GET /api/images/products/product-1234567890-987654321.jpg
```

**Response:** Image file (Content-Type: image/\*)

---

## ⚙️ Environment Configuration

### Environment Variables

```bash
# Application
ENVIRONMENT=development        # development | qa | production
PORT=9000                     # Server port

# Database
DATABASE_URL=postgresql://user:password@localhost:5432/ekoru

# JWT Configuration
JWT_SECRET=your-jwt-secret-here
JWT_REFRESH_SECRET=your-refresh-secret-here

# Images (Development)
DEV_IMAGES_PATH=/public/images

# Images (QA/Production)
IMAGES_PATH=/app/images
IMAGES_BASE_URL=https://gateway.ekoru.cl/images
```

### Environment-Specific Behavior

| Feature         | Development      | QA                    | Production         |
| --------------- | ---------------- | --------------------- | ------------------ |
| CORS Origin     | `localhost:3000` | `qa.app.ekoru.cl`     | `app.ekoru.cl`     |
| Cookie HttpOnly | ❌ No            | ✅ Yes                | ✅ Yes             |
| Cookie Secure   | ❌ No            | ✅ Yes                | ✅ Yes             |
| Cookie Domain   | undefined        | `.ekoru.cl`           | `.ekoru.cl`        |
| Images Path     | `/public/images` | `/app/images`         | `/app/images`      |
| Images URL      | `localhost:9000` | `qa.gateway.ekoru.cl` | `gateway.ekoru.cl` |

---

## 🗄️ Database

### Prisma Schema

The gateway uses Prisma ORM with PostgreSQL. Key models include:

- **Seller**: User accounts with authentication
- **SellerType**: Person, Startup, Company
- **PersonProfile** / **BusinessProfile**: Type-specific profiles
- **Product**, **Service**, **Order**: E-commerce entities
- **Image relations**: Profile images, cover images, product images

### Database Commands

```bash
# Generate Prisma Client
npx prisma generate

# Run migrations (development)
npx prisma migrate dev

# Run migrations (production)
npx prisma migrate deploy

# Open Prisma Studio (database GUI)
npx prisma studio

# Reset database (development only!)
npx prisma migrate reset

# Create a new migration
npx prisma migrate dev --name migration_name
```

---

## 🧪 Testing

### Running Tests

```bash
# Unit tests
npm run test

# E2E tests
npm run test:e2e

# Test coverage
npm run test:cov

# Watch mode
npm run test:watch

# Specific test file
npm test -- auth.service.spec.ts
```

### Test Coverage

The project includes comprehensive tests for:

- ✅ **Auth Service**: Login, refresh token, token decoding
- ✅ **Images Service**: Upload, storage, retrieval, file operations
- ✅ **E2E Tests**: Full authentication and image upload flows

### Writing Tests

```typescript
// Example unit test
describe('AuthService', () => {
  it('should login successfully with valid credentials', async () => {
    // Arrange
    const email = 'test@example.com';
    const password = 'password123';

    // Act
    const result = await service.login(email, password, res);

    // Assert
    expect(result).toHaveProperty('token');
    expect(result.message).toBe('Inicio de sesión exitoso');
  });
});
```

---

## 🐳 Deployment

### Docker Deployment

The gateway is containerized and ready for deployment. See [DEPLOYMENT.md](./DEPLOYMENT.md) for detailed instructions.

**Quick Start:**

```bash
# QA Environment
docker compose -f compose.qa.yml up -d --build

# Production Environment
docker compose -f compose.prod.yml up -d --build
```

### CI/CD Pipeline

1. **Build**: Multi-stage Docker build
2. **Test**: Automated test suite
3. **Deploy**: Docker Compose deployment
4. **Migrate**: Prisma migrations
5. **Health Check**: Verify service availability

---

## 💻 Development Guidelines

### Code Style

- **TypeScript**: Use strict type checking
- **Naming**: camelCase for variables/functions, PascalCase for classes
- **Formatting**: Prettier with 2-space indentation
- **Linting**: ESLint with TypeScript rules

### Git Workflow

```bash
# Create feature branch
git checkout -b feature/your-feature-name

# Make changes and commit
git add .
git commit -m "feat: add new feature"

# Push and create PR
git push origin feature/your-feature-name
```

### Commit Message Convention

```
feat: add new feature
fix: bug fix
docs: documentation update
test: add or update tests
refactor: code refactoring
style: code style changes
chore: build/tooling changes
```

### Adding a New Module

1. Generate module with NestJS CLI:

   ```bash
   nest g module feature-name
   nest g controller feature-name
   nest g service feature-name
   ```

2. Implement business logic in service
3. Create controller endpoints
4. Add validation DTOs
5. Write unit and e2e tests
6. Update documentation

---

## 🤝 Contributing

1. Fork the repository
2. Create your feature branch
3. Write tests for new features
4. Ensure all tests pass
5. Submit a pull request

---

## 📞 Support

For questions or issues:

- Create an issue in the repository
- Contact the development team
- Check the [DEPLOYMENT.md](./DEPLOYMENT.md) for deployment issues

---

## 📄 License

This project is proprietary and confidential.

---

**Built with ❤️ by the Ekoru Team**
