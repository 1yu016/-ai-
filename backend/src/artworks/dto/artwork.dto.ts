import { Transform, Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';
import { ClassroomCommandSource } from '../../classroom-runs/classroom-command.types';

export class UploadArtworkDto {
  @Transform(({ value }) => Number(value)) @IsInt() @Min(1) studentId: number;
  @IsOptional() @Transform(({ value }) => Number(value)) @IsInt() @Min(0) lessonStepIndex?: number;
}

export class ArtworkReviewDto {
  @Type(() => Number) @IsInt() @Min(1) artworkId: number;
}

export class ConfirmArtworkDto {
  @IsString() @MinLength(1) @MaxLength(1000) teacherComment: string;
}

export class ArtworkListQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize = 20;
}

export class DeliverArtworkDto {
  @IsString() @MinLength(8) @MaxLength(100) @Matches(/^[A-Za-z0-9._:-]+$/) requestId: string;
  @Type(() => Number) @IsInt() @Min(1) deviceId: number;
  @Type(() => Number) @IsInt() @Min(1) targetDeviceId: number;
  @Type(() => Number) @IsInt() @Min(1) expectedVersion: number;
  @IsEnum(ClassroomCommandSource) source: ClassroomCommandSource = ClassroomCommandSource.TeacherPanel;
}
