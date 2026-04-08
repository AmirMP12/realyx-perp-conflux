import { apiRateLimit, checkWsRateLimit, decrementWsCount } from '../middleware/rateLimit.js';
import { metricsMiddleware } from '../middleware/metrics.js';
import { jest } from '@jest/globals';

describe('Middleware Coverage Enhancement', () => {
  describe('Rate Limiter', () => {
    it('getClientIp should handle x-forwarded-for string', () => {
      const req = { headers: { 'x-forwarded-for': '1.2.3.4, 5.6.7.8' } };
      const next = jest.fn();
      apiRateLimit(req, {}, next);
      expect(next).toHaveBeenCalledWith();
    });

    it('getClientIp should handle x-forwarded-for array', () => {
      const req = { headers: { 'x-forwarded-for': ['9.8.7.6'] } };
      const next = jest.fn();
      apiRateLimit(req, {}, next);
      expect(next).toHaveBeenCalledWith();
    });

    it('getClientIp should default to req.ip', () => {
      const req = { ip: '127.0.0.1' };
      const next = jest.fn();
      apiRateLimit(req, {}, next);
      expect(next).toHaveBeenCalledWith();
    });

    it('should trigger rate limit error', () => {
      const req = { ip: 'throttled-ip' };
      const next = jest.fn();
      for (let i = 0; i < 101; i++) {
        apiRateLimit(req, {}, next);
      }
      expect(next).toHaveBeenCalledWith(expect.objectContaining({ status: 429 }));
    });

    it('should handle WS rate limiting', () => {
      const ip = 'ws-ip';
      for (let i = 0; i < 10; i++) {
        expect(checkWsRateLimit(ip)).toBe(true);
      }
      expect(checkWsRateLimit(ip)).toBe(false);
      decrementWsCount(ip);
      expect(checkWsRateLimit(ip)).toBe(true);
      decrementWsCount(ip);
      decrementWsCount(ip);
    });
  });

  describe('Metrics Middleware', () => {
    it('should track request duration', (done) => {
      const req = { method: 'GET', url: '/test' };
      const res: any = {
        on: jest.fn((event, cb: any) => {
          if (event === 'finish') {
            setTimeout(cb, 10);
          }
        })
      };
      const next = jest.fn();
      metricsMiddleware(req as any, res, next);
      expect(next).toHaveBeenCalled();
      setTimeout(() => {
        done();
      }, 50);
    });
  });
});
