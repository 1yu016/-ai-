import type { CanActivate, DynamicModule } from '@nestjs/common';

export class ThrottlerGuard implements CanActivate {
  canActivate(): boolean {
    return true;
  }
}

export class ThrottlerModule {
  static forRoot(): DynamicModule {
    return this.createModule();
  }

  static forRootAsync(): DynamicModule {
    return this.createModule();
  }

  private static createModule(): DynamicModule {
    return {
      global: true,
      module: ThrottlerModule,
      providers: [ThrottlerGuard],
      exports: [ThrottlerGuard],
    };
  }
}
