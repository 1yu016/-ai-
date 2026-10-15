import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import {
  AttendanceStatus,
  RollCallMode,
} from '../classroom-participation.types';

export class AttendanceEntryDto {
  @Type(() => Number) @IsInt() @Min(1) studentId: number;
  @IsEnum(AttendanceStatus) status: AttendanceStatus;
  @IsOptional() @IsString() @MaxLength(300) note?: string;
}

export class SetAttendanceDto extends AttendanceEntryDto {
  @IsString() @Length(8, 100) requestId: string;
}

export class BatchAttendanceDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => AttendanceEntryDto)
  entries: AttendanceEntryDto[];

  @IsString() @Length(8, 100) requestId: string;
}

export class VoiceAttendanceRecognizeDto {
  @IsString() @Length(1, 500) text: string;
  @IsOptional() @IsEnum(AttendanceStatus) defaultStatus?: AttendanceStatus;
  @IsString() @Length(8, 100) requestId: string;
}

export class ConfirmVoiceAttendanceDto {
  @IsString() @Length(20, 3000) confirmationToken: string;
  @Type(() => Number) @IsInt() @Min(1) studentId: number;
  @IsEnum(AttendanceStatus) status: AttendanceStatus;
  @IsOptional() @IsString() @MaxLength(300) note?: string;
  @IsString() @Length(8, 100) requestId: string;
}

export class AttendanceHistoryQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize = 20;
}

export class CreateStudentGroupDto {
  @IsString() @Length(1, 100) name: string;
  @IsOptional() @IsString() @MaxLength(300) description?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) sortOrder?: number;
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @ArrayUnique()
  @IsInt({ each: true })
  studentIds?: number[];
  @IsString() @Length(8, 100) requestId: string;
}

export class UpdateStudentGroupDto {
  @IsOptional() @IsString() @Length(1, 100) name?: string;
  @IsOptional() @IsString() @MaxLength(300) description?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) sortOrder?: number;
  @IsString() @Length(8, 100) requestId: string;
}

export class GroupMemberDto {
  @Type(() => Number) @IsInt() @Min(1) studentId: number;
  @IsString() @Length(8, 100) requestId: string;
}

export class RandomGroupingDto {
  @Type(() => Number) @IsInt() @Min(2) @Max(20) groupCount: number;
  @IsOptional()
  @IsArray()
  @ArrayMinSize(2)
  @ArrayMaxSize(100)
  @ArrayUnique()
  @IsInt({ each: true })
  studentIds?: number[];
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(100, { each: true })
  names?: string[];
  @IsString() @Length(8, 100) requestId: string;
}

export class RollCallDto {
  @IsEnum(RollCallMode) mode: RollCallMode;
  @ValidateIf((value: RollCallDto) => value.mode === RollCallMode.Group)
  @Type(() => Number)
  @IsInt()
  @Min(1)
  groupId?: number;
  @ValidateIf((value: RollCallDto) => value.mode === RollCallMode.Range)
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ArrayUnique()
  @IsInt({ each: true })
  studentIds?: number[];
  @ValidateIf(
    (value: RollCallDto) => value.mode === RollCallMode.TeacherSpecified,
  )
  @Type(() => Number)
  @IsInt()
  @Min(1)
  specifiedStudentId?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(10) cooldownCount = 2;
  @IsString() @Length(8, 100) requestId: string;
}
