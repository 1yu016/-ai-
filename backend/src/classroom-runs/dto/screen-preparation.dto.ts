import { Type } from 'class-transformer';
import { IsInt, Min } from 'class-validator';
import { RequestIdDto } from './classroom-run.dto';

export class CreateScreenPreparationDto extends RequestIdDto {
  @Type(() => Number) @IsInt() @Min(1) classId: number;
  @Type(() => Number) @IsInt() @Min(1) classroomId: number;
  @Type(() => Number) @IsInt() @Min(1) lessonPlanId: number;
  @Type(() => Number) @IsInt() @Min(1) lessonPlanVersion: number;
}
export class CancelScreenPreparationDto {
  @Type(() => Number) @IsInt() @Min(1) revision: number;
}
