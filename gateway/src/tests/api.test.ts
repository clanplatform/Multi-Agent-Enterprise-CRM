import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import request from 'supertest';
import app from '../src/index';
import { prisma } from '../src/services/prisma';

describe('Authentication API', () => {
  let accessToken: string;
  let refreshToken: string;
  
  const testUser = {
    tenantName: 'Test Tenant',
    tenantSlug: `test-${Date.now()}`,
    email: `test-${Date.now()}@example.com`,
    password: 'SecurePass123!',
    name: 'Test User',
  };

  afterAll(async () => {
    // Cleanup
    await prisma.user.deleteMany({
      where: { email: testUser.email },
    });
    await prisma.tenant.deleteMany({
      where: { slug: testUser.tenantSlug },
    });
    await prisma.$disconnect();
  });

  describe('POST /api/v1/auth/register', () => {
    it('should register a new tenant and user', async () => {
      const response = await request(app)
        .post('/api/v1/auth/register')
        .send(testUser)
        .expect(201);

      expect(response.body).toHaveProperty('accessToken');
      expect(response.body).toHaveProperty('refreshToken');
      expect(response.body.user).toHaveProperty('id');
      expect(response.body.user.email).toBe(testUser.email);
      expect(response.body.user.roles).toContain('admin');

      accessToken = response.body.accessToken;
      refreshToken = response.body.refreshToken;
    });

    it('should reject duplicate tenant slug', async () => {
      await request(app)
        .post('/api/v1/auth/register')
        .send(testUser)
        .expect(400);
    });

    it('should validate required fields', async () => {
      const response = await request(app)
        .post('/api/v1/auth/register')
        .send({ email: 'test@example.com' })
        .expect(400);

      expect(response.body.error.code).toBe('BAD_REQUEST');
    });
  });

  describe('POST /api/v1/auth/login', () => {
    it('should login with valid credentials', async () => {
      const response = await request(app)
        .post('/api/v1/auth/login')
        .send({
          email: testUser.email,
          password: testUser.password,
        })
        .expect(200);

      expect(response.body).toHaveProperty('accessToken');
      expect(response.body).toHaveProperty('refreshToken');
    });

    it('should reject invalid password', async () => {
      await request(app)
        .post('/api/v1/auth/login')
        .send({
          email: testUser.email,
          password: 'wrongpassword',
        })
        .expect(401);
    });

    it('should reject non-existent user', async () => {
      await request(app)
        .post('/api/v1/auth/login')
        .send({
          email: 'nonexistent@example.com',
          password: 'anypassword',
        })
        .expect(401);
    });
  });

  describe('POST /api/v1/auth/refresh', () => {
    it('should refresh access token', async () => {
      const response = await request(app)
        .post('/api/v1/auth/refresh')
        .send({ refreshToken })
        .expect(200);

      expect(response.body).toHaveProperty('accessToken');
      expect(response.body).toHaveProperty('refreshToken');
    });

    it('should reject invalid refresh token', async () => {
      await request(app)
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: 'invalid-token' })
        .expect(401);
    });
  });

  describe('POST /api/v1/auth/logout', () => {
    it('should logout and invalidate tokens', async () => {
      await request(app)
        .post('/api/v1/auth/logout')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ refreshToken })
        .expect(200);
    });
  });
});

describe('Leads API', () => {
  let accessToken: string;
  let leadId: string;

  beforeAll(async () => {
    // Login to get token
    const loginResponse = await request(app)
      .post('/api/v1/auth/login')
      .send({
        email: 'demo@example.com',
        password: 'demo1234',
      });
    
    accessToken = loginResponse.body.accessToken;
  });

  describe('POST /api/v1/leads', () => {
    it('should create a new lead', async () => {
      const response = await request(app)
        .post('/api/v1/leads')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          name: 'John Doe',
          email: 'john@example.com',
          company: 'Acme Corp',
          source: 'website',
        })
        .expect(201);

      expect(response.body).toHaveProperty('id');
      expect(response.body.name).toBe('John Doe');
      expect(response.body.status).toBe('new');

      leadId = response.body.id;
    });

    it('should require authentication', async () => {
      await request(app)
        .post('/api/v1/leads')
        .send({ name: 'Test' })
        .expect(401);
    });
  });

  describe('GET /api/v1/leads', () => {
    it('should list leads with pagination', async () => {
      const response = await request(app)
        .get('/api/v1/leads')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(response.body).toHaveProperty('data');
      expect(response.body).toHaveProperty('pagination');
      expect(Array.isArray(response.body.data)).toBe(true);
    });

    it('should filter by status', async () => {
      const response = await request(app)
        .get('/api/v1/leads?status=new')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      response.body.data.forEach((lead: any) => {
        expect(lead.status).toBe('new');
      });
    });
  });

  describe('GET /api/v1/leads/:id', () => {
    it('should get a single lead', async () => {
      const response = await request(app)
        .get(`/api/v1/leads/${leadId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(response.body.id).toBe(leadId);
    });

    it('should return 404 for non-existent lead', async () => {
      await request(app)
        .get('/api/v1/leads/00000000-0000-0000-0000-000000000000')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(404);
    });
  });

  describe('PATCH /api/v1/leads/:id', () => {
    it('should update a lead', async () => {
      const response = await request(app)
        .patch(`/api/v1/leads/${leadId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          status: 'contacted',
          score: 75,
        })
        .expect(200);

      expect(response.body.status).toBe('contacted');
      expect(response.body.score).toBe(75);
    });
  });

  describe('DELETE /api/v1/leads/:id', () => {
    it('should delete a lead', async () => {
      await request(app)
        .delete(`/api/v1/leads/${leadId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(204);

      // Verify deletion
      await request(app)
        .get(`/api/v1/leads/${leadId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(404);
    });
  });
});

describe('Health Checks', () => {
  describe('GET /health', () => {
    it('should return healthy status', async () => {
      const response = await request(app)
        .get('/health')
        .expect(200);

      expect(response.body.status).toBe('healthy');
    });
  });

  describe('GET /ready', () => {
    it('should return ready status', async () => {
      const response = await request(app)
        .get('/ready')
        .expect(200);

      expect(response.body.status).toBe('ready');
    });
  });
});
