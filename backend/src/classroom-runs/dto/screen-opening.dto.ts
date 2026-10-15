import { Type } from 'class-transformer';
import { IsInt, Min } from 'class-validator';

export class ScreenOpeningOperationDto {
  @Type(() => Number) @IsInt() @Min(1) deviceId: number;
  @Type(() => Number) @IsInt() @Min(1) bindingId: number;
  @Type(() => Number) @IsInt() @Min(1) expectedRevision: number;
}
