import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { Request, Response, NextFunction } from 'express';

const JWT_SECRET = process.env.JWT_SECRET || 'lubos_secret_key_123';

export interface AuthUser {
  user_id: string;
  username: string;
  role: string;
  name: string;
}

export function hashPassword(password: string): string {
  return bcrypt.hashSync(password, 10);
}

export function verifyPassword(password: string, hash: string): boolean {
  return bcrypt.compareSync(password, hash);
}

export function createToken(userId: string, username: string, role: string, name: string): string {
  return jwt.sign({ user_id: userId, username, role, name }, JWT_SECRET, { expiresIn: '7d' });
}

export function getCurrentUser(req: Request): AuthUser | null {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }
  const token = authHeader.substring(7);
  try {
    const payload = jwt.verify(token, JWT_SECRET) as any;
    return {
      user_id: payload.user_id || payload.sub,
      username: payload.username,
      role: payload.role,
      name: payload.name,
    };
  } catch {
    return null;
  }
}

export function authMiddleware(req: Request, res: Response, next: NextFunction) {
  const user = getCurrentUser(req);
  if (!user) {
    res.status(401).json({ detail: 'No autorizado / Token invalido' });
    return;
  }
  (req as any).user = user;
  next();
}

export function requireRoles(...roles: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const user = (req as any).user || getCurrentUser(req);
    if (!user) {
      res.status(401).json({ detail: 'No autorizado' });
      return;
    }
    (req as any).user = user;
    if (roles.length > 0 && !roles.includes(user.role)) {
      res.status(403).json({ detail: 'Sin permisos suficientes' });
      return;
    }
    next();
  };
}
