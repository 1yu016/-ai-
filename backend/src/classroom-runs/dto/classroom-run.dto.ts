import { Type } from 'class-transformer';
import {
  IsInt,
  IsString,
  Matches,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class RequestIdDto {
  @IsString()
  @MinLength(8)
  @MaxLength(100)
  @Matches(/^[A-Za-z0-9._:-]+$/)
  requestId: string;
}

export class StartClassroomRunDto extends RequestIdDto {
  @Type(() => Number) @IsInt() @Min(1) lessonPlanId: number;
  @Type(() => Number) @IsInt() @Min(1) classId: number;
  @Type(() => Number) @IsInt() @Min(1) classroomId: number;
  @Type(() => Number) @IsInt() @Min(1) deviceId: number;
}

export class ClassroomRunOperationDto extends RequestIdDto {
  @Type(() => Number) @IsInt() @Min(1) version: number;
}

export class ChangeClassroomStepDto extends ClassroomRunOperationDto {
  @Type(() => Number) @IsInt() @Min(0) stepIndex: number;
}
