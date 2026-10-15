import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class CreateStudentQuestionDto {
  @Transform(trim) @IsString() @Length(1, 100) requestId: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) studentId?: number | null;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) lessonStepIndex?: number | null;
  @Transform(trim) @IsOptional() @IsString() @Length(1, 1000) asrRawText?: string;
  /** 兼容已就绪的前端交接契约；未提供 asrRawText 时作为原始文本。 */
  @Transform(trim) @IsOptional() @IsString() @Length(1, 1000) questionText?: string;
  @Transform(trim) @IsOptional() @IsString() @MaxLength(1000) teacherCorrectedText?: string | null;
  @Transform(trim) @IsOptional() @IsString() @MaxLength(100) topic?: string | null;
  @Transform(trim) @IsOptional() @IsString() @MaxLength(100) domain?: string | null;
  @IsOptional() @IsBoolean() isAnonymous?: boolean;
}

export class UpdateStudentQuestionDto {
  @Transform(trim) @IsString() @Length(1, 100) requestId: string;
  @Transform(trim) @IsOptional() @IsString() @Length(1, 1000) teacherCorrectedText?: string;
  @Transform(trim) @IsOptional() @IsString() @MaxLength(100) topic?: string | null;
  @Transform(trim) @IsOptional() @IsString() @MaxLength(100) domain?: string | null;
  @IsOptional() @IsBoolean() isAnonymous?: boolean;
}

export class ClassQuestionQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize = 20;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) studentId?: number;
  @Transform(trim) @IsOptional() @IsString() @MaxLength(100) keyword?: string;
  @Transform(trim) @IsOptional() @IsString() @MaxLength(100) topic?: string;
  @Transform(trim) @IsOptional() @IsString() @MaxLength(100) domain?: string;
}

export class QuestionMapQueryDto {
  @Transform(trim) @IsOptional() @IsString() @MaxLength(100) topic?: string;
  @Transform(trim) @IsOptional() @IsString() @MaxLength(100) domain?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) studentId?: number;
}
