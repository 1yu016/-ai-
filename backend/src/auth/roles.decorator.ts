import { SetMetadata } from '@nestjs/common';
import { TeacherRole } from './entities/teacher.entity';

export const ROLES_KEY = 'allowed_roles';
export const Roles = (...roles: TeacherRole[]) => SetMetadata(ROLES_KEY, roles);
