import { setupApp } from '@/setup';
import { User } from '@entities/user.entity';
import { EntityManager } from '@mikro-orm/postgresql';
import { AppModule } from '@modules/app.module';
import { AUTH_COOKIE_NAME } from '@modules/sessions/sessions.constants';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';

interface SerializedUser {
  uuid: string;
  username: string;
  email: string;
  role: string;
  password?: string;
  googleId?: string;
}

interface SessionResponse {
  user: SerializedUser;
  expiresAt: string;
  expiresIn: number;
}

describe('Auth (e2e)', () => {
  let app: INestApplication<App>;
  let em: EntityManager;

  // Unique per run so repeated runs against the same DB don't collide.
  const suffix = Date.now().toString(36);
  const credentials = {
    username: `e2e_user_${suffix}`,
    email: `e2e_${suffix}@example.com`,
    password: 'sup3r-secret',
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    setupApp(app);
    await app.init();

    em = moduleFixture.get(EntityManager);
  });

  afterAll(async () => {
    await em.fork().nativeDelete(User, { email: credentials.email });
    await app?.close();
  });

  describe('User creation (POST /users)', () => {
    it('creates a user and returns the serialized entity', async () => {
      const res = await request(app.getHttpServer())
        .post('/users')
        .send(credentials)
        .expect(201);

      const body = res.body as SerializedUser;
      expect(body).toMatchObject({
        username: credentials.username,
        email: credentials.email,
        role: expect.any(String) as string,
      });
      expect(body.uuid).toEqual(expect.any(String));
      expect(body.password).toBeUndefined();
      expect(body.googleId).toBeUndefined();
    });

    it('rejects a duplicate username/email with 409', async () => {
      await request(app.getHttpServer())
        .post('/users')
        .send(credentials)
        .expect(409);
    });

    it('rejects an invalid payload with 400', async () => {
      await request(app.getHttpServer())
        .post('/users')
        .send({ username: 'x', email: 'not-an-email', password: '' })
        .expect(400);
    });
  });

  describe('Login (POST /sessions)', () => {
    it('rejects wrong credentials with 401', async () => {
      await request(app.getHttpServer())
        .post('/sessions')
        .send({ login: credentials.username, password: 'wrong-password' })
        .expect(401);
    });

    it('rejects an empty payload with 401', async () => {
      await request(app.getHttpServer())
        .post('/sessions')
        .send({ login: '', password: '' })
        .expect(401);
    });

    it('logs in with username and sets the auth cookie', async () => {
      const res = await request(app.getHttpServer())
        .post('/sessions')
        .send({ login: credentials.username, password: credentials.password })
        .expect(201);

      const body = res.body as SessionResponse;
      expect(body.user).toMatchObject({
        username: credentials.username,
        email: credentials.email,
      });
      expect(body.expiresIn).toEqual(expect.any(Number));
      expect(body.expiresAt).toEqual(expect.any(String));

      const cookies = res.get('Set-Cookie') ?? [];
      expect(cookies.some((c) => c.startsWith(`${AUTH_COOKIE_NAME}=`))).toBe(
        true,
      );
    });

    it('logs in with email as well', async () => {
      await request(app.getHttpServer())
        .post('/sessions')
        .send({ login: credentials.email, password: credentials.password })
        .expect(201);
    });
  });

  describe('Current session (GET /sessions/current)', () => {
    it('returns 401 without a session cookie', async () => {
      await request(app.getHttpServer()).get('/sessions/current').expect(401);
    });

    it('returns the current session when authenticated', async () => {
      const agent = request.agent(app.getHttpServer());

      await agent
        .post('/sessions')
        .send({ login: credentials.username, password: credentials.password })
        .expect(201);

      const res = await agent.get('/sessions/current').expect(200);
      const body = res.body as SessionResponse;
      expect(body.user).toMatchObject({
        username: credentials.username,
        email: credentials.email,
      });
    });
  });

  describe('Logout (DELETE /sessions/current)', () => {
    it('destroys the session so subsequent requests are unauthenticated', async () => {
      const agent = request.agent(app.getHttpServer());

      await agent
        .post('/sessions')
        .send({ login: credentials.username, password: credentials.password })
        .expect(201);

      // Authenticated before logout.
      await agent.get('/sessions/current').expect(200);

      await agent.delete('/sessions/current').expect(204);

      // Session is invalidated after logout.
      await agent.get('/sessions/current').expect(401);
    });

    it('returns 401 when logging out without a session', async () => {
      await request(app.getHttpServer())
        .delete('/sessions/current')
        .expect(401);
    });
  });
});
