import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import type { AuthenticatedRequest } from '../auth/auth.types';
import { MigrateVisitorDto } from './dto/migrate-visitor.dto';
import {
  VisitorMigrationService,
  type VisitorMigrationResult,
} from './visitor-migration.service';

@Controller('data')
export class DataController {
  constructor(
    private readonly visitorMigrationService: VisitorMigrationService,
  ) {}

  @Post('migrate-visitor')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthGuard)
  migrateVisitor(
    @Body() dto: MigrateVisitorDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<VisitorMigrationResult> {
    return this.visitorMigrationService.migrate(
      dto.visitorId,
      request.user.sub,
    );
  }
}
